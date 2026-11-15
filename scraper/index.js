// Cloudflare cron Worker (see wrangler.toml here): every minute it reads the total level board from
// Milky Way Idle and, only when that has changed, every other leaderboard too, storing a snapshot in D1,
// the database the site's /api reads. Polling each minute stamps snapshots within a minute of the game's
// own refresh (its messages carry no time), so XP/hour isn't skewed by the two schedules drifting apart.
// Once an hour it instead reads the market's +0 order books for expensive items (see saveMarket).
// Secrets: MWI_ACCESS_TOKEN, MWI_HASH, MWI_CHARACTER_ID, MWI_GAME_VERSION, MWI_VERSION_TIMESTAMP.

import recipes from './recipes.json' with { type: 'json' }; // from update-recipes.mjs

const TYPES = ['standard', 'ironcow'];
// Also available: task_points, labyrinth_points, labyrinth_depth, collection_points,
// bestiary_points, fame_points, guild (and types legacy_ironcow, steam_standard, steam_ironcow, guild).
const CATEGORIES = [
  'total_level', 'milking', 'foraging', 'woodcutting', 'cheesesmithing', 'crafting',
  'tailoring', 'cooking', 'brewing', 'alchemy', 'enhancing', 'stamina', 'intelligence',
  'attack', 'defense', 'melee', 'ranged', 'magic',
];
const RETENTION_DAYS = 30;
// The game's spam protection allows a burst of about 50 requests, then about one a second.
const PACE_MS = 500; // leaderboards fit in the burst
const MARKET_PACE_MS = 800; // plus ~0.2 s per reply: about one a second
const FULL_DETAIL_DAYS = 3; // older snapshots are thinned to one per hour to fit D1's free 500 MB
const MARKET_MINUTE = 30; // once an hour this run reads market order books instead of leaderboards;
const MARKET_MINUTES = 3; // it takes up to this long (about a second per item), so the runs after it do nothing
const MARKET_MIN_PRICE = 50_000_000; // only +0 items whose best ask or bid is at least this
const ARTISAN = 1 - 0.1 * 1.1; // Artisan Tea's 10% fewer inputs, 10% better with a Guzzling Pouch; not the upgrade item
// An input is only crafted when that takes at most this many of any one material (count needed x its recipe's count):
// 10 Sighted Bracers (1 Magnifying Glass each) or a Watchful Relic (100s) yes, 30 Umbral Bracers (72 leather each) no.
const MAKE_MAX_MATERIAL = 500;

export default {
  async scheduled(event, env) {
    const at = new Date().toISOString(); // one timestamp for the whole run
    // One connection at a time: the game disconnects the account's other sessions, so runs must not overlap.
    const minute = new Date(event.scheduledTime).getUTCMinutes();
    if (minute === MARKET_MINUTE) return console.log(await saveMarket(env, at));
    if (minute > MARKET_MINUTE && minute < MARKET_MINUTE + MARKET_MINUTES) return;
    const last = await env.DB
      .prepare(`SELECT rows FROM snapshots WHERE type = 'standard' AND category = 'total_level' ORDER BY fetched_at DESC LIMIT 1`)
      .first('rows');
    const boards = await fetchBoards(env, last);
    console.log(boards ? await save(env.DB, boards, at) : 'Unchanged, skipped');
  },
};

// Resolves [{ type, category, rows: JSON string of [[name, totalXp], ...] in rank order }],
// or null when the first board (standard total_level) still matches lastRows: the game hasn't refreshed.
async function fetchBoards(env, lastRows) {
  const requests = TYPES.flatMap(type => CATEGORIES.map(category =>
    ({ type: 'get_leaderboard', getLeaderboardData: { leaderboardType: type, leaderboardCategory: category } })));
  let unchanged = false;
  const replies = await askGame(env, requests, ['leaderboard_updated', 'get_leaderboard'], (msg, i) => {
    const rows = JSON.stringify((msg.leaderboard?.rows ?? []).map(r => [r.name, r.value2 ?? 0]));
    if (i === 0 && rows === lastRows) unchanged = true;
    return unchanged ? false : { type: msg.leaderboardType, category: msg.leaderboardCategory, rows };
  }, 55_000, PACE_MS);
  return unchanged ? null : replies;
}

// Sends each request in turn over one game connection and resolves onReply's results, one per reply.
// onReply returning false ends the run early. timeoutMs keeps a run from overlapping the next one's connection.
async function askGame(env, requests, replyTypes, onReply, timeoutMs, paceMs) {
  const url = 'https://api.milkywayidle.com/ws?' + new URLSearchParams({
    hash: env.MWI_HASH, characterId: env.MWI_CHARACTER_ID, gameVersion: env.MWI_GAME_VERSION,
    versionTimestamp: env.MWI_VERSION_TIMESTAMP, lang: 'en', isSteam: '0',
  });
  // The game checks the login cookie and the page origin, both of which a Worker can send without a browser.
  const res = await fetch(url, { headers: { Upgrade: 'websocket', Cookie: `accessToken=${env.MWI_ACCESS_TOKEN}`, Origin: 'https://www.milkywayidle.com' } });
  const ws = res.webSocket;
  if (!ws) throw new Error(`Game refused the connection (HTTP ${res.status})`);
  ws.accept();

  return new Promise((resolve, reject) => {
    const results = [];
    let next = 0, stopped = false;
    const send = msg => ws.send(JSON.stringify({ ...msg, ts: Date.now() }));
    const ask = () => send(requests[next]);
    const finish = problem => {
      clearTimeout(timer);
      try { ws.close(); } catch { }
      // A partial run is still worth saving; nothing at all usually means a stale token or game version.
      results.length || stopped ? resolve(results) : reject(new Error(`Nothing fetched: ${problem}. The access token or game version is probably stale.`));
    };
    const timer = setTimeout(() => finish('timed out'), timeoutMs);

    ws.addEventListener('message', event => {
      // The type is read from the start of the text so the 200 KB character data is never parsed (free plan CPU limit).
      const type = /"type":"(\w+)"/.exec(event.data.slice(0, 100))?.[1];
      if (type === 'init_character_data') ask();
      else if (type === 'ping') send({ type: 'pong', pongData: { hash: JSON.parse(event.data).pingData.hash } });
      else if (replyTypes.includes(type)) {
        const result = onReply(JSON.parse(event.data), next);
        if (result === false) { stopped = true; return finish(); }
        results.push(result);
        ++next < requests.length ? setTimeout(ask, paceMs) : finish();
      }
      else if (type === 'error') setTimeout(ask, 5000); // the game's spam protection: wait, then ask again
    });
    ws.addEventListener('close', event => finish(`connection closed (${event.code}) after ${results.length} replies`));
    ws.addEventListener('error', () => finish('WebSocket error'));
  });
}

// Lists the +0 order book of every item trading at MARKET_MIN_PRICE or more, as one row per run:
// rows = JSON [[itemHrid, listedQty, bestAsk, wantedQty, bestBid, avgPrice, volume, pricesAt, makeCost, made], ...].
// Prices are -1 when there are no orders or trades. avgPrice and volume are the price file's trades for its last hour;
// pricesAt is that file's own timestamp, so the API never counts the same hour twice. makeCost and made: see makeCost.
async function saveMarket(env, at) {
  const prices = await fetch('https://www.milkywayidle.com/game_data/marketplace.json').then(r => r.json());
  const items = Object.entries(prices.marketData)
    .filter(([, levels]) => levels['0'] && Math.max(levels['0'].a, levels['0'].b) >= MARKET_MIN_PRICE)
    .map(([hrid]) => hrid);
  const requests = items.map(itemHrid => ({ type: 'get_market_item_order_books', getMarketItemOrderBooksData: { itemHrid } }));
  const sum = orders => (orders ?? []).reduce((n, o) => n + o.quantity, 0);
  const ask = hrid => (prices.marketData[hrid]?.['0']?.a > 0 ? prices.marketData[hrid]['0'].a : Infinity);
  const rows = await askGame(env, requests, ['market_item_order_books_updated'], msg => {
    const { asks, bids } = msg.marketItemOrderBooks.orderBooks[0] ?? {}; // index = enhancement level
    const item = msg.marketItemOrderBooks.itemHrid, traded = prices.marketData[item]?.['0'] ?? {};
    const make = makeCost(item, ask);
    return [item, sum(asks), asks?.[0]?.price ?? -1, sum(bids), bids?.[0]?.price ?? -1, traded.p ?? -1, traded.v ?? 0, prices.timestamp,
      make.cost < Infinity ? Math.round(make.cost) : -1, make.made];
  }, MARKET_MINUTES * 60_000 - 5000, MARKET_PACE_MS);
  await env.DB.batch([
    env.DB.prepare(`INSERT OR REPLACE INTO market (fetched_at, rows) VALUES (?, ?)`).bind(at, JSON.stringify(rows)),
    env.DB.prepare(`DELETE FROM market WHERE fetched_at < ?`).bind(new Date(Date.now() - RETENTION_DAYS * 86400_000).toISOString()),
  ]);
  return `Saved market for ${rows.length} of ${items.length} items`;
}

// The cost of crafting one item: each input (and the upgrade item) is bought at ask(hrid), or crafted from bought
// inputs when that's cheaper and quick (MAKE_MAX_MATERIAL; one level only, as deeper or bulk crafting trades hours of
// work for coins). made lists the inputs crafted.
// Resolves { cost: Infinity, made: [] } for items with no recipe.
export function makeCost(item, ask, depth = 1) {
  const recipe = recipes[item];
  if (!recipe) return { cost: Infinity, made: [] };
  const [outputs, upgrade, ...inputs] = recipe;
  const made = [];
  const cheapest = (hrid, count) => {
    const counts = recipes[hrid]?.filter((_, k) => k > 2 && k % 2 === 1) ?? [];
    const quick = count * Math.max(0, ...counts) <= MAKE_MAX_MATERIAL;
    const craft = depth > 0 && quick ? makeCost(hrid, ask, depth - 1).cost : Infinity;
    if (craft < ask(hrid)) made.push(hrid);
    return Math.min(ask(hrid), craft);
  };
  let cost = upgrade ? cheapest(upgrade, 1) : 0;
  for (let i = 0; i < inputs.length; i += 2) cost += ARTISAN * inputs[i + 1] * cheapest(inputs[i], inputs[i + 1]);
  return { cost: cost / outputs, made };
}

async function save(db, boards, at) {
  const ago = ms => new Date(Date.now() - ms).toISOString();
  const thinTo = ago(FULL_DETAIL_DAYS * 86400_000), thinFrom = ago(FULL_DETAIL_DAYS * 86400_000 + 6 * 3600_000);
  await db.batch([
    ...boards.map(b => db
      .prepare(`INSERT OR REPLACE INTO snapshots (type, category, fetched_at, rows) VALUES (?, ?, ?, ?)`)
      .bind(b.type, b.category, at, b.rows)),
    db.prepare(`DELETE FROM snapshots WHERE fetched_at < ?`).bind(ago(RETENTION_DAYS * 86400_000)),
    // Thin the slice that just aged past full detail: keep the first run of each hour (substr = "YYYY-MM-DDTHH").
    db.prepare(`DELETE FROM snapshots WHERE fetched_at >= ?1 AND fetched_at < ?2 AND fetched_at NOT IN
                (SELECT MIN(fetched_at) FROM snapshots WHERE fetched_at >= ?1 AND fetched_at < ?2 GROUP BY substr(fetched_at, 1, 13))`)
      .bind(thinFrom, thinTo),
  ]);
  return `Saved ${boards.length} boards`;
}

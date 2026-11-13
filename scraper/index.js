// Cloudflare cron Worker (see wrangler.toml here): every 10 minutes it reads each leaderboard from
// Milky Way Idle over one WebSocket and stores a snapshot in D1, the database the site's /api reads.
// Secrets: MWI_ACCESS_TOKEN, MWI_HASH, MWI_CHARACTER_ID, MWI_GAME_VERSION, MWI_VERSION_TIMESTAMP.

const TYPES = ['standard', 'ironcow'];
// Also available: task_points, labyrinth_points, labyrinth_depth, collection_points,
// bestiary_points, fame_points, guild (and types legacy_ironcow, steam_standard, steam_ironcow, guild).
const CATEGORIES = [
  'total_level', 'milking', 'foraging', 'woodcutting', 'cheesesmithing', 'crafting',
  'tailoring', 'cooking', 'brewing', 'alchemy', 'enhancing', 'stamina', 'intelligence',
  'attack', 'defense', 'melee', 'ranged', 'magic',
];
const RETENTION_DAYS = 30;
const PACE_MS = 500; // the game rejects requests faster than about four a second
const FULL_DETAIL_DAYS = 3; // older snapshots are thinned to one per hour to fit D1's free 500 MB

export default {
  async scheduled(event, env) {
    console.log(await save(env.DB, await fetchBoards(env)));
  },
};

// Resolves [{ type, category, rows: JSON string of [[name, totalXp], ...] in rank order }].
async function fetchBoards(env) {
  const wanted = TYPES.flatMap(type => CATEGORIES.map(category => ({ type, category })));
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
    const boards = [];
    let next = 0;
    const send = msg => ws.send(JSON.stringify({ ...msg, ts: Date.now() }));
    const ask = () => send({ type: 'get_leaderboard', getLeaderboardData: { leaderboardType: wanted[next].type, leaderboardCategory: wanted[next].category } });
    const finish = problem => {
      clearTimeout(timer);
      try { ws.close(); } catch { }
      // A partial run is still worth saving; nothing at all usually means a stale token or game version.
      boards.length ? resolve(boards) : reject(new Error(`No leaderboards fetched: ${problem}. The access token or game version is probably stale.`));
    };
    const timer = setTimeout(() => finish('timed out'), 60000);

    ws.addEventListener('message', event => {
      // The type is read from the start of the text so the 200 KB character data is never parsed (free plan CPU limit).
      const type = /"type":"(\w+)"/.exec(event.data.slice(0, 100))?.[1];
      if (type === 'init_character_data') ask();
      else if (type === 'ping') send({ type: 'pong', pongData: { hash: JSON.parse(event.data).pingData.hash } });
      else if (type === 'leaderboard_updated' || type === 'get_leaderboard') {
        const msg = JSON.parse(event.data);
        const rows = (msg.leaderboard?.rows ?? []).map(r => [r.name, r.value2 ?? 0]);
        boards.push({ type: msg.leaderboardType, category: msg.leaderboardCategory, rows: JSON.stringify(rows) });
        ++next < wanted.length ? setTimeout(ask, PACE_MS) : finish();
      }
      else if (type === 'error') setTimeout(ask, 5000); // the game's spam protection: wait, then ask for the same board again
    });
    ws.addEventListener('close', event => finish(`connection closed (${event.code}) after ${boards.length} boards`));
    ws.addEventListener('error', () => finish('WebSocket error'));
  });
}

async function save(db, boards) {
  // The game only refreshes leaderboards periodically; skip the run if the reference board hasn't changed.
  const ref = boards.find(b => b.type === 'standard' && b.category === 'total_level');
  if (ref) {
    const last = await db
      .prepare(`SELECT rows FROM snapshots WHERE type = 'standard' AND category = 'total_level' ORDER BY fetched_at DESC LIMIT 1`)
      .first('rows');
    if (last === ref.rows) return `Unchanged, skipped (${boards.length} boards fetched)`;
  }

  const ago = ms => new Date(Date.now() - ms).toISOString();
  const at = ago(0); // one timestamp for the whole run
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

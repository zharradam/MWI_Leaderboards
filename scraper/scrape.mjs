// Fetches every configured leaderboard from Milky Way Idle and posts one snapshot to /api/ingest.
// Runs in GitHub Actions (see .github/workflows/scrape.yml). The game only accepts its WebSocket
// from a logged-in browser page, so we drive a headless Chromium.
import { chromium } from 'playwright';

const TYPES = ['standard', 'ironcow'];
// Also available: task_points, labyrinth_points, labyrinth_depth, collection_points,
// bestiary_points, fame_points, guild (and types legacy_ironcow, steam_standard, steam_ironcow, guild).
const CATEGORIES = [
  'total_level', 'milking', 'foraging', 'woodcutting', 'cheesesmithing', 'crafting',
  'tailoring', 'cooking', 'brewing', 'alchemy', 'enhancing', 'stamina', 'intelligence',
  'attack', 'defense', 'melee', 'ranged', 'magic',
];

const env = name => process.env[name] || (() => { throw new Error(`Missing env var ${name}`); })();
const game = {
  accessToken: env('MWI_ACCESS_TOKEN'),
  hash: env('MWI_HASH'),
  characterId: env('MWI_CHARACTER_ID'),
  gameVersion: env('MWI_GAME_VERSION'),
  versionTimestamp: env('MWI_VERSION_TIMESTAMP'),
};
const ingestUrl = env('INGEST_URL');
const ingestToken = env('INGEST_TOKEN');

const wsUrl = 'wss://api.milkywayidle.com/ws?' + new URLSearchParams({
  hash: game.hash, characterId: game.characterId, gameVersion: game.gameVersion,
  versionTimestamp: game.versionTimestamp, lang: 'en', isSteam: '0',
});

const browser = await chromium.launch();
try {
  const context = await browser.newContext();
  await context.addCookies([{ name: 'accessToken', value: game.accessToken, domain: '.milkywayidle.com', path: '/', secure: true }]);
  await context.addInitScript(hash => localStorage.setItem('localHash', hash), game.hash);
  const page = await context.newPage();
  await page.goto(`https://www.milkywayidle.com/game?characterId=${game.characterId}`, { waitUntil: 'networkidle' });

  const fetchedAt = new Date().toISOString(); // one timestamp for the whole run
  const boards = [];
  for (const type of TYPES) {
    for (const category of CATEGORIES) {
      try {
        const rows = await page.evaluate(fetchLeaderboard, { wsUrl, type, category });
        boards.push({ type, category, rows });
        console.log(`${type}/${category}: ${rows.length} rows`);
      } catch (e) {
        console.log(`${type}/${category}: FAILED ${e.message ?? e}`);
      }
      await page.waitForTimeout(500);
    }
  }
  if (!boards.length) throw new Error('No leaderboards fetched; token or game version is probably stale.');

  const res = await fetch(ingestUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ingestToken}` },
    body: JSON.stringify({ fetchedAt, boards }),
  });
  const body = await res.text();
  console.log(`Ingest ${res.status}: ${body}`);
  if (!res.ok) process.exitCode = 1;
} finally {
  await browser.close();
}

// Runs inside the game page. Opens a socket, waits for init, requests one leaderboard.
function fetchLeaderboard({ wsUrl, type, category }) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const timer = setTimeout(() => { ws.close(); reject(new Error('Timeout')); }, 30000);
    const send = msg => ws.send(JSON.stringify({ ...msg, ts: Date.now() }));
    const seen = [];

    ws.onmessage = event => {
      const msg = JSON.parse(event.data);
      seen.push(msg.type);
      if (msg.type === 'init_character_data')
        send({ type: 'get_leaderboard', getLeaderboardData: { leaderboardType: type, leaderboardCategory: category } });
      else if (msg.type === 'ping')
        send({ type: 'pong', pongData: { hash: msg.pingData.hash } });
      else if (msg.type === 'get_leaderboard' || msg.type === 'leaderboard_updated') {
        clearTimeout(timer);
        ws.close();
        resolve((msg.leaderboard?.rows ?? []).map(r => [r.name, r.value2 ?? 0])); // [name, total XP], in rank order
      }
    };
    ws.onerror = () => { clearTimeout(timer); reject(new Error('WebSocket error')); };
    ws.onclose = e => { clearTimeout(timer); reject(new Error(`Closed (${e.code}) after: ${seen.join(', ') || 'nothing'}`)); };
  });
}

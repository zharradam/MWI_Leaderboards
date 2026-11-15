// Refreshes recipes.json from the game's own data: run `node scraper/update-recipes.mjs` after a game update.
// It logs in once with the secrets in scraper/.dev.vars (kicking that account's other sessions, like the scraper does).
// recipes.json: { outputHrid: [outputCount, upgradeHrid or '', inputHrid, count, inputHrid, count, ...] }
import { readFileSync, writeFileSync } from 'node:fs';

const dir = new URL('.', import.meta.url);
const env = Object.fromEntries(readFileSync(new URL('.dev.vars', dir), 'utf8').split(/\r?\n/)
  .filter(line => line.includes('='))
  .map(line => line.split(/=(.*)/).map(s => s.trim().replace(/^"|"$/g, ''))));
// An old versionTimestamp makes the game send its client data (recipes, items, ...) first.
const url = 'wss://api.milkywayidle.com/ws?' + new URLSearchParams({
  hash: env.MWI_HASH, characterId: env.MWI_CHARACTER_ID, gameVersion: env.MWI_GAME_VERSION, versionTimestamp: '0', lang: 'en', isSteam: '0',
});
const ws = new WebSocket(url, { headers: { Cookie: `accessToken=${env.MWI_ACCESS_TOKEN}`, Origin: 'https://www.milkywayidle.com' } });
const timer = setTimeout(() => { console.error('No client data after 30 s'); process.exit(1); }, 30_000);

ws.onmessage = ({ data }) => {
  if (!data.startsWith('{"type":"init_client_data"')) return;
  clearTimeout(timer);
  ws.close();
  // Only skills Artisan Tea works in: their recipes have fixed inputs and one output.
  const types = ['cheesesmithing', 'crafting', 'tailoring', 'cooking', 'brewing'].map(t => `/action_types/${t}`);
  const recipes = {};
  for (const a of Object.values(JSON.parse(data).actionDetailMap)) {
    if (!types.includes(a.type) || a.outputItems?.length !== 1) continue;
    const out = a.outputItems[0];
    recipes[out.itemHrid] = [out.count, a.upgradeItemHrid || '', ...(a.inputItems ?? []).flatMap(i => [i.itemHrid, i.count])];
  }
  writeFileSync(new URL('recipes.json', dir), JSON.stringify(recipes));
  console.log(`Saved ${Object.keys(recipes).length} recipes`);
};
ws.onerror = () => { console.error('WebSocket error: the access token or game version is probably stale'); process.exit(1); };

# MWI Leaderboards

Tracks XP gained per player on Milky Way Idle leaderboards and charts it.

```
GitHub Actions (10 min)             Cloudflare Pages (pages.dev)
scraper/scrape.mjs  --POST-->  functions/api/[[route]].js  <-->  D1 (schema.sql)
 headless Chromium               /api/types, /categories, /xp       |
 + game WebSocket                public/index.html  <---------------+
```

## One-time setup

1. **Cloudflare** (free): `npx wrangler login`, then
   - `npx wrangler d1 create mwi-leaderboards` → paste the `database_id` into `wrangler.toml`
   - `npm run db:init`
   - `npx wrangler pages project create mwi-leaderboards --production-branch main`
   - `npx wrangler pages secret put INGEST_TOKEN --project-name mwi-leaderboards` (any long random string)
   - `npm run deploy`
2. **GitHub** → Settings → Secrets and variables → Actions:
   - Secrets: `MWI_ACCESS_TOKEN`, `MWI_HASH`, `MWI_CHARACTER_ID`, `MWI_GAME_VERSION`, `MWI_VERSION_TIMESTAMP`,
     `INGEST_TOKEN` (same value as above), `CLOUDFLARE_API_TOKEN` (Pages + D1 edit), `CLOUDFLARE_ACCOUNT_ID`
   - Variable: `INGEST_URL` = `https://mwi-leaderboards.pages.dev/api/ingest`
3. Actions → *Scrape leaderboards* → **Run workflow** to test.

## When scraping breaks

Game updates change `gameVersion` / `versionTimestamp`, and the access token can expire. Grab fresh values
from a logged-in browser (DevTools → Network → the `wss://api.milkywayidle.com/ws?...` request, and the
`accessToken` cookie) and update the GitHub secrets. The run log shows `Closed (...) after: close_session` when stale.

## Local dev

`npm install`, put `INGEST_TOKEN=dev` in `.dev.vars`, `npx wrangler d1 execute mwi-leaderboards --local --file=schema.sql`,
`npm run dev`. Tests: `npm test`.

# MWI Leaderboards

Tracks XP gained per player on Milky Way Idle leaderboards and charts it. Everything runs on Cloudflare's free plan.

```
Cloudflare Worker (cron, 10 min)          Cloudflare Pages (pages.dev)
scraper/index.js  ----writes---->  D1  <----reads----  functions/api/[[route]].js
 game WebSocket               (schema.sql)             /api/types, /categories, /xp
                                                       public/index.html
```

## One-time setup

`npx wrangler login`, then:

1. `npx wrangler d1 create mwi-leaderboards` → paste the `database_id` into `wrangler.toml` and `scraper/wrangler.toml`
2. `npm run db:init`
3. `npx wrangler pages project create mwi-leaderboards --production-branch main`, then `npm run deploy`
4. `npm run deploy:scraper`, then give the scraper its five secrets (see below)

Pushing to `main` redeploys the site through GitHub Actions (secrets `CLOUDFLARE_API_TOKEN` with Pages + D1 edit, and
`CLOUDFLARE_ACCOUNT_ID`). The scraper is deployed by hand with `npm run deploy:scraper`.

## Scraper secrets, and when scraping breaks

The scraper logs in as a spare game account (the game disconnects an account's other sessions on each poll, so don't
use one you play on). Its secrets are `MWI_ACCESS_TOKEN`, `MWI_HASH`, `MWI_CHARACTER_ID`, `MWI_GAME_VERSION` and
`MWI_VERSION_TIMESTAMP`.

Game updates change the version and timestamp, after which the status pill on the site turns red. In a browser logged
in to the spare account: DevTools → Network → Socket → the `wss://api.milkywayidle.com/ws?...` request has the hash,
character ID, game version and version timestamp in its URL. The `accessToken` cookie belongs to
`api.milkywayidle.com`; open that address in a tab to see it under Application → Cookies. `MWI_HASH` can be any random
20 characters.

Update a value in the Cloudflare dashboard (Workers → `mwi-scraper` → Settings → Variables and Secrets), or with
`npx wrangler secret put MWI_GAME_VERSION --config scraper/wrangler.toml`. Run logs are under the Worker's Logs tab.

## Local dev

`npm install`, `npx wrangler d1 execute mwi-leaderboards --local --file=schema.sql`, `npm run dev`. Tests: `npm test`.

To run the scraper locally, put the five secrets in `scraper/.dev.vars`, then in `scraper/` run
`npx wrangler dev --test-scheduled --persist-to ../.wrangler/state` and open `http://localhost:8787/__scheduled`.

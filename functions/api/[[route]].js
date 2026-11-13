// Cloudflare Pages Function handling every /api/* route. env.DB is the D1 binding.
//   GET /api/types
//   GET /api/categories/:type
//   GET /api/xp/:type/:category?days=7
// Read-only: snapshots are written by the cron Worker in scraper/.

const RETENTION_DAYS = 30; // the scraper deletes anything older
const POINTS_PER_CHART = 144; // every range is bucketed to about this many snapshots (24h at 10 min)
const MIN_GAP_MS = 45 * 60000; // gains across longer gaps (missed runs) are dropped

export async function onRequest({ request, env, params, waitUntil }) {
  const [route, a, b] = params.route ?? [];
  try {
    if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
    if (route === 'types' && !a) return json(await types(env.DB));
    if (route === 'categories' && a && !b) return json(await categories(env.DB, a));
    if (route === 'xp' && a && b) {
      const days = Math.min(Math.max(Number(new URL(request.url).searchParams.get('days')) || 7, 1), RETENTION_DAYS);
      // Cached for a minute under a canonical URL, so repeated or junk-parameter requests can't burn D1's free daily reads.
      const key = new Request(new URL(`/api/xp/${encodeURIComponent(a)}/${encodeURIComponent(b)}?days=${days}`, request.url));
      let res = await caches.default.match(key);
      if (!res) {
        res = json(await xp(env.DB, a, b, days), 200, { 'Cache-Control': 'public, max-age=60' });
        waitUntil(caches.default.put(key, res.clone()));
      }
      return res;
    }
    return json({ error: 'Not found' }, 404);
  } catch (e) {
    console.error(e);
    return json({ error: 'Internal error' }, 500);
  }
}

const json = (body, status = 200, headers) => Response.json(body, { status, headers });

const LATEST = `fetched_at = (SELECT MAX(fetched_at) FROM snapshots)`;

async function types(db) {
  const { results } = await db.prepare(`SELECT DISTINCT type FROM snapshots WHERE ${LATEST} ORDER BY type`).all();
  return results.map(r => r.type);
}

async function categories(db, type) {
  const { results } = await db
    .prepare(`SELECT category FROM snapshots WHERE type = ? AND ${LATEST} ORDER BY category`)
    .bind(type).all();
  return results.map(r => r.category);
}

// XP gained per player between consecutive snapshots. XP totals are cumulative, so longer ranges
// just read fewer snapshots (the last one in each time bucket) instead of every 10-minute scrape.
export async function xp(db, type, category, days) {
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  const bucketSeconds = Math.round(days * 86400 / POINTS_PER_CHART);
  const [snapshots, latest] = await db.batch([
    db.prepare(`SELECT MAX(fetched_at) AS fetched_at, rows FROM snapshots
                WHERE type = ? AND category = ? AND fetched_at >= ?
                GROUP BY CAST(strftime('%s', fetched_at) / ? AS INTEGER) ORDER BY fetched_at`)
      .bind(type, category, since, bucketSeconds),
    db.prepare(`SELECT MAX(fetched_at) AS latest FROM snapshots WHERE type = ? AND category = ?`).bind(type, category),
  ]);
  return { latest: latest.results[0]?.latest ?? null, ...computeXp(snapshots.results, Math.max(MIN_GAP_MS, bucketSeconds * 2500)) };
}

// snapshots: [{ fetched_at, rows: JSON [[name, totalXp], ...] }] oldest first.
export function computeXp(snapshots, maxGapMs = MIN_GAP_MS) {
  const prev = new Map(); // name -> { xp, t }
  const points = [];
  const elapsed = new Map(); // snapshot time -> ms since the snapshot before it
  let prevT = null;
  for (const snap of snapshots) {
    const t = Date.parse(snap.fetched_at);
    if (prevT !== null) elapsed.set(t, t - prevT);
    prevT = t;
    for (const [name, total] of JSON.parse(snap.rows)) {
      const p = prev.get(name);
      if (p && total >= p.xp && t - p.t <= maxGapMs) points.push({ name, t, y: total - p.xp });
      prev.set(name, { xp: total, t });
    }
  }

  // Only keep snapshots where someone actually gained XP (skips stale/duplicate game data).
  const times = [...new Set(points.filter(p => p.y > 0).map(p => p.t))].sort((x, y) => x - y);
  const index = new Map(times.map((t, i) => [t, i]));
  const players = new Map(); // name -> { name, total, data: XP gained at each timestamp, null where unknown }
  for (const p of points) {
    const i = index.get(p.t);
    if (i === undefined) continue;
    if (!players.has(p.name)) players.set(p.name, { name: p.name, total: 0, data: Array(times.length).fill(null) });
    const player = players.get(p.name);
    player.data[i] = p.y;
    player.total += p.y;
  }
  return {
    timestamps: times.map(t => new Date(t).toISOString()),
    hours: times.map(t => elapsed.get(t) / 3600_000), // time each gain was earned over, for XP/hour
    players: [...players.values()].sort((x, y) => y.total - x.total),
  };
}

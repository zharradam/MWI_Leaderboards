// Cloudflare Pages Function handling every /api/* route. env.DB is the D1 binding.
//   GET  /api/types
//   GET  /api/categories/:type
//   GET  /api/xp/:type/:category?days=7
//   POST /api/ingest   (Authorization: Bearer <INGEST_TOKEN>), called by the scraper

const MAX_GAP_MINUTES = 150; // deltas across longer gaps (missed runs) are dropped
const RETENTION_DAYS = 90;

export async function onRequest({ request, env, params }) {
  const [route, a, b] = params.route ?? [];
  try {
    if (request.method === 'POST' && route === 'ingest') return await ingest(request, env);
    if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
    if (route === 'types' && !a) return json(await types(env.DB));
    if (route === 'categories' && a && !b) return json(await categories(env.DB, a));
    if (route === 'xp' && a && b) {
      const days = Math.min(Math.max(Number(new URL(request.url).searchParams.get('days')) || 7, 1), RETENTION_DAYS);
      return json(await xp(env.DB, a, b, days));
    }
    return json({ error: 'Not found' }, 404);
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}

const json = (body, status = 200) => Response.json(body, { status });

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

// XP gained per player between consecutive snapshots (same rules as the old SQL Server LAG query).
export async function xp(db, type, category, days) {
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  const { results } = await db
    .prepare(`SELECT fetched_at, rows FROM snapshots WHERE type = ? AND category = ? AND fetched_at >= ? ORDER BY fetched_at`)
    .bind(type, category, since).all();
  return computeXp(results);
}

export function computeXp(snapshots) {
  const prev = new Map(); // name -> { value2, t }
  const points = [];
  for (const snap of snapshots) {
    const t = Date.parse(snap.fetched_at);
    for (const row of JSON.parse(snap.rows)) {
      const p = prev.get(row.name);
      if (p) {
        const gained = row.value2 - p.value2;
        if (gained >= 0 && (t - p.t) / 60000 <= MAX_GAP_MINUTES) points.push({ name: row.name, t, y: gained });
      }
      prev.set(row.name, { value2: row.value2, t });
    }
  }

  // Only keep snapshots where someone actually gained XP (skips stale/duplicate game data).
  const valid = new Set(points.filter(p => p.y > 0).map(p => p.t));
  const players = new Map();
  for (const p of points) {
    if (!valid.has(p.t)) continue;
    if (!players.has(p.name)) players.set(p.name, []);
    players.get(p.name).push({ x: label(p.t), y: p.y });
  }
  return {
    labels: [...valid].sort((x, y) => x - y).map(label),
    players: [...players].map(([name, data]) => ({ name, data })),
  };
}

const label = t => new Date(t).toISOString().replace(/^\d{4}-(\d\d)-(\d\d)T(\d\d:\d\d).*/, '$1/$2 $3'); // "MM/dd HH:mm" UTC

async function ingest(request, env) {
  if (!env.INGEST_TOKEN || !(await tokenMatches(request.headers.get('Authorization') ?? '', `Bearer ${env.INGEST_TOKEN}`)))
    return json({ error: 'Unauthorized' }, 401);

  const { fetchedAt, boards } = await request.json();
  if (isNaN(Date.parse(fetchedAt)) || !Array.isArray(boards) || !boards.length) return json({ error: 'Bad payload' }, 400);
  for (const bd of boards)
    if (typeof bd.type !== 'string' || typeof bd.category !== 'string' || !Array.isArray(bd.rows)) return json({ error: 'Bad board' }, 400);

  // The game only refreshes leaderboards periodically; skip the run if the reference board hasn't changed.
  const ref = boards.find(bd => bd.type === 'standard' && bd.category === 'total_level');
  if (ref) {
    const last = await env.DB
      .prepare(`SELECT rows FROM snapshots WHERE type = 'standard' AND category = 'total_level' ORDER BY fetched_at DESC LIMIT 1`)
      .first('rows');
    if (last === JSON.stringify(ref.rows)) return json({ skipped: true });
  }

  const at = new Date(fetchedAt).toISOString();
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86400_000).toISOString();
  await env.DB.batch([
    ...boards.map(bd => env.DB
      .prepare(`INSERT OR REPLACE INTO snapshots (type, category, fetched_at, rows) VALUES (?, ?, ?, ?)`)
      .bind(bd.type, bd.category, at, JSON.stringify(bd.rows))),
    env.DB.prepare(`DELETE FROM snapshots WHERE fetched_at < ?`).bind(cutoff),
  ]);
  return json({ saved: boards.length });
}

async function tokenMatches(given, expected) {
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([given, expected].map(s => crypto.subtle.digest('SHA-256', enc.encode(s))));
  return crypto.subtle.timingSafeEqual(a, b);
}

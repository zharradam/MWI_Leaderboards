import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeMarket } from './functions/api/[[route]].js';

const snap = (iso, rows) => ({ fetched_at: iso, rows: JSON.stringify(rows) });

test('market changes compare listed quantity with older snapshots', () => {
  const out = computeMarket(
    snap('2026-11-08T10:30:00Z', [['/items/a', 30, 60e6, 2, 55e6], ['/items/new', 1, 90e6, 0, -1]]),
    snap('2026-11-07T10:30:00Z', [['/items/a', 10, 61e6, 1, 54e6]]),
    undefined,
  );
  assert.deepEqual(out, {
    latest: '2026-11-08T10:30:00Z',
    items: [
      { item: '/items/a', listed: 30, ask: 60e6, wanted: 2, bid: 55e6, day: 20, week: null, traded: null, avgPrice: null, makeCost: null, made: [] },
      { item: '/items/new', listed: 1, ask: 90e6, wanted: 0, bid: -1, day: null, week: null, traded: null, avgPrice: null, makeCost: null, made: [] },
    ],
  });
  assert.deepEqual(computeMarket(undefined), { latest: null, items: [] });
});

test('market sums 24h volume once per price-file hour, with a volume-weighted average price', () => {
  const latest = snap('2026-11-08T12:30:00Z', [['/items/a', 5, 60e6, 1, 55e6, 58e6, 1, 300], ['/items/quiet', 2, 90e6, 0, -1, -1, 0, 300]]);
  const out = computeMarket(latest, undefined, undefined, [
    snap('2026-11-08T09:30:00Z', [['/items/a', 9, 60e6, 1, 55e6]]), // old five-field row: ignored
    snap('2026-11-08T10:30:00Z', [['/items/a', 8, 60e6, 1, 55e6, 50e6, 3, 100]]),
    snap('2026-11-08T11:30:00Z', [['/items/a', 8, 60e6, 1, 55e6, 50e6, 3, 100]]), // same price-file hour: counted once
    latest,
  ]);
  assert.equal(out.items[0].traded, 4);
  assert.equal(out.items[0].avgPrice, 52e6); // (3 * 50M + 1 * 58M) / 4
  assert.equal(out.items[1].traded, 0);
  assert.equal(out.items[1].avgPrice, null);
});

test('make cost buys inputs at the ask, or crafts one from bought inputs when cheaper', async () => {
  const { makeCost } = await import('./scraper/index.js');
  // Bishop's Codex: upgrade Watchful Relic + 10 scrolls, 5 tomes, 10 tomes, 100 moonstone, 100 amethyst (inputs x0.89).
  const asks = { '/items/watchful_relic': 9e6, '/items/bishops_scroll': 5e6, '/items/tome_of_the_elements': 3e6,
    '/items/tome_of_healing': 40e3, '/items/moonstone': 40e3, '/items/amethyst': 30e3,
    '/items/eye_of_the_watcher': 0.5e6, '/items/rainbow_cheese': 3e3, '/items/redwood_lumber': 3e3,
    '/items/crimson_cheese': 3e3, '/items/ginkgo_lumber': 3e3 };
  const ask = h => asks[h] ?? Infinity;
  const relic = 0.89 * (10 * 0.5e6 + 400 * 3e3); // 5.518M, cheaper than its 9M ask
  const { cost, made } = makeCost('/items/bishops_codex', ask);
  assert.equal(Math.round(cost), Math.round(relic + 0.89 * (10 * 5e6 + 5 * 3e6 + 10 * 40e3 + 100 * 40e3 + 100 * 30e3)));
  assert.deepEqual(made, ['/items/watchful_relic']);
  assert.equal(makeCost('/items/no_recipe', ask).cost, Infinity);
  // Marksman Bracers: 10 Sighted Bracers (1 glass each) may be crafted, but 30 Umbral Bracers (72 leather each) are
  // always bought, however cheap to craft.
  const bracers = { '/items/marksman_brooch': 5e6, '/items/umbral_bracers': 0.5e6, '/items/sighted_bracers': 2.2e6,
    '/items/beast_bracers': 1, '/items/umbral_leather': 1, '/items/magnifying_glass': 1 };
  assert.deepEqual(makeCost('/items/marksman_bracers', h => bracers[h] ?? Infinity).made, ['/items/sighted_bracers']);
});

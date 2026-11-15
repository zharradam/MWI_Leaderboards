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
      { item: '/items/a', listed: 30, ask: 60e6, wanted: 2, bid: 55e6, day: 20, week: null, traded: null, avgPrice: null },
      { item: '/items/new', listed: 1, ask: 90e6, wanted: 0, bid: -1, day: null, week: null, traded: null, avgPrice: null },
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

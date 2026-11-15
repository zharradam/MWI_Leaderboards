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
      { item: '/items/a', listed: 30, ask: 60e6, wanted: 2, bid: 55e6, day: 20, week: null },
      { item: '/items/new', listed: 1, ask: 90e6, wanted: 0, bid: -1, day: null, week: null },
    ],
  });
  assert.deepEqual(computeMarket(undefined), { latest: null, items: [] });
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeXp } from './functions/api/[[route]].js';

const snap = (iso, rows) => ({ fetched_at: iso, rows: JSON.stringify(rows) });

test('computes per-snapshot XP gains and drops long gaps / flat snapshots', () => {
  const out = computeXp([
    snap('2026-11-01T10:00:00Z', [['A', 100], ['B', 50]]),
    snap('2026-11-01T10:30:00Z', [['A', 160], ['B', 50]]),
    snap('2026-11-01T10:40:00Z', [['A', 160], ['B', 50]]), // nobody gained: dropped
    snap('2026-11-02T12:00:00Z', [['A', 999]]), // 25h gap: dropped
  ]);
  assert.deepEqual(out, {
    timestamps: ['2026-11-01T10:30:00.000Z'],
    hours: [0.5],
    players: [
      { name: 'A', total: 60, data: [60] },
      { name: 'B', total: 0, data: [0] },
    ],
  });
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeXp } from './functions/api/[[route]].js';

const snap = (iso, rows) => ({ fetched_at: iso, rows: JSON.stringify(rows) });

test('computes per-snapshot XP deltas and drops long gaps / flat snapshots', () => {
  const out = computeXp([
    snap('2026-11-01T10:00:00Z', [{ name: 'A', value2: 100 }, { name: 'B', value2: 50 }]),
    snap('2026-11-01T11:00:00Z', [{ name: 'A', value2: 160 }, { name: 'B', value2: 50 }]),
    snap('2026-11-01T12:00:00Z', [{ name: 'A', value2: 160 }, { name: 'B', value2: 50 }]), // nobody gained: dropped
    snap('2026-11-02T12:00:00Z', [{ name: 'A', value2: 999 }]), // 24h gap: dropped
  ]);
  assert.deepEqual(out, {
    labels: ['11/01 11:00'],
    players: [
      { name: 'A', data: [{ x: '11/01 11:00', y: 60 }] },
      { name: 'B', data: [{ x: '11/01 11:00', y: 0 }] },
    ],
  });
});

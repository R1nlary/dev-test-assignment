// @rev kc-31
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { almatyDate, isValidDate } from '../src/day.ts';

test('almatyDate: сутки считаются по UTC+5', () => {
  assert.equal(almatyDate('2026-11-15T18:59:59Z'), '2026-11-15');
  assert.equal(almatyDate('2026-11-15T19:00:00Z'), '2026-11-16');
  assert.equal(almatyDate('2026-11-16T18:59:59Z'), '2026-11-16');
});

test('isValidDate: принимает только настоящую дату YYYY-MM-DD', () => {
  assert.equal(isValidDate('2026-11-16'), true);
  assert.equal(isValidDate('2028-02-29'), true);
  for (const bad of ['', '2026-1-16', '16.11.2026', '2026-11-16T00:00', '2026-02-30', '2026-13-01', 'abc']) {
    assert.equal(isValidDate(bad), false, bad);
  }
});

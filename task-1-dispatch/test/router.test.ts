import { test } from 'node:test';
import assert from 'node:assert/strict';
import { almatyDate, assignBranch, branchLoad } from '../src/router.ts';
import { distanceKm } from '../src/geo.ts';
import type { Assignment, Branch, Order } from '../src/types.ts';

const branch = (over: Partial<Branch>): Branch => ({
  id: 'b-1', storeId: 's-1', name: 'Филиал', city: 'Алматы',
  lat: 43.24, lon: 76.91, active: true, pickupPointIds: [], dailyLimit: 100,
  ...over,
});
const order = (over: Partial<Order>): Order => ({
  id: 'o-1', storeId: 's-1', city: 'Алматы', lat: 43.25, lon: 76.92,
  pickupPointId: null, manualBranchId: null, createdAt: '2026-11-16T06:00:00Z',
  ...over,
});

const almaty = branch({ id: 'b-ala', city: 'Алматы', lat: 43.2567, lon: 76.9286 });
const astana = branch({ id: 'b-ast', city: 'Астана', lat: 51.128, lon: 71.43 });

test('distanceKm: Алматы — Астана около 970 км', () => {
  const d = distanceKm(43.2389, 76.8897, 51.1694, 71.4491);
  assert.ok(Math.abs(d - 970) < 15, `получили ${d.toFixed(1)}`);
});

test('manual: заказ уходит в указанный филиал', () => {
  assert.deepEqual(assignBranch(order({ manualBranchId: 'b-ast' }), [almaty, astana]), {
    orderId: 'o-1', branchId: 'b-ast', rule: 'manual',
  });
});

test('manual: неактивный филиал пропускается', () => {
  const closed = { ...astana, active: false };
  assert.notEqual(assignBranch(order({ manualBranchId: 'b-ast' }), [almaty, closed]).rule, 'manual');
});

test('single: у магазина один активный филиал', () => {
  assert.deepEqual(assignBranch(order({ city: 'Шымкент' }), [almaty]), {
    orderId: 'o-1', branchId: 'b-ala', rule: 'single',
  });
});

test('geo: выбирается ближайший филиал', () => {
  assert.deepEqual(assignBranch(order({ city: 'Конаев', lat: 43.25, lon: 76.93 }), [almaty, astana]), {
    orderId: 'o-1', branchId: 'b-ala', rule: 'geo',
  });
});

test('geo: без координат заказ не распределяется', () => {
  assert.equal(assignBranch(order({ city: 'Конаев', lat: null, lon: null }), [almaty, astana]).rule, 'unassigned');
});

test('pickup_point: заказ идёт в филиал, закреплённый за пунктом', () => {
  const pickup = branch({ ...astana, pickupPointIds: ['pp-5'] });
  const res = assignBranch(order({ pickupPointId: 'pp-5' }), [almaty, pickup]);
  assert.equal(res.branchId, 'b-ast');
  assert.equal(res.rule, 'pickup_point');
});

test('city: один филиал магазина в городе заказа', () => {
  const res = assignBranch(order({ city: 'Астана' }), [almaty, astana]);
  assert.equal(res.branchId, 'b-ast');
  assert.equal(res.rule, 'city');
});

test('geo: при нескольких филиалах в городе выбираем ближайший из них', () => {
  const far = branch({ id: 'b-other', lat: 43.4, lon: 76.99 });
  const closerElsewhere = branch({ id: 'b-out', city: 'Астана', lat: 43.25, lon: 76.92 });
  const res = assignBranch(order({ lat: 43.4, lon: 77 }), [almaty, far, closerElsewhere]);
  assert.equal(res.branchId, 'b-other');
  assert.equal(res.rule, 'geo');
});

test('лимит: заполненный филиал пропускается', () => {
  const busy = branch({ ...almaty, dailyLimit: 1, pickupPointIds: ['pp'] });
  const free = branch({ ...astana });
  const previous = order({ id: 'old' });
  const used = new Map<string, Assignment>([['old', { orderId: 'old', branchId: busy.id, rule: 'pickup_point' }]]);
  const res = assignBranch(order({ pickupPointId: 'pp' }), [busy, free], used, [previous]);
  assert.equal(res.branchId, free.id);
  assert.equal(res.rule, 'geo');
});

test('manual не проверяет лимит, а другие правила проверяют', () => {
  const busy = branch({ ...almaty, dailyLimit: 0 });
  const manual = assignBranch(order({ manualBranchId: busy.id }), [busy, astana]);
  assert.equal(manual.branchId, busy.id);
  assert.equal(manual.rule, 'manual');
  assert.equal(assignBranch(order({ pickupPointId: null }), [busy]).rule, 'unassigned');
});

test('один и тот же заказ не занимает лимит дважды', () => {
  const used = new Map<string, Assignment>();
  const current = order({ id: 'o-5' });
  const first = assignBranch(current, [almaty], used, [current]);
  used.set(current.id, first);
  assert.deepEqual(assignBranch(current, [almaty], used, [current]), first);
  assert.equal(branchLoad('b-ala', almatyDate(current.createdAt), used, [current]), 1);
});

test('сутки считаются по Алматы, а не UTC', () => {
  assert.equal(almatyDate('2026-11-15T19:00:00Z'), '2026-11-16');
  assert.equal(almatyDate('2026-11-15T18:59:59Z'), '2026-11-15');
});

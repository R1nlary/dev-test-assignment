// @rev kc-31
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assignBranch } from '../src/router.ts';
import { distanceKm } from '../src/geo.ts';
import type { Branch, Order } from '../src/types.ts';

const branch = (over: Partial<Branch>): Branch => ({
  id: 'b-1',
  storeId: 's-1',
  name: 'Филиал',
  city: 'Алматы',
  lat: 43.24,
  lon: 76.91,
  active: true,
  pickupPointIds: [],
  dailyLimit: 100,
  ...over,
});

const order = (over: Partial<Order>): Order => ({
  id: 'o-1',
  storeId: 's-1',
  city: 'Алматы',
  lat: 43.25,
  lon: 76.92,
  pickupPointId: null,
  manualBranchId: null,
  createdAt: '2026-11-16T06:00:00Z',
  ...over,
});

const almaty = branch({ id: 'b-ala', city: 'Алматы', lat: 43.2567, lon: 76.9286 });
const astana = branch({ id: 'b-ast', city: 'Астана', lat: 51.128, lon: 71.43 });

test('distanceKm: Алматы — Астана около 970 км', () => {
  const d = distanceKm(43.2389, 76.8897, 51.1694, 71.4491);
  assert.ok(Math.abs(d - 970) < 15, `получили ${d.toFixed(1)}`);
});

test('manual: заказ уходит в указанный филиал', () => {
  const res = assignBranch(order({ manualBranchId: 'b-ast' }), [almaty, astana]);
  assert.deepEqual(res, { orderId: 'o-1', branchId: 'b-ast', rule: 'manual' });
});

test('manual: неактивный филиал пропускается', () => {
  const closed = { ...astana, active: false };
  const res = assignBranch(order({ manualBranchId: 'b-ast' }), [almaty, closed]);
  assert.notEqual(res.rule, 'manual');
});

test('single: у магазина один активный филиал', () => {
  const res = assignBranch(order({ city: 'Шымкент' }), [almaty]);
  assert.deepEqual(res, { orderId: 'o-1', branchId: 'b-ala', rule: 'single' });
});

test('geo: выбирается ближайший филиал', () => {
  const res = assignBranch(order({ city: 'Конаев', lat: 43.25, lon: 76.93 }), [almaty, astana]);
  assert.deepEqual(res, { orderId: 'o-1', branchId: 'b-ala', rule: 'geo' });
});

test('geo: без координат заказ не распределяется', () => {
  const res = assignBranch(order({ city: 'Конаев', lat: null, lon: null }), [almaty, astana]);
  assert.equal(res.rule, 'unassigned');
});

const full = (...ids: string[]) => (b: Branch) => ids.includes(b.id);

test('pickup_point: пункт выдачи закреплён за филиалом', () => {
  const ast = { ...astana, pickupPointIds: ['pp-ast'] };
  const res = assignBranch(order({ pickupPointId: 'pp-ast' }), [almaty, ast]);
  assert.deepEqual(res, { orderId: 'o-1', branchId: 'b-ast', rule: 'pickup_point' });
});

test('pickup_point: пункт неактивного филиала не учитывается', () => {
  const closed = branch({ id: 'b-closed', active: false, pickupPointIds: ['pp-x'] });
  const res = assignBranch(order({ pickupPointId: 'pp-x' }), [almaty, astana, closed]);
  assert.deepEqual(res, { orderId: 'o-1', branchId: 'b-ala', rule: 'city' });
});

test('city: в городе заказа один филиал магазина', () => {
  const res = assignBranch(order({ city: 'Астана', lat: 43.25, lon: 76.93 }), [almaty, astana]);
  assert.deepEqual(res, { orderId: 'o-1', branchId: 'b-ast', rule: 'city' });
});

test('city: филиал другого магазина не считается', () => {
  const foreign = branch({ id: 'b-foreign', storeId: 's-2', city: 'Алматы' });
  const res = assignBranch(order({}), [almaty, astana, foreign]);
  assert.deepEqual(res, { orderId: 'o-1', branchId: 'b-ala', rule: 'city' });
});

const alaWest = branch({ id: 'b-ala-w', city: 'Алматы', lat: 43.24, lon: 76.85 });
const alaEast = branch({ id: 'b-ala-e', city: 'Алматы', lat: 43.24, lon: 76.95 });
const konaev = branch({ id: 'b-kon', city: 'Конаев', lat: 43.3, lon: 76.96 });

test('geo: если в городе несколько филиалов, выбирается ближайший из них', () => {
  const res = assignBranch(order({ lat: 43.29, lon: 76.96 }), [alaWest, alaEast, konaev]);
  assert.deepEqual(res, { orderId: 'o-1', branchId: 'b-ala-e', rule: 'geo' });
});

test('geo: в городе заказа нет филиалов — ближайший из всех', () => {
  const res = assignBranch(order({ city: 'Талгар', lat: 43.29, lon: 76.96 }), [alaWest, alaEast, konaev]);
  assert.deepEqual(res, { orderId: 'o-1', branchId: 'b-kon', rule: 'geo' });
});

test('лимит: заполненный филиал пропускается', () => {
  const ast = { ...astana, pickupPointIds: ['pp-ast'] };
  const res = assignBranch(order({ pickupPointId: 'pp-ast' }), [almaty, ast], full('b-ast'));
  assert.deepEqual(res, { orderId: 'o-1', branchId: 'b-ala', rule: 'geo' });
});

test('лимит: запасной филиал — ближайший незаполненный', () => {
  const res = assignBranch(order({ lat: 43.29, lon: 76.96 }), [alaWest, alaEast, konaev], full('b-ala-e'));
  assert.deepEqual(res, { orderId: 'o-1', branchId: 'b-kon', rule: 'geo' });
});

test('лимит: все филиалы заполнены — unassigned', () => {
  const res = assignBranch(order({}), [almaty, astana], full('b-ala', 'b-ast'));
  assert.deepEqual(res, { orderId: 'o-1', branchId: null, rule: 'unassigned' });
});

test('лимит: единственный филиал заполнен — unassigned', () => {
  const res = assignBranch(order({}), [almaty], full('b-ala'));
  assert.deepEqual(res, { orderId: 'o-1', branchId: null, rule: 'unassigned' });
});

test('лимит: без координат запасной филиал не выбрать', () => {
  const res = assignBranch(order({ city: 'Астана', lat: null, lon: null }), [almaty, astana], full('b-ast'));
  assert.deepEqual(res, { orderId: 'o-1', branchId: null, rule: 'unassigned' });
});

test('лимит: manual не проверяет лимит', () => {
  const res = assignBranch(order({ manualBranchId: 'b-ast' }), [almaty, astana], full('b-ast'));
  assert.deepEqual(res, { orderId: 'o-1', branchId: 'b-ast', rule: 'manual' });
});

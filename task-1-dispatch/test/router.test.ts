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

test('pickup_point: пункт выдачи закреплён за филиалом', () => {
  const withPoint = { ...astana, pickupPointIds: ['pp-1'] };
  const res = assignBranch(order({ pickupPointId: 'pp-1' }), [almaty, withPoint]);
  assert.deepEqual(res, { orderId: 'o-1', branchId: 'b-ast', rule: 'pickup_point' });
});

test('pickup_point: пункт неактивного филиала не срабатывает', () => {
  const closed = { ...astana, active: false, pickupPointIds: ['pp-1'] };
  const second = branch({ id: 'b-ala-2', lat: 43.3, lon: 76.8 });
  const res = assignBranch(order({ pickupPointId: 'pp-1' }), [almaty, second, closed]);
  assert.notEqual(res.rule, 'pickup_point');
});

test('city: в городе заказа один филиал магазина', () => {
  // по координатам заказ ближе к Алматы, но город важнее
  const res = assignBranch(order({ city: 'Астана' }), [almaty, astana]);
  assert.deepEqual(res, { orderId: 'o-1', branchId: 'b-ast', rule: 'city' });
});

test('city: неактивные филиалы не считаются', () => {
  const closed = branch({ id: 'b-ala-2', active: false });
  const res = assignBranch(order({}), [almaty, closed, astana]);
  assert.deepEqual(res, { orderId: 'o-1', branchId: 'b-ala', rule: 'city' });
});

test('city: город без координат заказа всё равно срабатывает', () => {
  const res = assignBranch(order({ lat: null, lon: null }), [almaty, astana]);
  assert.deepEqual(res, { orderId: 'o-1', branchId: 'b-ala', rule: 'city' });
});

test('geo: если в городе несколько филиалов, выбирается ближайший из них', () => {
  // филиал другого города ближе к заказу, но в городе заказа выбор есть
  const far = branch({ id: 'b-ala-far', lat: 43.4, lon: 77.1 });
  const near = branch({ id: 'b-ala-near', lat: 43.3, lon: 77.0 });
  const other = branch({ id: 'b-other', city: 'Конаев', lat: 43.25, lon: 76.93 });
  const res = assignBranch(order({ lat: 43.25, lon: 76.93 }), [far, near, other]);
  assert.deepEqual(res, { orderId: 'o-1', branchId: 'b-ala-near', rule: 'geo' });
});

test('geo: в городе заказа нет филиалов, выбирается ближайший из всех', () => {
  const res = assignBranch(order({ city: 'Астана', lat: 51.1, lon: 71.4 }), [almaty, branch({ id: 'b-ast', city: 'Кокшетау', lat: 53.28, lon: 69.39 })]);
  assert.deepEqual(res, { orderId: 'o-1', branchId: 'b-ast', rule: 'geo' });
});

test('в расчёт идут только филиалы своего магазина', () => {
  const foreign = branch({ id: 'b-foreign', storeId: 's-2' });
  const res = assignBranch(order({ manualBranchId: 'b-foreign', pickupPointId: null }), [almaty, foreign]);
  assert.deepEqual(res, { orderId: 'o-1', branchId: 'b-ala', rule: 'single' });
});

test('нет активных филиалов магазина — unassigned', () => {
  const res = assignBranch(order({}), [{ ...almaty, active: false }]);
  assert.deepEqual(res, { orderId: 'o-1', branchId: null, rule: 'unassigned' });
});

const near = branch({ id: 'b-near', lat: 43.26, lon: 76.93, dailyLimit: 2 });
const mid = branch({ id: 'b-mid', lat: 43.3, lon: 76.95, dailyLimit: 2 });
const far = branch({ id: 'b-far', lat: 43.4, lon: 77.1, dailyLimit: 2 });
const full = (...ids: string[]) => (id: string) => (ids.includes(id) ? 2 : 0);

test('лимит: заполненный филиал пропускается', () => {
  const res = assignBranch(order({}), [near, mid, far], full('b-near'));
  assert.deepEqual(res, { orderId: 'o-1', branchId: 'b-mid', rule: 'geo' });
});

test('лимит: филиал с запасом остаётся выбранным', () => {
  const res = assignBranch(order({}), [near, mid], (id) => (id === 'b-near' ? 1 : 0));
  assert.deepEqual(res, { orderId: 'o-1', branchId: 'b-near', rule: 'geo' });
});

test('лимит: заполнены все, кроме дальнего', () => {
  const res = assignBranch(order({}), [near, mid, far], full('b-near', 'b-mid'));
  assert.deepEqual(res, { orderId: 'o-1', branchId: 'b-far', rule: 'geo' });
});

test('лимит: заполнены все филиалы — unassigned', () => {
  const res = assignBranch(order({}), [near, mid], full('b-near', 'b-mid'));
  assert.deepEqual(res, { orderId: 'o-1', branchId: null, rule: 'unassigned' });
});

test('лимит: pickup_point заполнен — заказ уходит с правилом geo', () => {
  const withPoint = { ...far, pickupPointIds: ['pp-1'] };
  const res = assignBranch(order({ pickupPointId: 'pp-1' }), [near, withPoint], full('b-far'));
  assert.deepEqual(res, { orderId: 'o-1', branchId: 'b-near', rule: 'geo' });
});

test('лимит: city заполнен — запасной филиал может быть в другом городе', () => {
  const other = { ...mid, city: 'Конаев' };
  const res = assignBranch(order({}), [near, other], full('b-near'));
  assert.deepEqual(res, { orderId: 'o-1', branchId: 'b-mid', rule: 'geo' });
});

test('лимит: single заполнен — unassigned', () => {
  const res = assignBranch(order({}), [near], full('b-near'));
  assert.deepEqual(res, { orderId: 'o-1', branchId: null, rule: 'unassigned' });
});

test('лимит: без координат заменить заполненный филиал нечем', () => {
  const other = { ...mid, city: 'Конаев' };
  const res = assignBranch(order({ lat: null, lon: null }), [near, other], full('b-near'));
  assert.deepEqual(res, { orderId: 'o-1', branchId: null, rule: 'unassigned' });
});

test('лимит: manual не проверяет лимит', () => {
  const res = assignBranch(order({ manualBranchId: 'b-near' }), [near, mid], full('b-near'));
  assert.deepEqual(res, { orderId: 'o-1', branchId: 'b-near', rule: 'manual' });
});

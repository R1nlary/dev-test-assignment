// @rev kc-31
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHandler } from '../src/app.ts';
import { branches, orders } from '../src/store.ts';

async function start(t: TestContext) {
  const server = createServer(createHandler(branches, orders));
  await new Promise<void>((resolve) => server.listen(0, resolve));
  t.after(() => server.close());
  const base = `http://localhost:${(server.address() as AddressInfo).port}`;

  return {
    assign: async (id: string) => {
      const res = await fetch(`${base}/orders/${id}/assign`, { method: 'POST' });
      return { status: res.status, body: await res.json() };
    },
    load: async (path: string) => {
      const res = await fetch(`${base}/branches/${path}`);
      return { status: res.status, body: await res.json() };
    },
  };
}

test('POST /orders/:id/assign: распределяет заказ', async (t) => {
  const api = await start(t);
  const res = await api.assign('o-101');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { orderId: 'o-101', branchId: 'b-ala-1', rule: 'pickup_point' });
});

test('POST /orders/:id/assign: нет заказа — 404', async (t) => {
  const api = await start(t);
  const res = await api.assign('o-nope');
  assert.equal(res.status, 404);
});

test('POST /orders/:id/assign: повторный вызов не занимает лимит ещё раз', async (t) => {
  const api = await start(t);
  const first = await api.assign('o-101');
  const second = await api.assign('o-101');
  assert.deepEqual(second.body, first.body);

  const load = await api.load('b-ala-1/load?date=2026-11-16');
  assert.deepEqual(load.body, { branchId: 'b-ala-1', date: '2026-11-16', assigned: 1, limit: 3 });
});

test('лимит: четвёртый заказ за сутки уходит в другой филиал, следующие сутки — снова в свой', async (t) => {
  const api = await start(t);
  for (const id of ['o-101', 'o-109', 'o-110']) {
    assert.equal((await api.assign(id)).body.branchId, 'b-ala-1');
  }
  assert.deepEqual((await api.assign('o-111')).body, { orderId: 'o-111', branchId: 'b-ala-2', rule: 'geo' });

  assert.deepEqual((await api.assign('o-112')).body, { orderId: 'o-112', branchId: 'b-ala-1', rule: 'pickup_point' });

  assert.equal((await api.load('b-ala-1/load?date=2026-11-16')).body.assigned, 3);
  assert.equal((await api.load('b-ala-1/load?date=2026-11-17')).body.assigned, 1);
  assert.equal((await api.load('b-ala-2/load?date=2026-11-16')).body.assigned, 1);
});

test('GET /branches/:id/load: нет даты или дата некорректная — 400', async (t) => {
  const api = await start(t);
  assert.equal((await api.load('b-ala-1/load')).status, 400);
  assert.equal((await api.load('b-ala-1/load?date=2026-02-30')).status, 400);
  assert.equal((await api.load('b-ala-1/load?date=tomorrow')).status, 400);
});

test('GET /branches/:id/load: нет филиала — 404', async (t) => {
  const api = await start(t);
  assert.equal((await api.load('b-nope/load?date=2026-11-16')).status, 404);
});

test('GET /branches/:id/load: пустой день — 0', async (t) => {
  const api = await start(t);
  const res = await api.load('b-ast-1/load?date=2026-11-16');
  assert.deepEqual(res.body, { branchId: 'b-ast-1', date: '2026-11-16', assigned: 0, limit: 40 });
});

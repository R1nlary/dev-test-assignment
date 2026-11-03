import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

async function startServer() {
  const port = 30000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, ['--experimental-strip-types', fileURLToPath(new URL('../src/server.ts', import.meta.url))], {
    env: { ...process.env, PORT: String(port), NOW: '2030-11-18T01:00:00.000Z' },
    stdio: 'ignore',
  });
  const url = `http://localhost:${port}`;
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error('Booking server did not start');
    try {
      const response = await fetch(`${url}/masters`);
      if (response.ok) return { child, url };
    } catch { /* server is still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  child.kill();
  throw new Error('Booking server did not start');
}

test('API: два клиента не могут забронировать один слот одновременно', async () => {
  const { child, url } = await startServer();
  try {
    const request = (clientPhone: string) => fetch(`${url}/bookings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        masterId: 'm-1', serviceId: 's-cut', start: '2030-11-18T15:00:00+05:00', clientPhone,
      }),
    });
    const [a, b] = await Promise.all([request('87012345678'), request('+7 707 123 45 67')]);
    assert.deepEqual([a.status, b.status].sort(), [201, 409]);

    const success = a.status === 201 ? a : b;
    const conflict = a.status === 409 ? a : b;
    const booking = await success.json() as { id: string; status: string; clientPhone: string };
    assert.equal(booking.status, 'active');
    assert.match(booking.clientPhone, /^\+7\d{10}$/);
    assert.deepEqual(await conflict.json(), { error: 'slot_unavailable' });

    const cancel = await fetch(`${url}/bookings/${booking.id}`, { method: 'DELETE' });
    assert.equal(cancel.status, 200);
    assert.equal((await cancel.json() as { status: string }).status, 'cancelled');
    const cancelAgain = await fetch(`${url}/bookings/${booking.id}`, { method: 'DELETE' });
    assert.equal(cancelAgain.status, 200);
  } finally {
    child.kill();
  }
});

test('API: доступные слоты и валидация запросов', async () => {
  const { child, url } = await startServer();
  try {
    const response = await fetch(`${url}/masters/m-1/slots?serviceId=s-cut&date=2030-11-18`);
    assert.equal(response.status, 200);
    const data = await response.json() as { slots: string[] };
    assert.ok(data.slots.includes('15:00'));
    assert.ok(!data.slots.includes('10:00'));
    assert.ok(!data.slots.includes('14:00'));

    const invalidDate = await fetch(`${url}/masters/m-1/slots?serviceId=s-cut&date=2030-02-30`);
    assert.equal(invalidDate.status, 400);
    const wrongPhone = await fetch(`${url}/bookings`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ masterId: 'm-1', serviceId: 's-cut', start: '2030-11-18T17:00+05:00', clientPhone: '123' }),
    });
    assert.equal(wrongPhone.status, 400);
  } finally {
    child.kill();
  }
});

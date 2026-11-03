import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

async function startServer() {
  const port = 30000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, ['--experimental-strip-types', fileURLToPath(new URL('../src/server.ts', import.meta.url))], {
    env: { ...process.env, PORT: String(port) },
    stdio: 'ignore',
  });
  const url = `http://localhost:${port}`;
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error('Dispatch server did not start');
    try {
      const response = await fetch(`${url}/branches`);
      if (response.ok) return { child, url };
    } catch { /* server is still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  child.kill();
  throw new Error('Dispatch server did not start');
}

test('API: повторное распределение не увеличивает нагрузку', async () => {
  const { child, url } = await startServer();
  try {
    const first = await fetch(`${url}/orders/o-101/assign`, { method: 'POST' });
    assert.equal(first.status, 200);
    const assignment = await first.json() as { branchId: string; rule: string };
    assert.equal(assignment.branchId, 'b-ala-1');
    assert.equal(assignment.rule, 'pickup_point');

    const second = await fetch(`${url}/orders/o-101/assign`, { method: 'POST' });
    assert.equal(second.status, 200);
    assert.deepEqual(await second.json(), assignment);

    const load = await fetch(`${url}/branches/b-ala-1/load?date=2026-11-16`);
    assert.equal(load.status, 200);
    const data = await load.json() as { assigned: number; limit: number };
    assert.equal(data.assigned, 1);
    assert.equal(data.limit, 3);
    assert.equal((await fetch(`${url}/branches/b-ala-1/load?date=2026-02-31`)).status, 400);
    assert.equal((await fetch(`${url}/orders/unknown/assign`, { method: 'POST' })).status, 404);
  } finally {
    child.kill();
  }
});

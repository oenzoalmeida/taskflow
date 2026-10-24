import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createRateLimitCleanup } from './maintenance.js';

async function request(options, authorization) {
  let calls = 0;
  const app = express();
  app.get('/cleanup', createRateLimitCleanup({ async query() {
    calls++;
    if (options.offline) throw new Error('database detail must stay private');
    return { rowCount: 7 };
  } }, { secret: options.secret, logger: { error() {} } }));
  const server = await new Promise(resolve => {
    const value = app.listen(0, '127.0.0.1', () => resolve(value));
  });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/cleanup`, {
      headers: authorization ? { authorization } : {}
    });
    return { status: response.status, cache: response.headers.get('cache-control'),
      body: await response.json(), calls };
  } finally { await new Promise(resolve => server.close(resolve)); }
}
const secret = 'unit-test-maintenance-secret';
test('missing or short configuration fails closed without querying the database', async () => {
  for (const value of ['', 'short']) {
    const result = await request({ secret: value });
    assert.equal(result.status, 503);
    assert.equal(result.calls, 0);
  }
});
test('missing, malformed and wrong credentials cannot trigger deletion', async () => {
  for (const value of [undefined, 'Bearer wrong', secret, `bearer ${secret}`]) {
    const result = await request({ secret }, value);
    assert.equal(result.status, 401);
    assert.equal(result.calls, 0);
    assert.equal(result.cache, 'no-store');
  }
});
test('valid credentials execute one batch and return only its count', async () => {
  const result = await request({ secret }, `Bearer ${secret}`);
  assert.equal(result.status, 200);
  assert.equal(result.calls, 1);
  assert.deepEqual(result.body, { deleted: 7, batchLimit: 5000 });
});
test('database failure returns a generic 503 without exposing details', async () => {
  const result = await request({ secret, offline: true }, `Bearer ${secret}`);
  assert.equal(result.status, 503);
  assert.deepEqual(result.body, { error: 'Maintenance unavailable' });
});

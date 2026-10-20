import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import express from 'express';
import { createAuthRateLimit, databaseOptions } from './security.js';

const options = { ...databaseOptions(), max: 5 };
const pools = [new pg.Pool(options), new pg.Pool(options)];
const keys = [];
function response() {
  return { setHeader() {}, status(code) { this.code = code; return this; }, json() {} };
}
test.after(async () => {
  try { await pools[0].query('DELETE FROM auth_rate_limit WHERE key = ANY($1::text[])', [keys]); }
  finally { await Promise.all(pools.map(pool => pool.end())); }
});
test('40 concurrent attempts across two pools share exactly one quota', async () => {
  const key = `ci-${randomUUID()}`;
  keys.push(key);
  const limits = pools.map(pool => createAuthRateLimit(pool, { max: 10, windowMs: 60000 }));
  let accepted = 0;
  const codes = await Promise.all(Array.from({ length: 40 }, async (_, i) => {
    const res = response();
    await limits[i % 2]({ ip: key }, res, () => accepted++);
    return res.code;
  }));
  assert.equal(accepted, 10);
  assert.equal(codes.filter(code => code === 429).length, 30);
  const result = await pools[0].query('SELECT hits FROM auth_rate_limit WHERE key=$1', [key]);
  assert.equal(result.rows[0].hits, 40);
});
test('expired quota resets atomically', async () => {
  const key = `ci-${randomUUID()}`;
  keys.push(key);
  await pools[0].query("INSERT INTO auth_rate_limit VALUES ($1, 100, now() - interval '1 second')", [key]);
  let accepted = false;
  await createAuthRateLimit(pools[1], { max: 10, windowMs: 60000 })({ ip: key }, response(), () => { accepted = true; });
  assert.equal(accepted, true);
  const result = await pools[0].query('SELECT hits FROM auth_rate_limit WHERE key=$1', [key]);
  assert.equal(result.rows[0].hits, 1);
});
test('HTTP outage returns 503 and forwarded-header changes never reach authentication', async () => {
  const app = express();
  app.set('trust proxy', 0);
  let authCalls = 0;
  const ips = new Set();
  app.post('/login', createAuthRateLimit({ async query(_sql, values) {
    ips.add(values[0]);
    throw Object.assign(new Error('offline'), { code: '08006' });
  } }, { max: 10, windowMs: 60000, logger: { error() {} } }), (_req, res) => { authCalls++; res.sendStatus(200); });
  const server = await new Promise(resolve => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); });
  try {
    for (let i = 0; i < 4; i++) {
      const result = await fetch(`http://127.0.0.1:${server.address().port}/login`, { method: 'POST', headers: { 'X-Forwarded-For': `192.0.2.${i}` } });
      assert.equal(result.status, 503);
      assert.equal(result.headers.get('retry-after'), '5');
      await result.json();
    }
    assert.equal(authCalls, 0);
    assert.equal(ips.size, 1);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

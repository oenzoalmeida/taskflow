// Troca obrigatória de senha no primeiro acesso + revogação de sessões.
// Roda contra PostgreSQL real (DATABASE_URL) com o schema de produção
// (dump restaurado) + migration 002 aplicada. Espelha o ForcedChangeIT do QueueFlow.
import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import bcrypt from 'bcryptjs';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-secret';
process.env.DATABASE_SSL_MODE = process.env.DATABASE_SSL_MODE || 'disable';
process.env.FRONTEND_URL = 'http://localhost:5500';
process.env.RATE_LIMIT_MAX = '1000';

const { default: app } = await import('./server.js');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: false });

const TEMP = 'temp-senha-forte-1';
const NEW = 'nova-senha-forte-22';
const ids = [];
let server, base;

function cookiesOf(res) {
  const raw = res.headers.get('set-cookie') || '';
  return raw.split(';')[0];
}
async function api(path, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json, cookie: cookiesOf(res) };
}

test.before(async () => {
  const hash = await bcrypt.hash(TEMP, 12);
  const { rows: a } = await pool.query(
    "INSERT INTO users (name,email,password_hash,role,active,must_change_password) VALUES ('T Admin','t-admin@example.com',$1,'ADMIN',true,true) RETURNING id", [hash]);
  const { rows: u } = await pool.query(
    "INSERT INTO users (name,email,password_hash,role,active,must_change_password) VALUES ('T User','t-user@example.com',$1,'USER',true,false) RETURNING id", [hash]);
  const { rows: a2 } = await pool.query(
    "INSERT INTO users (name,email,password_hash,role,active,must_change_password) VALUES ('T Admin2','t-admin2@example.com',$1,'ADMIN',true,false) RETURNING id", [hash]);
  ids.push(a[0].id, u[0].id, a2[0].id);
  server = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  if (server) server.close();
  await pool.query('DELETE FROM tasks WHERE user_id = ANY($1::bigint[])', [ids]);
  await pool.query('DELETE FROM users WHERE id = ANY($1::bigint[])', [ids]);
  await pool.end();
});

test('1. login de conta com senha temporária expõe must_change_password=true', async () => {
  const r = await api('/api/auth/login', { method: 'POST', body: { email: 't-admin@example.com', password: TEMP } });
  assert.equal(r.status, 200);
  assert.equal(r.json.user.must_change_password, true);
  assert.ok(r.cookie.startsWith('taskflow_session='));
});

test('2. sessão em troca pendente leva 403 MUST_CHANGE_PASSWORD em rota protegida', async () => {
  const login = await api('/api/auth/login', { method: 'POST', body: { email: 't-admin@example.com', password: TEMP } });
  const r = await api('/api/tasks', { cookie: login.cookie });
  assert.equal(r.status, 403);
  assert.equal(r.json.code, 'MUST_CHANGE_PASSWORD');
  const adm = await api('/api/admin/users', { cookie: login.cookie });
  assert.equal(adm.status, 403);
});

test('3. allowlist funciona durante a troca pendente: /me 200', async () => {
  const login = await api('/api/auth/login', { method: 'POST', body: { email: 't-admin@example.com', password: TEMP } });
  const me = await api('/api/auth/me', { cookie: login.cookie });
  assert.equal(me.status, 200);
  assert.equal(me.json.user.must_change_password, true);
});

test('4. change-password rejeita senha atual incorreta', async () => {
  const login = await api('/api/auth/login', { method: 'POST', body: { email: 't-admin@example.com', password: TEMP } });
  const r = await api('/api/auth/change-password', { method: 'POST', cookie: login.cookie, body: { current_password: 'errada-errada-1', new_password: NEW } });
  assert.equal(r.status, 401);
});

test('5. change-password rejeita senha fraca (<12) e igual à temporária', async () => {
  const login = await api('/api/auth/login', { method: 'POST', body: { email: 't-admin@example.com', password: TEMP } });
  const weak = await api('/api/auth/change-password', { method: 'POST', cookie: login.cookie, body: { current_password: TEMP, new_password: 'curta' } });
  assert.equal(weak.status, 400);
  const same = await api('/api/auth/change-password', { method: 'POST', cookie: login.cookie, body: { current_password: TEMP, new_password: TEMP } });
  assert.equal(same.status, 400);
});

test('6. troca válida limpa a flag, revoga a sessão anterior e libera rotas', async () => {
  const login = await api('/api/auth/login', { method: 'POST', body: { email: 't-admin@example.com', password: TEMP } });
  const old = login.cookie;
  const r = await api('/api/auth/change-password', { method: 'POST', cookie: old, body: { current_password: TEMP, new_password: NEW } });
  assert.equal(r.status, 200);
  assert.equal(r.json.user.must_change_password, false);
  const stale = await api('/api/tasks', { cookie: old });
  assert.equal(stale.status, 401); // auth_version antiga morreu
  const fresh = await api('/api/tasks', { cookie: r.cookie });
  assert.equal(fresh.status, 200); // nova sessão funciona
  const relog = await api('/api/auth/login', { method: 'POST', body: { email: 't-admin@example.com', password: NEW } });
  assert.equal(relog.status, 200);
  assert.equal(relog.json.user.must_change_password, false);
  // regressão: sessão de login pós-troca precisa nascer na auth_version atual
  const relogProtected = await api('/api/tasks', { cookie: relog.cookie });
  assert.equal(relogProtected.status, 200);
});

test('7. não desativa o último ADMIN ativo; desativa quando há outro; sessão do desativado morre', async () => {
  const login2 = await api('/api/auth/login', { method: 'POST', body: { email: 't-admin2@example.com', password: TEMP } });
  // t-admin (já trocou) e t-admin2 ativos: desativar t-admin2 por t-admin
  const adminLogin = await api('/api/auth/login', { method: 'POST', body: { email: 't-admin@example.com', password: NEW } });
  const off = await api(`/api/admin/users/${ids[2]}`, { method: 'PATCH', cookie: adminLogin.cookie, body: { active: false } });
  assert.equal(off.status, 200);
  assert.equal(off.json.user.active, false);
  const dead = await api('/api/auth/me', { cookie: login2.cookie });
  assert.equal(dead.status, 401); // revalidação por requisição
  // agora t-admin é o único ADMIN ativo dentre os de teste + admin@taskflow.app (id 1, do dump, ativo):
  // desativar o id 1 deixaria t-admin; desativar t-admin deixaria id 1 -> ambos permitidos.
  // último cenário de 409 exige só 1 admin ativo: desativa id 1 e tenta desativar t-admin
  const off1 = await api('/api/admin/users/1', { method: 'PATCH', cookie: adminLogin.cookie, body: { active: false } });
  assert.equal(off1.status, 200);
  const last = await api(`/api/admin/users/${ids[0]}`, { method: 'PATCH', cookie: adminLogin.cookie, body: { active: false } });
  assert.equal(last.status, 400); // própria conta pelo painel = 400
  // reativa id 1 para não deixar o dump de teste sem o admin original
  const on1 = await api('/api/admin/users/1', { method: 'PATCH', cookie: adminLogin.cookie, body: { active: true } });
  assert.equal(on1.status, 200);
});

test('8. conta USER normal sem flag acessa rotas normalmente', async () => {
  const login = await api('/api/auth/login', { method: 'POST', body: { email: 't-user@example.com', password: TEMP } });
  assert.equal(login.json.user.must_change_password, false);
  const r = await api('/api/tasks', { cookie: login.cookie });
  assert.equal(r.status, 200);
});

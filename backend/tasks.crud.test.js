// Testes funcionais do CRUD de tarefas e do isolamento de dados entre contas.
// Sobem o servidor real (processo filho de server.js) contra o PostgreSQL de
// teste definido em DATABASE_URL — nunca contra produção. O filho é encerrado
// ao final, então nenhuma conexão fica aberta no processo do test runner.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const databaseUrl = process.env.DATABASE_URL;
assert.ok(databaseUrl, 'DATABASE_URL é obrigatória para tasks.crud.test.js');

// Schema mínimo (idempotente): mesmo DDL do passo "Create schema" do CI, mais
// a migration do limitador de autenticação. Torna o teste autocontido também
// fora do GitHub Actions.
const setup = new pg.Pool({ connectionString: databaseUrl, max: 1 });
await setup.query(`CREATE TABLE IF NOT EXISTS users (id serial PRIMARY KEY, name text NOT NULL, email text NOT NULL UNIQUE, password_hash text NOT NULL, role text NOT NULL DEFAULT 'USER', active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now())`);
await setup.query(`CREATE TABLE IF NOT EXISTS tasks (id serial PRIMARY KEY, user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE, title text NOT NULL, completed boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`);
await setup.query(await readFile(new URL('./migrations/001_auth_rate_limit.sql', import.meta.url), 'utf8'));
await setup.end();

const port = 30000 + Math.floor(Math.random() * 20000);
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['server.js'], {
  env: {
    ...process.env,
    PORT: String(port),
    NODE_ENV: 'test',
    JWT_SECRET: process.env.JWT_SECRET || 'tasks-crud-test-secret',
    RATE_LIMIT_MAX: '100',
    RATE_LIMIT_WINDOW_MS: '60000',
    FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:5500',
  },
  stdio: ['ignore', 'inherit', 'inherit'],
});
test.after(async () => { child.kill('SIGTERM'); });

// Aguarda o /health responder antes do primeiro teste.
{
  const deadline = Date.now() + 30000;
  for (;;) {
    try {
      const res = await fetch(`${base}/health`);
      if (res.ok) break;
    } catch { /* servidor ainda subindo */ }
    if (Date.now() > deadline) throw new Error('servidor não respondeu /health em 30s');
    await new Promise(resolve => setTimeout(resolve, 250));
  }
}

function sessionCookie(res) {
  const cookie = (res.headers.getSetCookie?.() || []).find(c => c.startsWith('taskflow_session='));
  assert.ok(cookie, 'resposta de autenticação deve definir taskflow_session');
  return cookie.split(';')[0];
}

async function registerUser(label) {
  const res = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `Teste ${label}`,
      email: `tf-crud-${randomUUID()}@example.com`,
      password: `senha-teste-${randomUUID()}`,
    }),
  });
  assert.equal(res.status, 201, `registro de ${label} deve retornar 201`);
  return sessionCookie(res);
}

const api = (cookie, method, path, body) => fetch(`${base}${path}`, {
  method,
  headers: {
    ...(cookie ? { Cookie: cookie } : {}),
    ...(body ? { 'Content-Type': 'application/json' } : {}),
  },
  ...(body ? { body: JSON.stringify(body) } : {}),
});

const cookieA = await registerUser('A');
const cookieB = await registerUser('B');

test.after(async () => {
  for (const cookie of [cookieA, cookieB]) {
    try { await api(cookie, 'DELETE', '/api/account'); } catch { /* limpeza best-effort */ }
  }
});

test('lista de tarefas exige autenticação', async () => {
  const res = await api(null, 'GET', '/api/tasks');
  assert.equal(res.status, 401);
});

test('CRUD completo do próprio usuário', async () => {
  const primeira = await api(cookieA, 'POST', '/api/tasks', { title: 'Primeira tarefa' });
  assert.equal(primeira.status, 201);
  const { task: t1 } = await primeira.json();
  assert.equal(t1.title, 'Primeira tarefa');
  assert.equal(t1.completed, false);

  await api(cookieA, 'POST', '/api/tasks', { title: 'Segunda tarefa' });

  const lista = await api(cookieA, 'GET', '/api/tasks');
  const { tasks } = await lista.json();
  assert.equal(tasks.length, 2);

  const patch = await api(cookieA, 'PATCH', `/api/tasks/${t1.id}`, { completed: true });
  assert.equal(patch.status, 200);
  const { task: done } = await patch.json();
  assert.equal(done.completed, true);
  assert.ok(new Date(done.updated_at) >= new Date(done.created_at));

  const del = await api(cookieA, 'DELETE', `/api/tasks/${t1.id}`);
  assert.equal(del.status, 204);
  const depois = await (await api(cookieA, 'GET', '/api/tasks')).json();
  assert.equal(depois.tasks.length, 1);
});

test('validação rejeita tarefa vazia ou longa demais', async () => {
  assert.equal((await api(cookieA, 'POST', '/api/tasks', { title: '   ' })).status, 400);
  assert.equal((await api(cookieA, 'POST', '/api/tasks', { title: 'x'.repeat(241) })).status, 400);
});

test('usuário B não enxerga nem altera tarefas do usuário A', async () => {
  const criada = await api(cookieA, 'POST', '/api/tasks', { title: 'Tarefa privada de A' });
  const { task } = await criada.json();

  // B não lista nada que não seja dele.
  const listaB = await (await api(cookieB, 'GET', '/api/tasks')).json();
  assert.equal(listaB.tasks.length, 0);

  // PATCH/DELETE com o id de A respondem 404 (sem vazar existência) e não alteram nada.
  assert.equal((await api(cookieB, 'PATCH', `/api/tasks/${task.id}`, { completed: true })).status, 404);
  assert.equal((await api(cookieB, 'DELETE', `/api/tasks/${task.id}`)).status, 404);

  const listaA = await (await api(cookieA, 'GET', '/api/tasks')).json();
  const intacta = listaA.tasks.find(t => t.id === task.id);
  assert.ok(intacta, 'tarefa de A deve continuar existindo');
  assert.equal(intacta.completed, false);
});

test('rotas administrativas exigem papel ADMIN', async () => {
  assert.equal((await api(cookieA, 'GET', '/api/admin/overview')).status, 403);
  assert.equal((await api(cookieA, 'GET', '/api/admin/users')).status, 403);
});

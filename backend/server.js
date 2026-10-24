import { createRateLimitCleanup } from './maintenance.js';
import { databaseOptions, positiveInteger, proxyHops, createAuthRateLimit } from './security.js';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import { pathToFileURL } from 'node:url';

const { Pool } = pg;
const app = express();
const port = process.env.PORT || 10000;
// FRONTEND_URL aceita uma ou mais origens separadas por vírgula (transição
// Render -> Cloudflare Pages). Com um único valor (ou o default), o
// comportamento permanece idêntico ao anterior (origin fixa).
const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5500';
const frontendOrigins = frontendUrl.split(',').map(origin => origin.trim()).filter(Boolean);
const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) throw new Error('JWT_SECRET is required');

const pool = new Pool(databaseOptions());
pool.on('error', () => console.error('Database pool unavailable'));
app.set('trust proxy', proxyHops());
app.use(cors({ origin: frontendOrigins.length > 1 ? frontendOrigins : frontendUrl, credentials: true }));
app.use(express.json({ limit: '256kb' }));
app.use(cookieParser());

const authRateLimit = createAuthRateLimit(pool, {
  max: positiveInteger(process.env.RATE_LIMIT_MAX, 10, 'RATE_LIMIT_MAX'),
  windowMs: positiveInteger(process.env.RATE_LIMIT_WINDOW_MS, 60000, 'RATE_LIMIT_WINDOW_MS')
});

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000,
  path: '/'
};

function signUser(user) {
  return jwt.sign({ sub: String(user.id), role: user.role, email: user.email, name: user.name }, jwtSecret, { expiresIn: '7d' });
}

function requireAuth(req, res, next) {
  let payload;
  try {
    const token = req.cookies.taskflow_session;
    if (!token) return res.status(401).json({ error: 'Não autenticado' });
    payload = jwt.verify(token, jwtSecret);
  } catch {
    return res.status(401).json({ error: 'Sessão inválida ou expirada' });
  }

  // Revalida o usuário a cada requisição: desativação e mudanças de papel
  // devem ter efeito imediato, mesmo para tokens ainda não expirados.
  Promise.resolve()
    .then(() => pool.query('SELECT id, role, active FROM users WHERE id=$1', [payload.sub]))
    .then(({ rows }) => {
      const user = rows[0];
      if (!user || !user.active) return res.status(401).json({ error: 'Conta inativa ou inexistente' });
      req.user = { ...payload, sub: user.id, role: user.role };
      next();
    })
    .catch(next);
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'ADMIN') return res.status(403).json({ error: 'Acesso restrito ao administrador' });
  next();
}

// Express 4 não captura rejeições em handlers async: sem isto, um erro de DB
// deixa a requisição pendurada até timeout do cliente. Envolve cada handler e
// encaminha o erro ao middleware final, que responde 500 genérico (sem vazar
// detalhes internos) e registra a causa no log do servidor.
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

app.get('/api/internal/maintenance/rate-limits', createRateLimitCleanup(pool));

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'taskflow' }));

app.post('/api/auth/register', authRateLimit, asyncHandler(async (req, res) => {
  const name = String(req.body?.name || '').trim();
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (name.length < 2 || !email.includes('@') || password.length < 12) {
    return res.status(400).json({ error: 'Preencha nome, e-mail válido e senha com pelo menos 12 caracteres' });
  }
  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const { rows } = await pool.query(
      `INSERT INTO users (name,email,password_hash,role,active) VALUES ($1,$2,$3,'USER',true)
       RETURNING id,name,email,role,active`,
      [name, email, passwordHash]
    );
    const user = rows[0];
    res.cookie('taskflow_session', signUser(user), cookieOptions).status(201).json({ user });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Este e-mail já está cadastrado' });
    console.error(err);
    res.status(500).json({ error: 'Não foi possível criar a conta' });
  }
}));

app.post('/api/auth/login', authRateLimit, asyncHandler(async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  try {
    const { rows } = await pool.query('SELECT * FROM users WHERE lower(email)=lower($1) LIMIT 1', [email]);
    const user = rows[0];
    if (!user || !user.active || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'E-mail ou senha inválidos' });
    }
    const safeUser = { id: user.id, name: user.name, email: user.email, role: user.role, active: user.active };
    res.cookie('taskflow_session', signUser(safeUser), cookieOptions).json({ user: safeUser });
  } catch (err) {
    // Erro de DB/inesperado não pode derrubar o processo com unhandled rejection.
    console.error('login error:', err);
    res.status(500).json({ error: 'Erro interno ao autenticar. Tente novamente.' });
  }
}));

app.post('/api/auth/logout', (_req, res) => {
  res.clearCookie('taskflow_session', { ...cookieOptions, maxAge: undefined }).status(204).end();
});

app.get('/api/auth/me', requireAuth, asyncHandler(async (req, res) => {
  const { rows } = await pool.query('SELECT id,name,email,role,active FROM users WHERE id=$1', [req.user.sub]);
  if (!rows[0] || !rows[0].active) return res.status(401).json({ error: 'Conta indisponível' });
  res.json({ user: rows[0] });
}));

app.get('/api/tasks', requireAuth, asyncHandler(async (req, res) => {
  const { rows } = await pool.query('SELECT id,title,completed,created_at,updated_at FROM tasks WHERE user_id=$1 ORDER BY created_at DESC', [req.user.sub]);
  res.json({ tasks: rows });
}));

app.post('/api/tasks', requireAuth, asyncHandler(async (req, res) => {
  const title = String(req.body?.title || '').trim();
  if (!title || title.length > 240) return res.status(400).json({ error: 'Informe uma tarefa válida' });
  const { rows } = await pool.query('INSERT INTO tasks (user_id,title) VALUES ($1,$2) RETURNING id,title,completed,created_at,updated_at', [req.user.sub, title]);
  res.status(201).json({ task: rows[0] });
}));

app.patch('/api/tasks/:id', requireAuth, asyncHandler(async (req, res) => {
  const completed = Boolean(req.body?.completed);
  const { rows } = await pool.query(
    'UPDATE tasks SET completed=$1, updated_at=now() WHERE id=$2 AND user_id=$3 RETURNING id,title,completed,created_at,updated_at',
    [completed, req.params.id, req.user.sub]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Tarefa não encontrada' });
  res.json({ task: rows[0] });
}));

app.delete('/api/tasks/:id', requireAuth, asyncHandler(async (req, res) => {
  const result = await pool.query('DELETE FROM tasks WHERE id=$1 AND user_id=$2', [req.params.id, req.user.sub]);
  if (!result.rowCount) return res.status(404).json({ error: 'Tarefa não encontrada' });
  res.status(204).end();
}));

app.delete('/api/account', requireAuth, asyncHandler(async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM tasks WHERE user_id=$1', [req.user.sub]);
    await client.query('DELETE FROM users WHERE id=$1', [req.user.sub]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  res.clearCookie('taskflow_session', { ...cookieOptions, maxAge: undefined }).status(204).end();
}));

app.get('/api/admin/overview', requireAuth, requireAdmin, asyncHandler(async (_req, res) => {
  const [users, tasks] = await Promise.all([
    pool.query("SELECT COUNT(*)::int total, COUNT(*) FILTER (WHERE active)::int active FROM users WHERE role='USER'"),
    pool.query('SELECT COUNT(*)::int total, COUNT(*) FILTER (WHERE completed)::int completed FROM tasks')
  ]);
  res.json({ users: users.rows[0], tasks: tasks.rows[0] });
}));

app.get('/api/admin/users', requireAuth, requireAdmin, asyncHandler(async (_req, res) => {
  const { rows } = await pool.query('SELECT id,name,email,role,active,created_at FROM users ORDER BY created_at DESC');
  res.json({ users: rows });
}));

app.patch('/api/admin/users/:id', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const active = Boolean(req.body?.active);
  const { rows } = await pool.query("UPDATE users SET active=$1 WHERE id=$2 AND role='USER' RETURNING id,name,email,role,active,created_at", [active, req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Usuário não encontrado' });
  res.json({ user: rows[0] });
}));

// Último middleware da cadeia: qualquer erro não tratado (ex.: banco fora do
// ar) recebe resposta 500 genérica em JSON, sem expor stack traces ou detalhas
// de conexão ao cliente. A causa é registrada no log do servidor.
app.use((err, _req, res, _next) => {
  console.error('unhandled route error:', err && err.message ? err.message : err);
  if (res.headersSent) return;
  res.status(500).json({ error: 'Erro interno. Tente novamente em instantes.' });
});

async function bootstrapDemoUsers() {
  if (process.env.BOOTSTRAP_ENABLED !== 'true') return;
  const entries = [
    { name: 'Administrador Demo', email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD, role: 'ADMIN' },
    { name: 'Usuário Demo', email: process.env.USER_EMAIL, password: process.env.USER_PASSWORD, role: 'USER' }
  ];
  for (const entry of entries) {
    if (!entry.email || !entry.password || entry.password.length < 12) throw new Error('Bootstrap credentials are missing or invalid');
    const existing = await pool.query('SELECT id FROM users WHERE lower(email)=lower($1)', [entry.email]);
    if (!existing.rowCount) {
      const hash = await bcrypt.hash(entry.password, 12);
      await pool.query('INSERT INTO users (name,email,password_hash,role,active) VALUES ($1,$2,$3,$4,true)', [entry.name, entry.email.toLowerCase(), hash, entry.role]);
    }
  }
  console.log('TaskFlow bootstrap completed');
}

export default app;

// O servidor só sobe quando o arquivo é executado diretamente (node server.js —
// modo Render/local). Detecção pela comparação canônica entre import.meta.url e
// process.argv[1] via pathToFileURL (padrão do Node para "main module" em ESM,
// portável entre SOs). Quando o módulo é apenas importado — caso do handler
// serverless api/index.js na Vercel — nada escuta porta; o app só é exportado.
const isDirectRun = typeof process.argv[1] === 'string'
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  bootstrapDemoUsers()
    .then(() => app.listen(port, '0.0.0.0', () => console.log(`TaskFlow backend listening on ${port}`)))
    .catch(err => { console.error(err); process.exit(1); });
}

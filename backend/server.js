import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pg from 'pg';

const { Pool } = pg;
const app = express();
const port = process.env.PORT || 10000;
const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5500';
const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) throw new Error('JWT_SECRET is required');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined
});

app.use(cors({ origin: frontendUrl, credentials: true }));
app.use(express.json({ limit: '256kb' }));
app.use(cookieParser());

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
  try {
    const token = req.cookies.taskflow_session;
    if (!token) return res.status(401).json({ error: 'Não autenticado' });
    req.user = jwt.verify(token, jwtSecret);
    next();
  } catch {
    res.status(401).json({ error: 'Sessão inválida ou expirada' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'ADMIN') return res.status(403).json({ error: 'Acesso restrito ao administrador' });
  next();
}

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'taskflow' }));

app.post('/api/auth/register', async (req, res) => {
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
});

app.post('/api/auth/login', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const { rows } = await pool.query('SELECT * FROM users WHERE lower(email)=lower($1) LIMIT 1', [email]);
  const user = rows[0];
  if (!user || !user.active || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: 'E-mail ou senha inválidos' });
  }
  const safeUser = { id: user.id, name: user.name, email: user.email, role: user.role, active: user.active };
  res.cookie('taskflow_session', signUser(safeUser), cookieOptions).json({ user: safeUser });
});

app.post('/api/auth/logout', (_req, res) => {
  res.clearCookie('taskflow_session', { ...cookieOptions, maxAge: undefined }).status(204).end();
});

app.get('/api/auth/me', requireAuth, async (req, res) => {
  const { rows } = await pool.query('SELECT id,name,email,role,active FROM users WHERE id=$1', [req.user.sub]);
  if (!rows[0] || !rows[0].active) return res.status(401).json({ error: 'Conta indisponível' });
  res.json({ user: rows[0] });
});

app.get('/api/tasks', requireAuth, async (req, res) => {
  const { rows } = await pool.query('SELECT id,title,completed,created_at,updated_at FROM tasks WHERE user_id=$1 ORDER BY created_at DESC', [req.user.sub]);
  res.json({ tasks: rows });
});

app.post('/api/tasks', requireAuth, async (req, res) => {
  const title = String(req.body?.title || '').trim();
  if (!title || title.length > 240) return res.status(400).json({ error: 'Informe uma tarefa válida' });
  const { rows } = await pool.query('INSERT INTO tasks (user_id,title) VALUES ($1,$2) RETURNING id,title,completed,created_at,updated_at', [req.user.sub, title]);
  res.status(201).json({ task: rows[0] });
});

app.patch('/api/tasks/:id', requireAuth, async (req, res) => {
  const completed = Boolean(req.body?.completed);
  const { rows } = await pool.query(
    'UPDATE tasks SET completed=$1, updated_at=now() WHERE id=$2 AND user_id=$3 RETURNING id,title,completed,created_at,updated_at',
    [completed, req.params.id, req.user.sub]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Tarefa não encontrada' });
  res.json({ task: rows[0] });
});

app.delete('/api/tasks/:id', requireAuth, async (req, res) => {
  const result = await pool.query('DELETE FROM tasks WHERE id=$1 AND user_id=$2', [req.params.id, req.user.sub]);
  if (!result.rowCount) return res.status(404).json({ error: 'Tarefa não encontrada' });
  res.status(204).end();
});

app.get('/api/admin/overview', requireAuth, requireAdmin, async (_req, res) => {
  const [users, tasks] = await Promise.all([
    pool.query("SELECT COUNT(*)::int total, COUNT(*) FILTER (WHERE active)::int active FROM users WHERE role='USER'"),
    pool.query('SELECT COUNT(*)::int total, COUNT(*) FILTER (WHERE completed)::int completed FROM tasks')
  ]);
  res.json({ users: users.rows[0], tasks: tasks.rows[0] });
});

app.get('/api/admin/users', requireAuth, requireAdmin, async (_req, res) => {
  const { rows } = await pool.query('SELECT id,name,email,role,active,created_at FROM users ORDER BY created_at DESC');
  res.json({ users: rows });
});

app.patch('/api/admin/users/:id', requireAuth, requireAdmin, async (req, res) => {
  const active = Boolean(req.body?.active);
  const { rows } = await pool.query("UPDATE users SET active=$1 WHERE id=$2 AND role='USER' RETURNING id,name,email,role,active,created_at", [active, req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Usuário não encontrado' });
  res.json({ user: rows[0] });
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

bootstrapDemoUsers()
  .then(() => app.listen(port, '0.0.0.0', () => console.log(`TaskFlow backend listening on ${port}`)))
  .catch(err => { console.error(err); process.exit(1); });

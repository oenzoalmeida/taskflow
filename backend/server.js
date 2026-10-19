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

// DATABASE_SSL_MODE controla a conexão TLS com o Postgres:
//   verify    (padrão em produção) exige certificado válido — use
//             DATABASE_CA_CERT se o provedor usar uma CA própria;
//   no-verify criptografa sem conferir quem está do outro lado. Era o
//             comportamento anterior, e só deve ser usado de forma consciente;
//   disable   sem TLS, para desenvolvimento local.
const sslMode = process.env.DATABASE_SSL_MODE || (process.env.NODE_ENV === 'production' ? 'verify' : 'disable');
const caCert = process.env.DATABASE_CA_CERT;
const sslConfig = {
  disable: undefined,
  'no-verify': { rejectUnauthorized: false },
  verify: caCert ? { rejectUnauthorized: true, ca: caCert } : { rejectUnauthorized: true }
}[sslMode];
if (sslConfig === undefined && sslMode !== 'disable') {
  throw new Error(`DATABASE_SSL_MODE inválido: ${sslMode}. Use verify, no-verify ou disable.`);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: sslConfig
});

app.set('trust proxy', 1); // atrás do proxy do Render, req.ip reflete o cliente real
app.use(cors({ origin: frontendOrigins.length > 1 ? frontendOrigins : frontendUrl, credentials: true }));
app.use(express.json({ limit: '256kb' }));
app.use(cookieParser());

// Rate limit por IP (janela fixa) nas rotas de autenticação.
//
// A contagem vive no Postgres, e não num Map em memória. Este backend também
// roda como função serverless (backend/api/index.js na Vercel e
// netlify/functions/api.mjs), onde cada instância teria o próprio Map: o
// limite efetivo passaria a ser o configurado multiplicado pelo número de
// instâncias ativas, e zeraria a cada cold start. No banco, a contagem é
// única e sobrevive ao reinício do processo.
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX || 10);
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 60000);

// O projeto não usa ferramenta de migração: o schema é criado por quem opera.
// A tabela é garantida no primeiro uso para que um deploy não exija um passo
// manual antes de o login voltar a funcionar.
let tabelaDeRateLimit = null;
function garantirTabelaDeRateLimit() {
  if (!tabelaDeRateLimit) {
    tabelaDeRateLimit = pool
      .query(`CREATE TABLE IF NOT EXISTS auth_rate_limit (
                key text PRIMARY KEY,
                hits integer NOT NULL,
                reset_at timestamptz NOT NULL
              )`)
      .catch((err) => { tabelaDeRateLimit = null; throw err; });
  }
  return tabelaDeRateLimit;
}

// Conta a tentativa e devolve o total da janela. O UPSERT é atômico: duas
// requisições simultâneas no mesmo IP não perdem contagem, inclusive quando
// atendidas por instâncias diferentes.
async function registrarTentativa(key) {
  await garantirTabelaDeRateLimit();
  const segundos = RATE_LIMIT_WINDOW_MS / 1000;
  const { rows } = await pool.query(
    `INSERT INTO auth_rate_limit (key, hits, reset_at)
     VALUES ($1, 1, now() + make_interval(secs => $2))
     ON CONFLICT (key) DO UPDATE SET
       hits = CASE WHEN auth_rate_limit.reset_at <= now() THEN 1 ELSE auth_rate_limit.hits + 1 END,
       reset_at = CASE WHEN auth_rate_limit.reset_at <= now()
                       THEN now() + make_interval(secs => $2)
                       ELSE auth_rate_limit.reset_at END
     RETURNING hits, GREATEST(1, ceil(extract(epoch FROM reset_at - now())))::int AS retry_after`,
    [key, segundos]
  );
  // Limpeza oportunista: sem processo de fundo em serverless, apagar de vez em
  // quando mantém a tabela pequena sem custo perceptível por requisição.
  if (Math.random() < 0.02) {
    pool.query(`DELETE FROM auth_rate_limit WHERE reset_at < now() - interval '1 hour'`).catch(() => {});
  }
  return rows[0];
}

async function authRateLimit(req, res, next) {
  const key = req.ip || req.socket?.remoteAddress || 'unknown';
  try {
    const { hits, retry_after: retryAfter } = await registrarTentativa(key);
    if (hits > RATE_LIMIT_MAX) {
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({ error: 'Muitas tentativas. Tente novamente em instantes.' });
    }
  } catch (err) {
    // Falha aqui é falha de banco, e as rotas protegidas também dependem dele.
    // Responder 429 esconderia a causa real; segue adiante e deixa a rota
    // falhar com o erro verdadeiro.
    console.error('rate limit indisponível:', err);
  }
  next();
}

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

app.post('/api/auth/register', authRateLimit, async (req, res) => {
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

app.post('/api/auth/login', authRateLimit, async (req, res) => {
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

app.delete('/api/account', requireAuth, async (req, res) => {
  await pool.query('DELETE FROM tasks WHERE user_id=$1', [req.user.sub]);
  await pool.query('DELETE FROM users WHERE id=$1', [req.user.sub]);
  res.clearCookie('taskflow_session', { ...cookieOptions, maxAge: undefined }).status(204).end();
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

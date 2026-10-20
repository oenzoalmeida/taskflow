// Shared PostgreSQL policy and fail-closed authentication limiter.
export function positiveInteger(value, fallback, name) {
  const number = Number(value ?? fallback);
  if (!Number.isSafeInteger(number) || number <= 0 || number > 2147483647) {
    throw new Error(`${name} must be a positive 32-bit integer`);
  }
  return number;
}

export function databaseOptions(env = process.env) {
  const mode = env.DATABASE_SSL_MODE || (env.NODE_ENV === 'production' ? 'verify' : 'disable');
  if (!['verify', 'no-verify', 'disable'].includes(mode)) throw new Error('Invalid DATABASE_SSL_MODE');
  const url = new URL(env.DATABASE_URL);
  // pg connection-string SSL options replace the explicit ssl object.
  for (const key of [...url.searchParams.keys()]) {
    if (key.toLowerCase().startsWith('ssl')) url.searchParams.delete(key);
  }
  const ssl = mode === 'disable' ? false : {
    rejectUnauthorized: mode === 'verify',
    ...(mode === 'verify' && env.DATABASE_CA_CERT ? { ca: env.DATABASE_CA_CERT } : {})
  };
  return { connectionString: url.toString(), ssl, connectionTimeoutMillis: 5000,
    statement_timeout: 5000, query_timeout: 6000 };
}

export function proxyHops(env = process.env) {
  const hops = Number(env.TRUST_PROXY_HOPS ?? 0);
  if (!Number.isSafeInteger(hops) || hops < 0 || hops > 10) throw new Error('Invalid TRUST_PROXY_HOPS');
  return hops;
}

export function createAuthRateLimit(pool, { max, windowMs, logger = console }) {
  positiveInteger(max, 10, 'max');
  positiveInteger(windowMs, 60000, 'windowMs');
  return async function authRateLimit(req, res, next) {
    try {
      const key = req.ip || req.socket?.remoteAddress || 'unknown';
      const { rows } = await pool.query(
        `INSERT INTO auth_rate_limit (key, hits, reset_at)
         VALUES ($1, 1, now() + make_interval(secs => $2))
         ON CONFLICT (key) DO UPDATE SET
           hits = CASE WHEN auth_rate_limit.reset_at <= now() THEN 1
                       ELSE LEAST(auth_rate_limit.hits::bigint + 1, 2147483647)::integer END,
           reset_at = CASE WHEN auth_rate_limit.reset_at <= now()
                           THEN now() + make_interval(secs => $2)
                           ELSE auth_rate_limit.reset_at END
         RETURNING hits, GREATEST(1, ceil(extract(epoch FROM reset_at - now())))::int AS retry_after`,
        [key, windowMs / 1000]
      );
      if (!rows[0] || !Number.isInteger(rows[0].hits) || rows[0].hits < 1 ||
          !Number.isInteger(rows[0].retry_after) || rows[0].retry_after < 1) {
        throw new Error('Invalid limiter response');
      }
      if (rows[0].hits > max) {
        res.setHeader('Retry-After', String(rows[0].retry_after));
        return res.status(429).json({ error: 'Muitas tentativas. Tente novamente em instantes.' });
      }
      return next();
    } catch {
      // Never run password verification or account creation without the shared limit.
      // Avoid logging connection details or credentials from driver exceptions.
      logger.error('Authentication rate limiter unavailable');
      res.setHeader('Retry-After', '5');
      return res.status(503).json({ error: 'Autenticação temporariamente indisponível. Tente novamente.' });
    }
  };
}

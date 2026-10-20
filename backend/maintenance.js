import { createHash, timingSafeEqual } from 'node:crypto';

export const cleanupSql = `WITH expired AS (
  SELECT key FROM auth_rate_limit
  WHERE reset_at < now() - interval '1 hour'
  ORDER BY reset_at
  LIMIT 5000
  FOR UPDATE SKIP LOCKED
)
DELETE FROM auth_rate_limit AS counters USING expired
WHERE counters.key = expired.key`;

// A single bounded statement is atomic and safe if daily invocations overlap.
export function createRateLimitCleanup(pool, { secret = process.env.CRON_SECRET, logger = console } = {}) {
  const digest = value => createHash('sha256').update(value).digest();
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (typeof secret !== 'string' || secret.length < 16) {
      return res.status(503).json({ error: 'Maintenance unavailable' });
    }
    const authorization = req.get('authorization') || '';
    if (!timingSafeEqual(digest(authorization), digest(`Bearer ${secret}`))) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    try {
      const result = await pool.query(cleanupSql);
      return res.json({ deleted: result.rowCount, batchLimit: 5000 });
    } catch {
      logger.error('Rate-limit cleanup unavailable');
      return res.status(503).json({ error: 'Maintenance unavailable' });
    }
  };
}

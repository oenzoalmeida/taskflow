// Proteção contra CSRF para autenticação via cookie.
//
// Em produção o cookie de sessão vai com SameSite=None (frontend e API em
// origens diferentes), então o navegador anexa o cookie mesmo em requisições
// cross-site forjadas. Este middleware exige que mutações (POST/PUT/PATCH/
// DELETE) que carregam o cookie de sessão tragam um header Origin (ou, na
// ausência dele, Referer) pertencente às origens liberadas em FRONTEND_URL.
//
// Requisições sem cookie (ex.: login/register, clientes de API fora do
// navegador) e métodos seguros (GET/HEAD/OPTIONS) não são afetados.
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function normalizeOrigin(value) {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed || trimmed.toLowerCase() === 'null') return null;
  return trimmed.replace(/\/+$/, '').toLowerCase();
}

function originOf(url) {
  try {
    return new URL(url).origin.toLowerCase();
  } catch {
    return null;
  }
}

export function csrfOriginReferer({ cookieName, allowedOrigins }) {
  const allowed = new Set(allowedOrigins.map(normalizeOrigin).filter(Boolean));
  return function csrfOriginRefererMiddleware(req, res, next) {
    if (SAFE_METHODS.has(req.method)) return next();
    if (!req.cookies || !req.cookies[cookieName]) return next();
    const origin = normalizeOrigin(req.get('Origin'));
    if (origin && allowed.has(origin)) return next();
    if (!origin) {
      const refererOrigin = originOf(req.get('Referer'));
      if (refererOrigin && allowed.has(refererOrigin)) return next();
    }
    return res.status(403).json({ error: 'Origem da requisição não permitida.' });
  };
}

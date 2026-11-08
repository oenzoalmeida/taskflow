// Proteção contra CSRF para autenticação via cookie.
//
// Em produção o cookie de sessão vai com SameSite=None (frontend e API em
// origens diferentes), então o navegador anexa o cookie mesmo em requisições
// cross-site forjadas. Este middleware exige que mutações (POST/PUT/PATCH/
// DELETE) que carregam o cookie de sessão tragam um header Origin (ou, na
// ausência dele, Referer) pertencente às origens liberadas em FRONTEND_URL.
//
// Requisições sem cookie (ex.: login/register) e métodos seguros (GET/HEAD/
// OPTIONS) não são afetados. Sem Origin nem Referer (clientes fora do
// navegador, como curl/testes), a requisição passa — navegadores sempre
// enviam Origin em mutações cross-site, então o vetor de CSRF real fica coberto.
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
    // Mesma origem (interface servida pelo próprio backend): Origin igual ao Host.
    const host = (req.get('Host') || '').toLowerCase();
    const selfOrigins = host ? new Set([`https://${host}`, `http://${host}`]) : new Set();
    const permitido = (o) => allowed.has(o) || selfOrigins.has(o);
    const negado = () => res.status(403).json({ error: 'Origem da requisição não permitida.' });
    const rawOrigin = req.get('Origin');
    if (rawOrigin && rawOrigin.trim()) {
      // Navegadores sempre enviam Origin em POST cross-site: valor presente
      // precisa estar na allowlist ("null" incluído, nunca é permitido).
      const origin = normalizeOrigin(rawOrigin);
      return origin && permitido(origin) ? next() : negado();
    }
    const referer = originOf(req.get('Referer'));
    if (referer) return permitido(referer) ? next() : negado();
    return next(); // sem Origin/Referer: cliente fora do navegador (curl, testes)
  };
}

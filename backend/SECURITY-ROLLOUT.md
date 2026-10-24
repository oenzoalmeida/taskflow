# Authentication limiter rollout

Apply `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/001_auth_rate_limit.sql`
with a schema-owner connection before deploying. The runtime role only needs
SELECT, INSERT and UPDATE on auth_rate_limit. If the runtime role differs from
the owner, grant those privileges explicitly using its verified role name.
Runtime requests never create schema objects. Missing schema, denied permissions,
timeouts and database outages return HTTP 503 with Retry-After: 5, before authentication.
An exceeded limit returns HTTP 429 with the remaining window in Retry-After.

Verify the provider certificate using DATABASE_SSL_MODE=verify and the provider's
CA in DATABASE_CA_CERT if required. SSL query parameters are removed from the URL
so they cannot replace the explicit TLS policy. Keep credentials out of logs.

TRUST_PROXY_HOPS defaults to 0. Set it only after verifying the ingress topology
and preventing direct access that bypasses those proxies. Never trust arbitrary
forwarded headers. With 0, requests behind one proxy share its quota until configured.

Schedule cleanup with the schema owner:
`DELETE FROM auth_rate_limit WHERE reset_at < now() - interval '1 hour'`.
No runtime DELETE permission is needed. Monitor table growth and 503 responses.

Before merge, verify the migration, least-privilege runtime role, certificate,
proxy chain, concurrent requests across instances and failed-database behavior
in an isolated environment matching production. Production compatibility has
not been established by unit tests. Do not deploy until these checks pass.


## Limpeza diária dos contadores expirados

O cron Vercel chama `GET /api/internal/maintenance/rate-limits` diariamente às 04:00 UTC (01:00 em São Paulo). O horário pode variar no plano Hobby. Configure `CRON_SECRET` em Production com um valor aleatório de pelo menos 16 caracteres antes de publicar. A Vercel envia esse valor no cabeçalho `Authorization: Bearer ...`. Ausência de configuração retorna 503. Credenciais ausentes ou incorretas retornam 401 sem consulta ao banco.

Cada execução remove no máximo 5.000 contadores cuja janela expirou há mais de uma hora. Cotas ativas e contadores recém-expirados são preservados. A consulta usa o índice de `reset_at`, uma única instrução atômica e `SKIP LOCKED` para permitir invocações simultâneas. O papel do banco precisa de DELETE nessa tabela, além dos privilégios já usados pelo limitador. A resposta informa somente a quantidade removida e o limite do lote. Nenhum endereço IP é registrado pelo handler. Falha no banco retorna 503 genérico. Nenhum registro de usuário é acessado.

Se a criação diária de chaves superar o limite do lote, acompanhe o crescimento da tabela e ajuste a capacidade ou frequência. Esse limite controla o trabalho por requisição e não garante esvaziar qualquer volume acumulado em uma única execução.

Referências: https://vercel.com/docs/cron-jobs/manage-cron-jobs e https://vercel.com/docs/cron-jobs/usage-and-pricing.

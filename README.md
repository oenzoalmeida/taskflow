# TaskFlow

Gerenciador de tarefas full stack com autenticação, dados por usuário e painel administrativo.

## Demonstração

**Aplicação:** https://taskflow-dcl5.onrender.com

## Credencial demo

> **Nota:** as credenciais abaixo são públicas para fins de demonstração; os dados da conta demo podem ser alterados por outros visitantes.

| Perfil | E-mail | Senha |
|---|---|---|
| Usuário | `demo@taskflow.app` | `TaskFlow@2026` |

O acesso administrativo é interno e não possui credencial pública.

## Sobre

Projeto de portfólio desenvolvido para praticar autenticação, isolamento de dados por usuário e publicação em nuvem. Cada usuário enxerga exclusivamente as próprias tarefas; o painel administrativo é separado e restrito por papel.

## Funcionalidades principais

- Cadastro e login de usuários
- Sessão autenticada por cookie HttpOnly
- Tarefas separadas por usuário
- Adicionar, concluir, excluir e filtrar tarefas
- Indicador de progresso
- Painel administrativo com visão geral e gestão de usuários ativos/inativos
- Exclusão definitiva da conta pela própria interface
- Interface responsiva

## Tecnologias

- **Frontend:** HTML5, CSS3, JavaScript
- **Backend:** Node.js, Express, JWT, BCrypt
- **Banco de dados:** PostgreSQL (Neon)
- **Infraestrutura:** Render

## Perfis de acesso

- **Usuário (USER):** cria, conclui, filtra e exclui as próprias tarefas; pode excluir a própria conta.
- **Administrador (ADMIN):** acessa o painel administrativo (estatísticas e ativação/desativação de usuários). Sem acesso ao conteúdo das tarefas dos usuários. Credencial não pública.

## Segurança e privacidade

- Senhas com hash bcrypt (custo 12); nenhum segredo de produção versionado — tudo via variáveis de ambiente.
- Sessão por JWT em cookie HttpOnly/Secure; CORS restrito ao domínio do frontend.
- Consultas SQL parametrizadas; saídas do frontend escapadas.
- Sem analytics, rastreamento ou cookies de terceiros (apenas o cookie de sessão).
- Termos de Uso e Política de Privacidade disponíveis na aplicação; exclusão de conta apaga definitivamente usuário e tarefas.

## Executando localmente

Backend:

```bash
cd backend
npm install
JWT_SECRET=um-segredo-forte DATABASE_URL=sua-string-postgres FRONTEND_URL=http://localhost:5500 npm start
```

Frontend: sirva os arquivos estáticos da raiz (por exemplo, com a extensão Live Server na porta 5500) e ajuste a constante `API` em `script.js` se necessário.

## Testes

O CI verifica a sintaxe dos arquivos JavaScript (`node --check`) e a integridade dos arquivos essenciais. Não há suíte de testes automatizados funcionais.

## Deploy

A infraestrutura no Render está descrita no Blueprint [`render.yaml`](render.yaml), que espelha os serviços como já existem (criados manualmente no dashboard).

| Serviço | Tipo | URL |
|---|---|---|
| `taskflow` | Site estático (raiz do repo) | https://taskflow-dcl5.onrender.com |
| `taskflow-backend` | Web service Node (`backend/`) | https://taskflow-backend-6syn.onrender.com |

Banco de dados: PostgreSQL gerenciado no Neon (externo ao Render).

**Como colocar a `main` no ar** (serviços já existentes no dashboard):

1. Render Dashboard → serviço `taskflow-backend` → **Manual Deploy** → **Deploy latest commit**.
2. Para deploys automáticos a cada push na `main`: no mesmo serviço, **Settings** → **Build & Deploy** → ative **Auto-Deploy** (o `render.yaml` já declara `autoDeployTrigger: commit` para quando o Blueprint for aplicado).
3. Repita para o site estático `taskflow` (o frontend só muda quando há alteração de UI).

> **Atenção:** aplicar o Blueprint no dashboard ("New → Blueprint") pode **criar serviços novos** em vez de adotar os existentes — nesse caso não aponte o DNS/domínio público para os novos até validar, e remova os duplicados depois. Para apenas publicar a `main`, o caminho seguro é o passo 1.

**Variáveis de ambiente do backend** (valores configurados só no dashboard; segredos ficam com `sync: false` no `render.yaml`): `DATABASE_URL`, `JWT_SECRET`, `FRONTEND_URL`, `NODE_ENV`, `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_MS`, `PORT` (definida pelo Render) e, opcionais, `BOOTSTRAP_ENABLED`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `USER_EMAIL`, `USER_PASSWORD` (provisionam as contas demo no boot).

**Checklist pós-deploy:**

- [ ] `GET https://taskflow-backend-6syn.onrender.com/health` responde **200**
- [ ] 11 logins seguidos com senha errada: os 10 primeiros → **401**, o 11º → **429** (rate limit ativo na build nova)

## Limitações conhecidas

- Sem verificação de e-mail e sem recuperação de senha.
- O rate limit de autenticação é in-memory por instância: reinicia a cada deploy/restart e não é compartilhado entre réplicas.
- O título de uma tarefa não é editável após a criação.

## Autor

Enzo Almeida

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

- **Frontend:** site estático no Render.
- **Backend:** serviço Node no Render com variáveis `DATABASE_URL`, `JWT_SECRET`, `FRONTEND_URL` e (opcional) `BOOTSTRAP_ENABLED`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `USER_EMAIL`, `USER_PASSWORD` para provisionar contas internas.
- **Banco:** PostgreSQL gerenciado no Neon.

## Deploy do frontend no Cloudflare Pages (opcional, sem custo)

O frontend é 100% portável: `script.js` chama o backend por URL absoluta
(`https://taskflow-backend-6syn.onrender.com`, constante `API` na linha 1), então **nenhuma
mudança de código** é necessária. O backend já envia o cookie de sessão com
`SameSite=None; Secure` em produção, então login cross-site funciona sem alteração.

| Aspecto | Hoje (front no Render static) | Front no Pages + backend no Render free |
|---|---|---|
| Carregamento da página | Site estático no Render (CDN, já sem cold start) | Imediato (edge Cloudflare, sem cold start) |
| Primeira chamada de API após o backend dormir | Cold start do backend Node (~13–24s) | **Continua sentindo o cold start do backend** (~13–24s no primeiro login/GET após 15 min de inatividade) |
| Custo | R$ 0 | R$ 0 (Pages free) |
| DNS próprio | Não exigido | Não exigido (`*.pages.dev`) |

**Aviso honesto:** a migração melhora apenas o carregamento da página. O backend Node continua
no Render free, adormece após 15 minutos e a primeira ação que toca a API continua esperando o
serviço acordar. Nada no Render é apagado nesta migração.

### Passo a passo (dashboard Cloudflare, sem CLI)

1. Cloudflare Dashboard → **Workers & Pages** → *Create* → **Pages** → *Connect to Git* →
   autorize e selecione este repositório.
2. *Project name:* `taskflow` (o domínio fica `taskflow.pages.dev`).
3. *Build configuration*:
   - **Framework preset:** `None`
   - **Build command:** vazio (é um site estático, sem build)
   - **Build output directory:** `/` (raiz do repositório)
4. *Save and Deploy*. O front sobe em `https://taskflow.pages.dev`.

### CORS do backend quando o novo front estiver no ar

O backend aceita uma única origem em `FRONTEND_URL` (Render → serviço do backend → Environment).
Quando o front do Pages estiver no ar e validado, atualize:

```text
FRONTEND_URL=https://taskflow.pages.dev
```

Atenção: como `FRONTEND_URL` aceita uma só origem, trocar o valor faz o site atual
(`taskflow-dcl5.onrender.com`) parar de funcionar (bloqueio de CORS). Faça a troca no momento do
cutover, ou ajuste o código do backend para aceitar uma lista de origens se quiser período de
transição com os dois sites no ar.

## Limitações conhecidas

- Sem verificação de e-mail e sem recuperação de senha.
- Sem rate limiting nas rotas de autenticação.
- O título de uma tarefa não é editável após a criação.

## Autor

Enzo Almeida

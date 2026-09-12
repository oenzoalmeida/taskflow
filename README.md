# TaskFlow

Gerenciador de tarefas full stack com autenticação, dados por usuário e painel administrativo.

## Demonstração

**Aplicação:** https://taskflow-dcl5.onrender.com

## Funcionalidades

- Cadastro e login de usuários
- Sessão autenticada por cookie HttpOnly
- Tarefas separadas por usuário
- Adicionar, concluir, excluir e filtrar tarefas
- Indicador de progresso
- Painel administrativo separado
- Gestão de usuários ativos/inativos
- Visão geral de usuários e tarefas
- Interface responsiva

## Perfis de acesso

- **Usuário:** acessa apenas as próprias tarefas.
- **Administrador:** possui acesso ao painel administrativo e à gestão de usuários.

## Credenciais demo

| Perfil | E-mail | Senha |
|---|---|---|
| Usuário | `demo@taskflow.app` | `TaskFlow@2026` |
| Administrador | `admin@taskflow.app` | `Admin@Portfolio2026` |

## Tecnologias

### Frontend
- HTML5
- CSS3
- JavaScript

### Backend
- Node.js
- Express
- PostgreSQL
- JWT
- BCrypt

### Infraestrutura
- Render — frontend e backend
- Neon — PostgreSQL

## Estrutura

```text
TaskFlow/
├── backend/
│   ├── package.json
│   └── server.js
├── index.html
├── style.css
├── script.js
└── README.md
```

Nenhuma senha de produção é armazenada no repositório.

## Autor

Enzo Almeida

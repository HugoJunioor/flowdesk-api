# FlowDesk API

[![CI](https://github.com/HugoJunioor/flowdesk-api/actions/workflows/ci.yml/badge.svg)](https://github.com/HugoJunioor/flowdesk-api/actions/workflows/ci.yml)
[![Security](https://img.shields.io/badge/vulnerabilities-0-brightgreen?style=flat)](#-decisões-de-segurança)
[![Stack](https://img.shields.io/badge/stack-Node%2020%20%2B%20Fastify%20%2B%20Prisma%20%2B%20PostgreSQL-informational?style=flat)](#stack)
[![License](https://img.shields.io/badge/license-MIT-green?style=flat)](LICENSE)

Backend REST do [**FlowDesk**](https://github.com/HugoJunioor/FlowDesk) — sistema
de gestão de demandas Slack com SLA em horas úteis, classificação automática
e relatórios BI. Esta API substitui o estado em arquivo (`shared-state.json`)
do front por persistência real em PostgreSQL.

## ✨ Destaques

- **Type-safe end-to-end:** Prisma + Zod + TypeScript strict
- **Schema-first:** validação Zod nas rotas, OpenAPI auto-gerado em `/docs`
- **Auth segura:** PBKDF2 (150k iter + salt 16B), JWT em cookie HttpOnly
- **Anti brute-force:** rate limit global + lockout de 5 min após 5 falhas
- **Migrations versionadas:** Prisma migrate, audit log embutido no schema
- **Docker pronto:** `docker compose up` sobe Postgres + API com 1 comando
- **CI completo:** GitHub Actions com Postgres em service container, build, lint, test

## 🏗 Arquitetura

```
┌─────────────┐
│  FlowDesk   │     HTTPS (cookie JWT)
│   (front)   │ ──────────────────────┐
└─────────────┘                       ▼
                              ┌──────────────┐
                              │ Fastify      │
                              │  ├─ /auth/*  │
                              │  ├─ /users/* │
                              │  ├─ /groups  │
                              │  └─ /demands │
                              └──────┬───────┘
                                     │ Prisma
                                     ▼
                              ┌──────────────┐
                              │ PostgreSQL   │
                              │  · users     │
                              │  · groups    │
                              │  · overrides │
                              │  · audit_log │
                              └──────────────┘
```

## 🚀 Quick start

```bash
# 1. Clone e instale
git clone https://github.com/HugoJunioor/flowdesk-api.git
cd flowdesk-api
npm install

# 2. Copie e ajuste variáveis
cp .env.example .env

# 3. Suba o Postgres via Docker
npm run db:up

# 4. Aplique migrations + seed (cria usuário master)
npm run db:migrate
npm run db:seed

# 5. Suba a API em dev (hot reload)
npm run dev
```

API roda em `http://localhost:3001`. Docs interativas em `http://localhost:3001/docs`.

**Login inicial:** `master` / `Admin@1` (forçado a trocar no primeiro login)

## 📚 Endpoints

| Método | Rota | Auth | Descrição |
|---|---|---|---|
| GET     | `/health` | ❌ | Status + ping no DB |
| POST    | `/auth/login` | ❌ | Login (cookie HttpOnly) |
| POST    | `/auth/logout` | ❌ | Limpa cookie |
| GET     | `/auth/me` | 🔐 | Usuário autenticado |
| GET     | `/users` | 👑 | Listar usuários |
| GET     | `/users/:id` | 👑 | Detalhe |
| POST    | `/users` | 👑 | Criar (gera senha temp se omitida) |
| PATCH   | `/users/:id` | 👑 | Atualizar |
| DELETE  | `/users/:id` | 👑 | Remover (master protegido) |
| POST    | `/users/:id/reset-password` | 👑 | Gerar senha temporária |
| GET     | `/groups` | 🔐 | Listar grupos |
| GET     | `/groups/:name` | 🔐 | Detalhe + membros |
| POST    | `/groups` | 👑 | Criar grupo |
| PATCH   | `/groups/:name` | 👑 | Atualizar permissões |
| DELETE  | `/groups/:name` | 👑 | Remover |
| GET     | `/demands/overrides?channel=slack\|sql` | 🔐 | Listar overrides |
| GET     | `/demands/overrides/:channel/:id` | 🔐 | Override específico |
| PUT     | `/demands/overrides/:channel/:id` | 🔐 | Criar/atualizar |
| DELETE  | `/demands/overrides/:channel/:id` | 👑 | Remover |
| GET     | `/support-members` | 🔐 | Listar mapeamento N1/N2/N3 |
| PUT     | `/support-members/:login` | 👑 | Definir nível |
| DELETE  | `/support-members/:login` | 👑 | Remover |
| GET     | `/auto-assign-rules` | 🔐 | Listar regras ativas |
| POST    | `/auto-assign-rules` | 👑 | Criar regra |
| PATCH   | `/auto-assign-rules/:id` | 👑 | Atualizar |
| DELETE  | `/auto-assign-rules/:id` | 👑 | Remover |
| GET     | `/audit-log?cursor=&limit=&action=` | 👑 | Log paginado por cursor |

🔐 = autenticado · 👑 = master only

Contrato OpenAPI completo em `/docs/json` ou navegável em `/docs` (Swagger UI).

## 🧰 Scripts npm

| Script | O que faz |
|---|---|
| `npm run dev` | Servidor dev com hot reload (tsx watch) |
| `npm run build` | Compila TypeScript pra `dist/` |
| `npm start` | Roda o build de produção |
| `npm run db:up` | Sobe Postgres via Docker Compose |
| `npm run db:migrate` | Cria/aplica migration nova (dev) |
| `npm run db:deploy` | Aplica migrations existentes (prod) |
| `npm run db:seed` | Roda `prisma/seed.ts` |
| `npm run db:studio` | UI visual do Prisma (porta 5555) |
| `npm run db:reset` | Drop + recreate + seed (cuidado!) |
| `npm test` | Vitest |
| `npm run typecheck` | `tsc --noEmit` |

## 🧱 Stack

- **Runtime:** Node 20 + ESM + TypeScript strict
- **Framework:** Fastify 4
- **ORM:** Prisma 5
- **DB:** PostgreSQL 16
- **Auth:** `@fastify/jwt` + cookie HttpOnly + PBKDF2
- **Docs:** `@fastify/swagger` (OpenAPI 3)
- **Validation:** Zod
- **Rate limit:** `@fastify/rate-limit`
- **Security:** `@fastify/helmet`
- **Tests:** Vitest

## 🔒 Decisões de segurança

| Decisão | Por quê |
|---|---|
| PBKDF2 com 150k iterações | Padrão OWASP, funciona em qualquer ambiente Node sem dependência nativa (vs bcrypt/argon2) |
| Cookie HttpOnly + SameSite=Lax | Imune a XSS (não acessível via JS) e mitiga CSRF cross-site |
| Rate limit duplo: global + por login | Protege contra DDoS e brute-force ao mesmo tempo |
| Migração transparente SHA-256→PBKDF2 | Permite atualizar hashes legados sem forçar reset de senha |
| Audit log no schema | Investigação pós-incidente sem instrumentação extra |
| Helmet com CSP customizado | Headers de segurança padrão sem quebrar o Swagger UI |
| Validação Zod em todas as rotas | Falha explícita > comportamento indefinido |

## 📦 Deploy

Recomendados (todos têm tier free):

- **Railway** — `railway up` direto do CLI, Postgres incluso
- **Render** — Web Service + Postgres, deploy via GitHub
- **Fly.io** — `fly launch` detecta Dockerfile

Dockerfile multi-stage incluso. Em qualquer plataforma:

```bash
DATABASE_URL=...  JWT_SECRET=...  npm run db:deploy && npm start
```

## 🗺 Roadmap

- [x] Auth (login/logout/me) com PBKDF2 + JWT
- [x] Health check com ping no DB
- [x] Swagger UI auto-gerado
- [x] Rate limit + helmet + CORS
- [x] CRUD `/users` + reset de senha
- [x] CRUD `/groups` com matriz de permissões
- [x] CRUD `/demands/overrides` (slack + sql)
- [x] CRUD `/auto-assign-rules`
- [x] CRUD `/support-members`
- [x] `/audit-log` paginado por cursor
- [x] Importer `scripts/import-shared-state.ts` (migra estado do front)
- [x] Configs prontas pra Railway/Fly
- [ ] Webhook Slack (substituir o sync via cron)
- [ ] Cliente API no front do FlowDesk

## 🤝 Projeto principal

- [**FlowDesk**](https://github.com/HugoJunioor/FlowDesk) — frontend React + dashboard
- [Demo ao vivo](https://flow-desk-e2is.vercel.app)

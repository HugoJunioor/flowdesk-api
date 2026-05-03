# Contribuindo com o flowdesk-api

Obrigado por considerar contribuir! Backend REST do FlowDesk em Fastify + Prisma.

## Como reportar bug ou sugestão

Abre uma [issue](https://github.com/HugoJunioor/flowdesk-api/issues/new) com:

- **O que aconteceu** (request, payload, resposta)
- **Como reproduzir**
- Stack trace se houver

## Como abrir PR

1. Fork → branch a partir de `main`
2. Roda local antes de pushar:
   ```bash
   npm install
   docker compose up -d postgres
   npm run db:migrate
   npm run typecheck
   npm test
   npm run build
   ```
3. **Zero vulnerabilidades** é regra (`npm audit` no CI bloqueia em moderate+)
4. PR descrevendo o **problema** e a **solução**

## Convenções

- **TypeScript strict:** sem `any`, prefere `unknown` + Zod
- **Validação Zod:** em todas as rotas, no body/params/query
- **Audit log:** toda mutação que altera estado deveria passar por `audit()`
- **Commits:** `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `security:`

## Adicionando uma nova rota

1. Cria arquivo em `src/routes/<modulo>.ts` exportando função `<modulo>Routes(app)`
2. Schema com tags + summary pra Swagger gerar doc bonita
3. Validação Zod no body/params
4. `audit(req, { action: "..." })` em mutações
5. Registra em `src/server.ts`
6. Add teste em `test/<modulo>.test.ts`

## Adicionando migração

```bash
npm run db:migrate -- --name descritivo
```

Commita o arquivo gerado em `prisma/migrations/`.

## Dúvidas

[LinkedIn](https://www.linkedin.com/in/hugo-cordeiro-junior) ou issue.

## Resumo

<!-- 1-2 frases sobre o que muda -->

## Tipo de mudança

- [ ] 🐛 Bug fix
- [ ] ✨ Feature (novo endpoint / nova capacidade)
- [ ] 🔒 Segurança
- [ ] 📚 Documentação
- [ ] ♻️ Refactor (sem mudança de comportamento da API)
- [ ] ✅ Testes
- [ ] 🔧 Chore (build, deps, config)

## Contexto

Closes #

## Como testar

```bash
# Local
docker compose up -d postgres
npm run db:migrate
npm test
npm run dev

# Validação manual
curl -X POST http://localhost:3001/...
```

## Checklist

- [ ] Build passa (`npm run build`)
- [ ] Typecheck passa (`npm run typecheck`)
- [ ] Testes passam (`npm test`)
- [ ] **Zero vulnerabilidades** (`npm audit`)
- [ ] Validação Zod nas rotas novas
- [ ] `audit()` chamado em mutações que alteram estado
- [ ] Documentei mudanças no CHANGELOG.md
- [ ] Schema da rota tem `tags` + `summary` (Swagger)
- [ ] Migration Prisma versionada (se aplicável)

## Impacto na API pública

- [ ] **Breaking change** — descrever qual contrato muda e como migrar
- [ ] **Não-breaking** — clientes existentes continuam funcionando

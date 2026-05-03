#!/bin/sh
# Wrapper de boot pra Railway/Docker. Faz 3 coisas com logs explicitos:
#  1) Aplica migrations Prisma (idempotente)
#  2) (Opcional) roda seed se SEED_ON_BOOT=true
#  3) Inicia o servidor Node via exec (vira PID 1, recebe sinais corretamente)
set -e

echo "[start] === FlowDesk API boot wrapper ==="
echo "[start] node $(node --version), npm $(npm --version)"
echo "[start] PWD=$(pwd)"
echo "[start] dist exists? $(test -f dist/server.js && echo YES || echo NO)"
echo "[start] DATABASE_URL set? $(test -n \"$DATABASE_URL\" && echo YES || echo NO)"
echo "[start] PORT=$PORT NODE_ENV=$NODE_ENV"

echo "[start] applying prisma migrations..."
npx prisma migrate deploy
MIGRATE_EXIT=$?
echo "[start] migrate exit code: $MIGRATE_EXIT"

if [ "$SEED_ON_BOOT" = "true" ]; then
  echo "[start] running seed (SEED_ON_BOOT=true)..."
  npx tsx prisma/seed.ts || echo "[start] seed falhou, continuando..."
fi

echo "[start] launching node server..."
exec node dist/server.js

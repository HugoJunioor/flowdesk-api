# Multi-stage build pra reduzir imagem final.
# Base: Alpine + Node 20. openssl necessario pelo Prisma.

FROM node:20-alpine AS base
WORKDIR /app
RUN apk add --no-cache openssl

# ---------- deps stage ----------
FROM base AS deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

# ---------- build stage ----------
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

# ---------- runner stage ----------
FROM node:20-alpine AS runner
WORKDIR /app
RUN apk add --no-cache openssl
ENV NODE_ENV=production

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/package.json ./

EXPOSE 3001
CMD ["node", "dist/server.js"]

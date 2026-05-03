/**
 * FlowDesk API — entry point.
 *
 * Stack: Fastify 4 + Prisma 5 + PostgreSQL 16 + JWT (cookie HttpOnly).
 * Doc interativa em /docs (Swagger UI) e contrato OpenAPI em /docs/json.
 */
// Top-level handlers pra capturar QUALQUER erro nao tratado no boot.
// Sem isso, top-level await rejection some sem trace.
process.on("uncaughtException", (err) => {
  console.error("[fatal] uncaughtException:", err);
  process.exit(1);
});
process.on("unhandledRejection", (err) => {
  console.error("[fatal] unhandledRejection:", err);
  process.exit(1);
});

console.log("[boot] node iniciado, importando modulos...");

import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";

import { env } from "./env.js";

console.log("[boot] modulos carregados, criando app Fastify...");
import authPlugin from "./plugins/auth.js";
import requireMasterPlugin from "./plugins/require-master.js";
import { healthRoutes } from "./routes/health.js";
import { authRoutes } from "./routes/auth.js";
import { userRoutes } from "./routes/users.js";
import { groupRoutes } from "./routes/groups.js";
import { demandRoutes } from "./routes/demands.js";
import { supportMemberRoutes } from "./routes/support-members.js";
import { autoAssignRoutes } from "./routes/auto-assign-rules.js";
import { auditRoutes } from "./routes/audit.js";

const app = Fastify({
  logger: {
    level: env.NODE_ENV === "production" ? "info" : "debug",
    transport:
      env.NODE_ENV === "development"
        ? { target: "pino-pretty", options: { translateTime: "HH:MM:ss", ignore: "pid,hostname" } }
        : undefined,
  },
});

await app.register(helmet, { contentSecurityPolicy: false });
await app.register(cors, {
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (env.CORS_ORIGINS.includes(origin)) return cb(null, true);
    return cb(new Error("Not allowed by CORS"), false);
  },
  credentials: true,
});
await app.register(rateLimit, {
  max: env.RATE_LIMIT_MAX,
  timeWindow: env.RATE_LIMIT_WINDOW,
});

await app.register(swagger, {
  openapi: {
    info: {
      title: "FlowDesk API",
      description: "Backend REST do FlowDesk — gestao de demandas Slack com SLA, IA e relatorios.",
      version: "0.1.0",
    },
    servers: [{ url: `http://localhost:${env.PORT}` }],
    tags: [
      { name: "meta", description: "Saude e metadados" },
      { name: "auth", description: "Autenticacao" },
      { name: "users", description: "Usuarios" },
      { name: "groups", description: "Grupos e permissoes" },
      { name: "demands", description: "Overrides de demandas" },
      { name: "support", description: "Membros por nivel" },
      { name: "auto-assign", description: "Regras de auto-atribuicao" },
      { name: "audit", description: "Audit log" },
    ],
    components: {
      securitySchemes: {
        cookieAuth: { type: "apiKey", in: "cookie", name: "fd_session" },
      },
    },
  },
});
await app.register(swaggerUi, { routePrefix: "/docs" });

console.log("[boot] registrando plugins de auth...");
await app.register(authPlugin);
await app.register(requireMasterPlugin);
console.log("[boot] auth ok, registrando rotas...");

// Rotas
await app.register(healthRoutes);
await app.register(authRoutes);
await app.register(userRoutes);
await app.register(groupRoutes);
await app.register(demandRoutes);
await app.register(supportMemberRoutes);
await app.register(autoAssignRoutes);
await app.register(auditRoutes);
console.log("[boot] rotas registradas");

const PORT = env.PORT;
const HOST = env.HOST;

// Boot diagnostico: imprime em stdout direto pra ficar visivel mesmo se
// o pino nao tiver flushado ainda quando der crash.
console.log(`[boot] NODE_ENV=${env.NODE_ENV} PORT=${PORT} HOST=${HOST}`);
console.log(`[boot] DATABASE_URL set? ${!!process.env.DATABASE_URL}`);
console.log(`[boot] JWT_SECRET length: ${env.JWT_SECRET.length}`);
console.log(`[boot] CORS_ORIGINS: ${env.CORS_ORIGINS.join(", ")}`);

try {
  await app.listen({ port: PORT, host: HOST });
  console.log(`[boot] ✅ Server listening at http://${HOST}:${PORT}`);
  console.log(`[boot] 📚 Swagger UI: http://localhost:${PORT}/docs`);
} catch (err) {
  console.error("[boot] ❌ FAIL:", err);
  process.exit(1);
}

/**
 * FlowDesk API — entry point.
 *
 * Stack: Fastify 4 + Prisma 5 + PostgreSQL 16 + JWT (cookie HttpOnly).
 * Doc interativa em /docs (Swagger UI) e contrato OpenAPI em /docs/json.
 */
import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";

import { env } from "./env.js";
import authPlugin from "./plugins/auth.js";
import { healthRoutes } from "./routes/health.js";
import { authRoutes } from "./routes/auth.js";

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
    ],
  },
});
await app.register(swaggerUi, { routePrefix: "/docs" });

await app.register(authPlugin);

// Rotas
await app.register(healthRoutes);
await app.register(authRoutes);

const PORT = env.PORT;
const HOST = env.HOST;

try {
  await app.listen({ port: PORT, host: HOST });
  app.log.info(`📚 Swagger UI: http://localhost:${PORT}/docs`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

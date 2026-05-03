import type { FastifyInstance } from "fastify";
import { prisma } from "../db/client.js";

export async function healthRoutes(app: FastifyInstance) {
  app.get("/health", {
    schema: {
      tags: ["meta"],
      summary: "Health check (publico)",
      response: {
        200: {
          type: "object",
          properties: {
            status: { type: "string" },
            db: { type: "string" },
            uptime: { type: "number" },
            timestamp: { type: "string" },
          },
        },
      },
    },
  }, async () => {
    let dbStatus = "ok";
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      dbStatus = "down";
    }
    return {
      status: dbStatus === "ok" ? "ok" : "degraded",
      db: dbStatus,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  });
}

/**
 * Audit log paginado. So master pode ler — eh investigacao pos-incidente.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db/client.js";

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(50),
  cursor: z.coerce.bigint().optional(),  // id pra paginacao
  action: z.string().optional(),
  actorId: z.string().uuid().optional(),
  targetType: z.string().optional(),
  targetId: z.string().optional(),
});

export async function auditRoutes(app: FastifyInstance) {
  const guarded = { onRequest: [app.authenticate, app.requireMaster] };

  app.get("/audit-log", {
    ...guarded,
    schema: { tags: ["audit"], summary: "Audit log paginado por cursor" },
  }, async (req) => {
    const q = querySchema.parse(req.query);

    const items = await prisma.auditLog.findMany({
      where: {
        action: q.action ?? undefined,
        actorId: q.actorId ?? undefined,
        targetType: q.targetType ?? undefined,
        targetId: q.targetId ?? undefined,
        ...(q.cursor ? { id: { lt: q.cursor } } : {}),
      },
      orderBy: { id: "desc" },
      take: q.limit,
    });

    // Serializa BigInt
    const serialized = items.map((it) => ({ ...it, id: it.id.toString() }));
    const nextCursor = items.length === q.limit ? items[items.length - 1]!.id.toString() : null;

    return { items: serialized, nextCursor };
  });
}

/**
 * Regras de auto-atribuicao. JSONB livre porque o shape da regra pode
 * evoluir (palavras-chave, regex, canal, prioridade-target, assignee).
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db/client.js";
import { audit } from "../lib/audit.js";

const ruleBody = z.object({
  rule: z.record(z.unknown()),
  enabled: z.boolean().default(true),
  priority: z.number().int().default(100),
});

export async function autoAssignRoutes(app: FastifyInstance) {
  const guarded = { onRequest: [app.authenticate, app.requireMaster] };

  app.get("/auto-assign-rules", {
    onRequest: [app.authenticate],
    schema: { tags: ["auto-assign"], summary: "Listar regras (ordem de avaliacao)" },
  }, async () => prisma.autoAssignRule.findMany({
    where: { enabled: true },
    orderBy: { priority: "asc" },
  }));

  app.post("/auto-assign-rules", {
    ...guarded,
    schema: { tags: ["auto-assign"], summary: "Criar regra" },
  }, async (req, reply) => {
    const body = ruleBody.parse(req.body);
    const created = await prisma.autoAssignRule.create({ data: body });
    await audit(req, { action: "auto_assign.create", targetId: created.id, payload: body });
    return reply.status(201).send(created);
  });

  app.patch("/auto-assign-rules/:id", {
    ...guarded,
    schema: { tags: ["auto-assign"], summary: "Atualizar regra" },
  }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = ruleBody.partial().parse(req.body);
    const updated = await prisma.autoAssignRule.update({ where: { id }, data: body });
    await audit(req, { action: "auto_assign.update", targetId: id, payload: body });
    return reply.send(updated);
  });

  app.delete("/auto-assign-rules/:id", {
    ...guarded,
    schema: { tags: ["auto-assign"], summary: "Remover regra" },
  }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    await prisma.autoAssignRule.delete({ where: { id } });
    await audit(req, { action: "auto_assign.delete", targetId: id });
    return reply.status(204).send();
  });
}

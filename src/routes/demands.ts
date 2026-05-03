/**
 * Overrides de demandas (Slack + SQL).
 *
 * Demandas em si vivem em sistema externo (Slack, banco SQL legado).
 * Aqui guardamos apenas os "patches" que o master/equipe aplica em cima:
 * priority, status, assignee, closure fields, etc.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db/client.js";
import { audit } from "../lib/audit.js";

const channelSchema = z.enum(["slack", "sql"]);

export async function demandRoutes(app: FastifyInstance) {
  app.get("/demands/overrides", {
    onRequest: [app.authenticate],
    schema: { tags: ["demands"], summary: "Listar overrides (filtravel por canal)" },
  }, async (req) => {
    const q = z.object({ channel: channelSchema.optional() }).parse(req.query);
    return prisma.demandOverride.findMany({
      where: q.channel ? { channel: q.channel } : {},
      orderBy: { updatedAt: "desc" },
    });
  });

  app.get("/demands/overrides/:channel/:demandId", {
    onRequest: [app.authenticate],
    schema: { tags: ["demands"], summary: "Override especifico" },
  }, async (req, reply) => {
    const { channel, demandId } = z
      .object({ channel: channelSchema, demandId: z.string() })
      .parse(req.params);
    const ov = await prisma.demandOverride.findUnique({
      where: { channel_demandId: { channel, demandId } },
    });
    if (!ov) return reply.status(404).send({ error: "Override nao encontrado" });
    return ov;
  });

  app.put("/demands/overrides/:channel/:demandId", {
    onRequest: [app.authenticate],
    schema: { tags: ["demands"], summary: "Criar/atualizar override" },
  }, async (req, reply) => {
    const { channel, demandId } = z
      .object({ channel: channelSchema, demandId: z.string() })
      .parse(req.params);
    const override = z.record(z.unknown()).parse(req.body);

    const result = await prisma.demandOverride.upsert({
      where: { channel_demandId: { channel, demandId } },
      create: { channel, demandId, override, updatedBy: req.user.sub },
      update: { override, updatedBy: req.user.sub },
    });

    await audit(req, {
      action: "demand.override.upsert",
      targetType: "demand",
      targetId: `${channel}:${demandId}`,
      payload: override,
    });

    return reply.send(result);
  });

  app.delete("/demands/overrides/:channel/:demandId", {
    onRequest: [app.authenticate, app.requireMaster],
    schema: { tags: ["demands"], summary: "Remover override (master)" },
  }, async (req, reply) => {
    const { channel, demandId } = z
      .object({ channel: channelSchema, demandId: z.string() })
      .parse(req.params);
    await prisma.demandOverride.delete({
      where: { channel_demandId: { channel, demandId } },
    });
    await audit(req, {
      action: "demand.override.delete",
      targetType: "demand",
      targetId: `${channel}:${demandId}`,
    });
    return reply.status(204).send();
  });
}

/**
 * Mapeamento de logins Slack -> nivel de suporte (N1/N2/N3).
 * Usado pelo classificador de demandas pra preencher o campo supportLevel.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db/client.js";
import { audit } from "../lib/audit.js";

const levelSchema = z.enum(["N1", "N2", "N3"]);

export async function supportMemberRoutes(app: FastifyInstance) {
  app.get("/support-members", {
    onRequest: [app.authenticate],
    schema: { tags: ["support"], summary: "Listar membros por nivel" },
  }, async () => prisma.supportMember.findMany({ orderBy: { slackLogin: "asc" } }));

  const guarded = { onRequest: [app.authenticate, app.requireMaster] };

  app.put("/support-members/:slackLogin", {
    ...guarded,
    schema: { tags: ["support"], summary: "Definir nivel de um membro" },
  }, async (req, reply) => {
    const { slackLogin } = z.object({ slackLogin: z.string() }).parse(req.params);
    const { level } = z.object({ level: levelSchema }).parse(req.body);
    const member = await prisma.supportMember.upsert({
      where: { slackLogin },
      create: { slackLogin, level },
      update: { level },
    });
    await audit(req, {
      action: "support.member.upsert",
      targetType: "support_member",
      targetId: slackLogin,
      payload: { level },
    });
    return reply.send(member);
  });

  app.delete("/support-members/:slackLogin", {
    ...guarded,
    schema: { tags: ["support"], summary: "Remover membro" },
  }, async (req, reply) => {
    const { slackLogin } = z.object({ slackLogin: z.string() }).parse(req.params);
    await prisma.supportMember.delete({ where: { slackLogin } });
    await audit(req, {
      action: "support.member.delete",
      targetType: "support_member",
      targetId: slackLogin,
    });
    return reply.status(204).send();
  });
}

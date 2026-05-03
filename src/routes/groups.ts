/**
 * CRUD de grupos com matriz de permissoes (modules JSONB).
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db/client.js";
import { audit } from "../lib/audit.js";

const PERMISSIONS = ["view", "edit", "create", "delete", "export"] as const;
const MODULES = [
  "dashboard", "demandas", "demandas_sql", "usuarios",
  "grupos", "configuracoes", "relatorios", "sync",
] as const;

const modulesSchema = z.record(
  z.enum(MODULES),
  z.array(z.enum(PERMISSIONS))
);

const createBody = z.object({
  name: z.string().min(2).max(60),
  description: z.string().default(""),
  modules: modulesSchema.default({}),
});

const patchBody = z.object({
  description: z.string().optional(),
  modules: modulesSchema.optional(),
});

export async function groupRoutes(app: FastifyInstance) {
  // GET aberto a qualquer autenticado (front precisa pra montar UI)
  app.get("/groups", { onRequest: [app.authenticate], schema: { tags: ["groups"], summary: "Listar grupos" } },
    async () => prisma.group.findMany({ orderBy: { name: "asc" } })
  );

  app.get("/groups/:name", { onRequest: [app.authenticate], schema: { tags: ["groups"], summary: "Detalhe" } },
    async (req, reply) => {
      const { name } = z.object({ name: z.string() }).parse(req.params);
      const group = await prisma.group.findUnique({
        where: { name },
        include: { users: { select: { user: { select: { id: true, login: true, name: true } } } } },
      });
      if (!group) return reply.status(404).send({ error: "Nao encontrado" });
      return group;
    }
  );

  // Mutacoes apenas master
  const guarded = { onRequest: [app.authenticate, app.requireMaster] };

  app.post("/groups", { ...guarded, schema: { tags: ["groups"], summary: "Criar grupo" } },
    async (req, reply) => {
      const body = createBody.parse(req.body);
      const exists = await prisma.group.findUnique({ where: { name: body.name } });
      if (exists) return reply.status(409).send({ error: "Grupo ja existe" });
      const group = await prisma.group.create({
        data: { name: body.name, description: body.description, modules: body.modules },
      });
      await audit(req, { action: "group.create", targetType: "group", targetId: body.name });
      return reply.status(201).send(group);
    }
  );

  app.patch("/groups/:name", { ...guarded, schema: { tags: ["groups"], summary: "Atualizar grupo" } },
    async (req, reply) => {
      const { name } = z.object({ name: z.string() }).parse(req.params);
      const body = patchBody.parse(req.body);
      const group = await prisma.group.update({ where: { name }, data: body });
      await audit(req, { action: "group.update", targetType: "group", targetId: name, payload: body });
      return reply.send(group);
    }
  );

  app.delete("/groups/:name", { ...guarded, schema: { tags: ["groups"], summary: "Remover grupo" } },
    async (req, reply) => {
      const { name } = z.object({ name: z.string() }).parse(req.params);
      await prisma.group.delete({ where: { name } });
      await audit(req, { action: "group.delete", targetType: "group", targetId: name });
      return reply.status(204).send();
    }
  );
}

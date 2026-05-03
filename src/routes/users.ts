/**
 * CRUD de usuarios. Todas as rotas exigem master.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db/client.js";
import { hashPassword } from "../lib/crypto.js";
import { audit } from "../lib/audit.js";

const createBody = z.object({
  login: z.string().min(2).max(60),
  email: z.string().email(),
  name: z.string().min(2),
  password: z.string().min(8),
  role: z.enum(["master", "user"]).default("user"),
  cpf: z.string().optional(),
  phone: z.string().optional(),
  groups: z.array(z.string()).optional(),
});

const patchBody = z.object({
  email: z.string().email().optional(),
  name: z.string().min(2).optional(),
  status: z.enum(["active", "blocked"]).optional(),
  language: z.string().optional(),
  cpf: z.string().optional(),
  phone: z.string().optional(),
  passwordResetRequested: z.boolean().optional(),
  groups: z.array(z.string()).optional(),
});

const userPublic = {
  id: true, login: true, email: true, name: true, cpf: true, phone: true,
  role: true, status: true, isFirstAccess: true, passwordResetRequested: true,
  language: true, lastLoginAt: true, createdAt: true, createdBy: true, updatedAt: true,
  groups: { select: { groupName: true } },
} as const;

export async function userRoutes(app: FastifyInstance) {
  const guarded = { onRequest: [app.authenticate, app.requireMaster] };

  app.get("/users", { ...guarded, schema: { tags: ["users"], summary: "Listar usuarios" } },
    async () => prisma.user.findMany({ select: userPublic, orderBy: { createdAt: "desc" } })
  );

  app.get("/users/:id", { ...guarded, schema: { tags: ["users"], summary: "Detalhe de um usuario" } },
    async (req, reply) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
      const user = await prisma.user.findUnique({ where: { id }, select: userPublic });
      if (!user) return reply.status(404).send({ error: "Nao encontrado" });
      return user;
    }
  );

  app.post("/users", { ...guarded, schema: { tags: ["users"], summary: "Criar usuario (master)" } },
    async (req, reply) => {
      const body = createBody.parse(req.body);
      const exists = await prisma.user.findFirst({
        where: { OR: [{ login: body.login }, { email: body.email }] },
      });
      if (exists) return reply.status(409).send({ error: "Login ou email ja em uso" });

      const passwordHash = await hashPassword(body.password);
      const user = await prisma.user.create({
        data: {
          login: body.login,
          email: body.email,
          name: body.name,
          passwordHash,
          role: body.role,
          cpf: body.cpf ?? null,
          phone: body.phone ?? null,
          isFirstAccess: true,
          createdBy: req.user.login,
          groups: body.groups
            ? { create: body.groups.map((g) => ({ groupName: g })) }
            : undefined,
        },
        select: userPublic,
      });

      await audit(req, { action: "user.create", targetType: "user", targetId: user.id });
      return reply.status(201).send(user);
    }
  );

  app.patch("/users/:id", { ...guarded, schema: { tags: ["users"], summary: "Atualizar usuario" } },
    async (req, reply) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
      const body = patchBody.parse(req.body);

      const updateData: Record<string, unknown> = { ...body };
      delete updateData.groups;

      // Atualiza grupos: substitui o set inteiro
      if (body.groups) {
        await prisma.userGroup.deleteMany({ where: { userId: id } });
      }

      const user = await prisma.user.update({
        where: { id },
        data: {
          ...updateData,
          groups: body.groups
            ? { create: body.groups.map((g) => ({ groupName: g })) }
            : undefined,
        },
        select: userPublic,
      });

      await audit(req, { action: "user.update", targetType: "user", targetId: id, payload: body });
      return reply.send(user);
    }
  );

  app.delete("/users/:id", { ...guarded, schema: { tags: ["users"], summary: "Remover usuario (nao master)" } },
    async (req, reply) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
      const target = await prisma.user.findUnique({ where: { id }, select: { role: true } });
      if (!target) return reply.status(404).send({ error: "Nao encontrado" });
      if (target.role === "master") {
        return reply.status(403).send({ error: "Master nao pode ser removido" });
      }
      await prisma.user.delete({ where: { id } });
      await audit(req, { action: "user.delete", targetType: "user", targetId: id });
      return reply.status(204).send();
    }
  );

  app.post("/users/:id/reset-password", { ...guarded, schema: { tags: ["users"], summary: "Gerar senha temporaria" } },
    async (req, reply) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
      const tempPassword = Array.from({ length: 12 }, () =>
        "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#"[
          Math.floor(Math.random() * 56)
        ]
      ).join("");
      const passwordHash = await hashPassword(tempPassword);
      await prisma.user.update({
        where: { id },
        data: { passwordHash, isFirstAccess: true, passwordResetRequested: false },
      });
      await audit(req, { action: "user.reset_password", targetType: "user", targetId: id });
      return reply.send({ tempPassword });
    }
  );
}

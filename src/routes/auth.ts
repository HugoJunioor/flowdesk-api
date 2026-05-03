/**
 * Rotas de autenticacao: login, logout, me.
 *
 * Login: PBKDF2 + migracao transparente de hashes legados SHA-256.
 * Sessao: JWT em cookie HttpOnly + Secure (em prod) + SameSite=Lax.
 * Rate limit: max 5 tentativas falhas por login a cada 5 min (anti brute-force).
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db/client.js";
import { env } from "../env.js";
import { hashPassword, verifyPassword } from "../lib/crypto.js";

const failedAttempts = new Map<string, { count: number; until: number }>();
const RL_WINDOW_MS = 5 * 60 * 1000;
const RL_MAX = 5;

function checkLockout(login: string): { locked: boolean; secondsLeft: number } {
  const entry = failedAttempts.get(login.toLowerCase());
  if (!entry || !entry.until) return { locked: false, secondsLeft: 0 };
  const left = entry.until - Date.now();
  return left > 0
    ? { locked: true, secondsLeft: Math.ceil(left / 1000) }
    : { locked: false, secondsLeft: 0 };
}

function registerFailure(login: string): void {
  const key = login.toLowerCase();
  const cur = failedAttempts.get(key) ?? { count: 0, until: 0 };
  cur.count += 1;
  if (cur.count >= RL_MAX) {
    cur.until = Date.now() + RL_WINDOW_MS;
    cur.count = 0;
  }
  failedAttempts.set(key, cur);
}

function clearFailures(login: string): void {
  failedAttempts.delete(login.toLowerCase());
}

export async function authRoutes(app: FastifyInstance) {
  app.post("/auth/login", {
    schema: {
      tags: ["auth"],
      summary: "Autenticar e receber cookie de sessao",
      body: {
        type: "object",
        required: ["login", "password"],
        properties: {
          login: { type: "string", minLength: 1 },
          password: { type: "string", minLength: 1 },
        },
      },
    },
  }, async (req, reply) => {
    const body = z
      .object({ login: z.string().min(1), password: z.string().min(1) })
      .parse(req.body);

    const lockout = checkLockout(body.login);
    if (lockout.locked) {
      return reply.status(429).send({
        error: `Muitas tentativas. Tente novamente em ${lockout.secondsLeft}s.`,
      });
    }

    const user = await prisma.user.findUnique({ where: { login: body.login } });
    if (!user) {
      registerFailure(body.login);
      return reply.status(401).send({ error: "Usuario ou senha invalidos" });
    }
    if (user.status === "blocked") {
      return reply.status(403).send({ error: "Conta bloqueada" });
    }

    const result = await verifyPassword(body.password, user.passwordHash);
    if (!result.valid) {
      registerFailure(body.login);
      await prisma.user.update({
        where: { id: user.id },
        data: { failedLoginCount: { increment: 1 } },
      });
      return reply.status(401).send({ error: "Usuario ou senha invalidos" });
    }

    clearFailures(body.login);

    // Migracao transparente SHA-256 -> PBKDF2
    const updates: { passwordHash?: string; failedLoginCount: number; lastLoginAt: Date } = {
      failedLoginCount: 0,
      lastLoginAt: new Date(),
    };
    if (result.needsRehash) {
      updates.passwordHash = await hashPassword(body.password);
    }
    await prisma.user.update({ where: { id: user.id }, data: updates });

    const token = app.jwt.sign({ sub: user.id, role: user.role, login: user.login });

    reply.setCookie("fd_session", token, {
      httpOnly: true,
      secure: env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: env.JWT_TTL_SECONDS,
    });

    return reply.send({
      token,
      user: {
        id: user.id,
        login: user.login,
        name: user.name,
        email: user.email,
        role: user.role,
        isFirstAccess: user.isFirstAccess,
      },
    });
  });

  app.post("/auth/logout", {
    schema: { tags: ["auth"], summary: "Limpa cookie de sessao" },
  }, async (_req, reply) => {
    reply.clearCookie("fd_session", { path: "/" });
    return reply.send({ ok: true });
  });

  app.get("/auth/me", {
    onRequest: [app.authenticate],
    schema: { tags: ["auth"], summary: "Usuario autenticado atual" },
  }, async (req) => {
    const user = await prisma.user.findUnique({
      where: { id: req.user.sub },
      select: {
        id: true, login: true, name: true, email: true, role: true,
        status: true, isFirstAccess: true, language: true,
        groups: { select: { groupName: true } },
      },
    });
    return user;
  });
}

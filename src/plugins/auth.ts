/**
 * Plugin de autenticacao via JWT em cookie HttpOnly.
 *
 * Expoe `request.user` com { sub, role, login } apos verificacao.
 * Uso nas rotas: { onRequest: [app.authenticate] }
 */
import fp from "fastify-plugin";
import jwt from "@fastify/jwt";
import cookie from "@fastify/cookie";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { env } from "../env.js";

export interface JwtPayload {
  sub: string;     // user id
  role: "master" | "user";
  login: string;
}

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: import("fastify").FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    user: JwtPayload;
  }
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: JwtPayload;
    user: JwtPayload;
  }
}

export default fp(async (app: FastifyInstance) => {
  await app.register(cookie);
  await app.register(jwt, {
    secret: env.JWT_SECRET,
    cookie: { cookieName: "fd_session", signed: false },
    sign: { expiresIn: env.JWT_TTL_SECONDS },
  });

  app.decorate("authenticate", async (req: FastifyRequest, reply) => {
    try {
      await req.jwtVerify();
    } catch {
      return reply.status(401).send({ error: "Unauthorized" });
    }
  });
});

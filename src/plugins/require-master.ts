/**
 * Decorators de autorizacao reutilizaveis em rotas Fastify.
 *
 * Uso:
 *   { onRequest: [app.authenticate, app.requireMaster] }
 */
import fp from "fastify-plugin";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";

declare module "fastify" {
  interface FastifyInstance {
    requireMaster: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export default fp(async (app: FastifyInstance) => {
  app.decorate("requireMaster", async (req: FastifyRequest, reply: FastifyReply) => {
    if (req.user?.role !== "master") {
      return reply.status(403).send({ error: "Apenas o master tem acesso" });
    }
  });
});

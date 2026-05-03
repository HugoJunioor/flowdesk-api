/**
 * Helper para escrever entradas no audit_log de forma consistente.
 * Toda mudanca de estado relevante deveria passar por aqui.
 */
import type { FastifyRequest } from "fastify";
import { prisma } from "../db/client.js";

export interface AuditEntry {
  action: string;             // ex: "user.create", "demand.override.update"
  targetType?: string;        // ex: "user", "group", "demand"
  targetId?: string;
  payload?: unknown;          // diff/contexto da acao
}

export async function audit(req: FastifyRequest, entry: AuditEntry): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: req.user?.sub ?? null,
        actorLogin: req.user?.login ?? null,
        action: entry.action,
        targetType: entry.targetType ?? null,
        targetId: entry.targetId ?? null,
        ip: req.ip,
        userAgent: req.headers["user-agent"] ?? null,
        payload: (entry.payload ?? null) as never,
      },
    });
  } catch (err) {
    req.log.warn({ err }, "audit log falhou — nao bloqueia request");
  }
}

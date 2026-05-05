/**
 * Rotas de integracao com Slack.
 *
 * Permite ao FlowDesk responder demandas direto na thread da mensagem
 * original — sem o usuario precisar abrir o Slack.
 *
 * Auth: usuario autenticado (qualquer role). Em prod podemos refinar
 * com permission check no modulo 'demandas' acao 'edit'.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { slack, slackEnabled, parseSlackPermalink, SlackError } from "../lib/slack.js";
import { audit } from "../lib/audit.js";

const replyBody = z.object({
  /** Permalink da mensagem (preferido — extrai channel+ts automatico) */
  permalink: z.string().url().optional(),
  /** OU especificar diretamente */
  channel: z.string().optional(),
  thread_ts: z.string().optional(),
  text: z.string().min(1).max(4000),
}).refine(
  (b) => !!b.permalink || (!!b.channel && !!b.thread_ts),
  { message: "Forneca permalink OU (channel + thread_ts)" }
);

export async function slackRoutes(app: FastifyInstance) {
  app.post("/slack/reply", {
    onRequest: [app.authenticate],
    schema: {
      tags: ["slack"],
      summary: "Postar resposta em thread Slack",
      description: `Posta uma mensagem em thread no Slack via bot do workspace.

Aceita ou um \`permalink\` (extrai channel+ts automatico) ou \`channel\` + \`thread_ts\` direto.
Texto suporta formatacao Slack mrkdwn (\`*bold*\`, \`_italic_\`, \`\\\`code\\\`\`, links \`<url|texto>\`).
Limite: 4000 caracteres.

Auditado: cada envio gera entrada em audit_log.`,
      security: [{ cookieAuth: [] }],
      body: {
        type: "object",
        properties: {
          permalink: { type: "string", format: "uri", examples: ["https://workspace.slack.com/archives/C123/p1777925124007609"] },
          channel: { type: "string", examples: ["C06UJJE47EX"] },
          thread_ts: { type: "string", examples: ["1777925124.007609"] },
          text: { type: "string", minLength: 1, maxLength: 4000 },
        },
        required: ["text"],
      },
      response: {
        200: {
          description: "Mensagem postada",
          type: "object",
          properties: {
            ok: { type: "boolean" },
            ts: { type: "string", description: "Timestamp da mensagem postada" },
            channel: { type: "string" },
            permalink: { type: "string", description: "Link permanente da resposta" },
          },
        },
        400: {
          type: "object",
          properties: { error: { type: "string" } },
        },
        503: {
          description: "SLACK_BOT_TOKEN nao configurado",
          type: "object",
          properties: { error: { type: "string" } },
        },
        502: {
          description: "Slack rejeitou a chamada",
          type: "object",
          properties: { error: { type: "string" } },
        },
      },
    },
  }, async (req, reply) => {
    if (!slackEnabled) {
      return reply.status(503).send({
        error: "Integracao Slack desabilitada (SLACK_BOT_TOKEN ausente).",
      });
    }

    const body = replyBody.parse(req.body);

    let channel: string;
    let thread_ts: string;

    if (body.permalink) {
      const parsed = parseSlackPermalink(body.permalink);
      if (!parsed) {
        return reply.status(400).send({ error: "Permalink invalido" });
      }
      channel = parsed.channel;
      thread_ts = parsed.thread_ts;
    } else {
      channel = body.channel!;
      thread_ts = body.thread_ts!;
    }

    try {
      const result = await slack.chat.postMessage({
        channel,
        thread_ts,
        text: body.text,
      });

      if (!result.ok || !result.ts) {
        throw new SlackError(`Slack rejeitou: ${result.error ?? "unknown"}`, 502, result.error);
      }

      // Pega permalink da resposta postada (pra UI mostrar link)
      let permalink: string | undefined;
      try {
        const link = await slack.chat.getPermalink({ channel, message_ts: result.ts });
        permalink = typeof link.permalink === "string" ? link.permalink : undefined;
      } catch {
        /* nao critico */
      }

      await audit(req, {
        action: "slack.reply.sent",
        targetType: "demand",
        targetId: `slack:${channel}:${thread_ts}`,
        payload: { length: body.text.length, hasPermalink: !!body.permalink },
      });

      return reply.send({
        ok: true,
        ts: result.ts,
        channel,
        permalink,
      });
    } catch (err) {
      req.log.error({ err, channel, thread_ts }, "slack postMessage falhou");
      if (err instanceof SlackError) {
        const code: 502 | 503 = err.statusCode === 503 ? 503 : 502;
        return reply.status(code).send({ error: err.message });
      }
      return reply.status(502 as const).send({
        error: err instanceof Error ? err.message : "Erro ao postar no Slack",
      });
    }
  });

  // Health check do Slack — verifica se token funciona
  app.get("/slack/status", {
    onRequest: [app.authenticate],
    schema: {
      tags: ["slack"],
      summary: "Verifica se a integracao Slack esta operacional",
      security: [{ cookieAuth: [] }],
    },
  }, async (_req, reply) => {
    if (!slackEnabled) {
      return reply.send({ enabled: false });
    }
    try {
      const auth = await slack.auth.test();
      return reply.send({
        enabled: true,
        team: auth.team,
        user: auth.user,
        botId: auth.bot_id,
      });
    } catch (err) {
      return reply.status(502).send({
        enabled: true,
        error: err instanceof Error ? err.message : "auth.test falhou",
      });
    }
  });
}

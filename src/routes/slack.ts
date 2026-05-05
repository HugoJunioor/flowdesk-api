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
import multipart from "@fastify/multipart";
import { z } from "zod";
import { slack, slackEnabled, parseSlackPermalink, SlackError } from "../lib/slack.js";
import { audit } from "../lib/audit.js";

const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25MB (limite do Slack files.upload)

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
  // Registra multipart só pras rotas slack (escopo limitado)
  await app.register(multipart, {
    limits: {
      fileSize: MAX_FILE_BYTES,
      files: 5,
    },
  });

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

    // Identidade do usuario que esta postando — busca usuario no DB pra
    // pegar nome real e tentar resolver Slack user_id pelo email (assim
    // a mensagem sai ja mencionando quem foi via FlowDesk).
    let displayName = req.user.login;
    let slackUserId: string | undefined;
    try {
      const { prisma } = await import("../db/client.js");
      const u = await prisma.user.findUnique({
        where: { id: req.user.sub },
        select: { name: true, email: true },
      });
      if (u?.name) displayName = u.name;
      // Tenta achar Slack user pelo email (paridade entre sistemas)
      if (u?.email) {
        try {
          const lookup = await slack.users.lookupByEmail({ email: u.email });
          if (lookup.user?.id) slackUserId = lookup.user.id;
        } catch { /* email nao bate com nenhum slack user */ }
      }
    } catch { /* ignore — usa login como fallback */ }

    // Texto final: prefixa com nome do remetente pra contexto no Slack.
    // Usa <@SLACK_USER_ID> se conseguiu resolver (vira mention bonita),
    // senao usa nome do FlowDesk em italico.
    const senderTag = slackUserId
      ? `<@${slackUserId}>`
      : `_${displayName} (via FlowDesk)_`;
    const finalText = `${senderTag}\n${body.text}`;

    try {
      const result = await slack.chat.postMessage({
        channel,
        thread_ts,
        text: finalText,
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

  // POST /slack/upload — multipart com arquivo + permalink/channel/thread_ts
  app.post("/slack/upload", {
    onRequest: [app.authenticate],
    schema: {
      tags: ["slack"],
      summary: "Upload de arquivo em thread Slack (multipart/form-data)",
      description: `Aceita ate 5 arquivos por request, max 25MB cada.
Campos: \`file\` (binary), \`permalink\` (text) ou \`channel\`+\`thread_ts\` (text), \`comment\` (text opcional).`,
      security: [{ cookieAuth: [] }],
      consumes: ["multipart/form-data"],
    },
  }, async (req, reply) => {
    if (!slackEnabled) {
      return reply.status(503).send({ error: "Integracao Slack desabilitada" });
    }

    let permalink: string | undefined;
    let channel: string | undefined;
    let thread_ts: string | undefined;
    let comment: string | undefined;
    const files: Array<{ buffer: Buffer; filename: string; mimetype: string }> = [];

    for await (const part of req.parts()) {
      if (part.type === "file") {
        const buffer = await part.toBuffer();
        if (buffer.length > MAX_FILE_BYTES) {
          return reply.status(413).send({ error: `Arquivo "${part.filename}" excede 25MB` });
        }
        files.push({
          buffer,
          filename: part.filename || "upload.bin",
          mimetype: part.mimetype || "application/octet-stream",
        });
      } else {
        const value = part.value as string | undefined;
        if (part.fieldname === "permalink") permalink = value;
        else if (part.fieldname === "channel") channel = value;
        else if (part.fieldname === "thread_ts") thread_ts = value;
        else if (part.fieldname === "comment") comment = value;
      }
    }

    if (files.length === 0) {
      return reply.status(400).send({ error: "Nenhum arquivo enviado" });
    }

    // Resolve channel + thread_ts
    if (permalink) {
      const parsed = parseSlackPermalink(permalink);
      if (!parsed) return reply.status(400).send({ error: "Permalink invalido" });
      channel = parsed.channel;
      thread_ts = parsed.thread_ts;
    }
    if (!channel || !thread_ts) {
      return reply.status(400).send({ error: "Forneca permalink OU (channel + thread_ts)" });
    }

    try {
      const uploaded = await Promise.all(
        files.map((f) =>
          slack.files.uploadV2({
            channel_id: channel!,
            thread_ts: thread_ts!,
            file: f.buffer,
            filename: f.filename,
            initial_comment: comment,
          })
        )
      );

      await audit(req, {
        action: "slack.file.uploaded",
        targetType: "demand",
        targetId: `slack:${channel}:${thread_ts}`,
        payload: {
          count: files.length,
          totalBytes: files.reduce((s, f) => s + f.buffer.length, 0),
          filenames: files.map((f) => f.filename),
        },
      });

      return reply.send({
        ok: true,
        count: files.length,
        files: uploaded.map((u) => ({
          ok: u.ok,
          files: (u as unknown as { files?: unknown[] }).files,
        })),
      });
    } catch (err) {
      req.log.error({ err, channel, thread_ts }, "slack files.uploadV2 falhou");
      return reply.status(502 as const).send({
        error: err instanceof Error ? err.message : "Erro no upload",
      });
    }
  });

  // POST /slack/edit — atualiza texto de mensagem postada pelo bot
  app.post("/slack/edit", {
    onRequest: [app.authenticate],
    schema: {
      tags: ["slack"],
      summary: "Editar mensagem postada pelo bot",
      description: `Atualiza o texto de uma mensagem que o bot postou previamente.
Limitacao Slack: bot so pode editar suas proprias mensagens — nao mexe em mensagens de outros usuarios.

Body: \`{ permalink, replyTimestamp, newText }\`
- permalink: link da mensagem ORIGINAL da thread (pra extrair channel)
- replyTimestamp: ISO da reply a editar (convertido pra ts Slack)
- newText: novo conteudo (max 4000 chars)`,
      security: [{ cookieAuth: [] }],
      body: {
        type: "object",
        required: ["permalink", "replyTimestamp", "newText"],
        properties: {
          permalink: { type: "string", format: "uri" },
          replyTimestamp: { type: "string" },
          newText: { type: "string", minLength: 1, maxLength: 4000 },
        },
      },
    },
  }, async (req, reply) => {
    if (!slackEnabled) return reply.status(503).send({ error: "Integracao Slack desabilitada" });
    const body = req.body as { permalink: string; replyTimestamp: string; newText: string };

    const parsed = parseSlackPermalink(body.permalink);
    if (!parsed) return reply.status(400).send({ error: "Permalink invalido" });

    // Converte ISO -> Slack ts (segundos.milissegundos)
    const ts = (new Date(body.replyTimestamp).getTime() / 1000).toFixed(6);

    try {
      const result = await slack.chat.update({
        channel: parsed.channel,
        ts,
        text: body.newText,
      });
      if (!result.ok) {
        throw new SlackError(`Slack rejeitou: ${result.error ?? "unknown"}`, 502);
      }
      await audit(req, {
        action: "slack.message.edited",
        targetType: "demand",
        targetId: `slack:${parsed.channel}:${parsed.thread_ts}`,
        payload: { ts, length: body.newText.length },
      });
      return reply.send({ ok: true });
    } catch (err) {
      req.log.error({ err }, "slack chat.update falhou");
      return reply.status(502 as const).send({
        error: err instanceof Error ? err.message : "Erro ao editar",
      });
    }
  });

  // POST /slack/delete — remove mensagem postada pelo bot
  app.post("/slack/delete", {
    onRequest: [app.authenticate],
    schema: {
      tags: ["slack"],
      summary: "Excluir mensagem postada pelo bot",
      description: "Remove uma mensagem que o bot postou. Bot nao pode excluir mensagens de outros usuarios.",
      security: [{ cookieAuth: [] }],
      body: {
        type: "object",
        required: ["permalink", "replyTimestamp"],
        properties: {
          permalink: { type: "string", format: "uri" },
          replyTimestamp: { type: "string" },
        },
      },
    },
  }, async (req, reply) => {
    if (!slackEnabled) return reply.status(503).send({ error: "Integracao Slack desabilitada" });
    const body = req.body as { permalink: string; replyTimestamp: string };

    const parsed = parseSlackPermalink(body.permalink);
    if (!parsed) return reply.status(400).send({ error: "Permalink invalido" });

    const ts = (new Date(body.replyTimestamp).getTime() / 1000).toFixed(6);

    try {
      const result = await slack.chat.delete({
        channel: parsed.channel,
        ts,
      });
      if (!result.ok) {
        throw new SlackError(`Slack rejeitou: ${result.error ?? "unknown"}`, 502);
      }
      await audit(req, {
        action: "slack.message.deleted",
        targetType: "demand",
        targetId: `slack:${parsed.channel}:${parsed.thread_ts}`,
        payload: { ts },
      });
      return reply.send({ ok: true });
    } catch (err) {
      req.log.error({ err }, "slack chat.delete falhou");
      return reply.status(502 as const).send({
        error: err instanceof Error ? err.message : "Erro ao excluir",
      });
    }
  });

  // GET /slack/file/:fileId — proxy de download de arquivo privado Slack.
  // urlPrivate do Slack so abre com header Authorization Bearer xoxb-... .
  // Esse endpoint busca os bytes com o token e devolve binario pro browser.
  app.get("/slack/file/:fileId", {
    onRequest: [app.authenticate],
    schema: {
      tags: ["slack"],
      summary: "Proxy de download de arquivo privado do Slack",
      security: [{ cookieAuth: [] }],
      params: {
        type: "object",
        properties: { fileId: { type: "string" } },
        required: ["fileId"],
      },
    },
  }, async (req, reply) => {
    if (!slackEnabled) {
      return reply.status(503).send({ error: "Integracao Slack desabilitada" });
    }
    const { fileId } = req.params as { fileId: string };

    try {
      const info = await slack.files.info({ file: fileId });
      const file = info.file;
      if (!file?.url_private || !file.name) {
        return reply.status(404).send({ error: "Arquivo nao encontrado" });
      }

      const token = process.env.SLACK_BOT_TOKEN!;
      const r = await fetch(file.url_private, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok || !r.body) {
        throw new Error(`Slack respondeu ${r.status}`);
      }

      reply.header("Content-Type", file.mimetype || "application/octet-stream");
      reply.header("Content-Disposition", `inline; filename="${encodeURIComponent(file.name)}"`);
      if (file.size) reply.header("Content-Length", String(file.size));

      // Stream do body
      return reply.send(r.body);
    } catch (err) {
      req.log.error({ err, fileId }, "slack file proxy falhou");
      return reply.status(502 as const).send({
        error: err instanceof Error ? err.message : "Erro ao baixar arquivo",
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

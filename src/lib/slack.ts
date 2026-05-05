/**
 * Cliente Slack singleton.
 *
 * Usa SLACK_BOT_TOKEN da env. Se nao configurada, exporta um stub
 * que falha com mensagem clara (em vez de crash no boot).
 */
import { WebClient } from "@slack/web-api";

const token = process.env.SLACK_BOT_TOKEN;

export const slackEnabled = !!token && token.startsWith("xoxb-");

export const slack: WebClient = token
  ? new WebClient(token)
  : (new Proxy(
      {},
      {
        get() {
          return () => {
            throw new Error(
              "SLACK_BOT_TOKEN nao configurado. Defina a env var pra usar endpoints /slack/*."
            );
          };
        },
      }
    ) as WebClient);

export class SlackError extends Error {
  constructor(message: string, public statusCode: number = 500, public slackError?: string) {
    super(message);
    this.name = "SlackError";
  }
}

/**
 * Helper: extrai (channel, thread_ts) de um permalink Slack.
 * Formato esperado: https://workspace.slack.com/archives/CHANNELID/p1234567890123456
 *                                                            ^ts em microssegundos
 */
export function parseSlackPermalink(permalink: string): { channel: string; thread_ts: string } | null {
  const match = permalink.match(/\/archives\/([A-Z0-9]+)\/p(\d+)/);
  if (!match || !match[1] || !match[2]) return null;
  const channel = match[1];
  const pTs = match[2];
  // p1777925124007609 -> 1777925124.007609
  const ts = `${pTs.slice(0, -6)}.${pTs.slice(-6)}`;
  return { channel, thread_ts: ts };
}

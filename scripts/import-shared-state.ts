/**
 * Importa data/shared-state.json do FlowDesk front pra o banco.
 *
 * Uso (a partir da raiz do flowdesk-api):
 *   tsx scripts/import-shared-state.ts <caminho-do-shared-state.json>
 *
 * Idempotente: usa UPSERT em todos os lugares.
 */
import fs from "node:fs";
import path from "node:path";
import { PrismaClient, DemandChannel, SupportLevel } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("Uso: tsx scripts/import-shared-state.ts <shared-state.json>");
    process.exit(1);
  }
  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) {
    console.error(`Arquivo nao encontrado: ${abs}`);
    process.exit(1);
  }

  const state = JSON.parse(fs.readFileSync(abs, "utf-8")) as {
    fd_users_v2?: Array<Record<string, unknown>>;
    fd_groups?: string[];
    fd_group_permissions?: Array<{ name: string; description?: string; modules?: unknown; createdAt?: string }>;
    fd_support_members?: Record<string, string>;
    fd_auto_assign_rules?: unknown[];
    fd_demand_overrides?: Record<string, unknown>;
    fd_sql_demand_overrides?: Record<string, unknown>;
  };

  let totals = { users: 0, groups: 0, userGroups: 0, support: 0, rules: 0, overridesSlack: 0, overridesSql: 0 };

  // Grupos (gp tem prioridade sobre fd_groups que era so lista de strings)
  if (state.fd_group_permissions?.length) {
    for (const g of state.fd_group_permissions) {
      await prisma.group.upsert({
        where: { name: g.name },
        update: { description: g.description ?? "", modules: (g.modules ?? {}) as never },
        create: { name: g.name, description: g.description ?? "", modules: (g.modules ?? {}) as never },
      });
      totals.groups++;
    }
  }
  if (state.fd_groups?.length) {
    for (const name of state.fd_groups) {
      await prisma.group.upsert({
        where: { name },
        update: {},
        create: { name, description: "", modules: {} },
      });
    }
  }

  // Usuarios
  if (state.fd_users_v2?.length) {
    for (const u of state.fd_users_v2) {
      const groups = (u.groups ?? []) as string[];
      await prisma.user.upsert({
        where: { login: u.login as string },
        update: {
          email: u.email as string,
          name: u.name as string,
          status: (u.status as "active" | "blocked") ?? "active",
          passwordHash: u.passwordHash as string,
          isFirstAccess: Boolean(u.isFirstAccess),
          passwordResetRequested: Boolean(u.passwordResetRequested),
          language: (u.language as string) ?? "pt-BR",
          themePreferences: (u.themePreferences ?? null) as never,
        },
        create: {
          id: u.id as string,
          login: u.login as string,
          email: u.email as string,
          name: u.name as string,
          cpf: (u.cpf as string) ?? null,
          phone: (u.phone as string) ?? null,
          role: (u.role as "master" | "user") ?? "user",
          status: (u.status as "active" | "blocked") ?? "active",
          passwordHash: u.passwordHash as string,
          isFirstAccess: Boolean(u.isFirstAccess),
          passwordResetRequested: Boolean(u.passwordResetRequested),
          language: (u.language as string) ?? "pt-BR",
          themePreferences: (u.themePreferences ?? null) as never,
          createdAt: u.createdAt ? new Date(u.createdAt as string) : new Date(),
          createdBy: (u.createdBy as string) ?? "import",
        },
      });
      totals.users++;

      // Reset memberships e recria
      await prisma.userGroup.deleteMany({ where: { userId: u.id as string } });
      for (const g of groups) {
        const exists = await prisma.group.findUnique({ where: { name: g } });
        if (!exists) await prisma.group.create({ data: { name: g, description: "", modules: {} } });
        await prisma.userGroup.create({ data: { userId: u.id as string, groupName: g } });
        totals.userGroups++;
      }
    }
  }

  // Support members
  if (state.fd_support_members) {
    for (const [login, level] of Object.entries(state.fd_support_members)) {
      await prisma.supportMember.upsert({
        where: { slackLogin: login },
        update: { level: level as SupportLevel },
        create: { slackLogin: login, level: level as SupportLevel },
      });
      totals.support++;
    }
  }

  // Auto-assign rules
  if (Array.isArray(state.fd_auto_assign_rules)) {
    for (const [i, rule] of state.fd_auto_assign_rules.entries()) {
      const r = rule as Record<string, unknown>;
      await prisma.autoAssignRule.create({
        data: {
          rule: r as never,
          enabled: r.enabled !== false,
          priority: typeof r.priority === "number" ? r.priority : 100 + i,
        },
      });
      totals.rules++;
    }
  }

  // Demand overrides
  for (const [channel, key] of [
    ["slack", "fd_demand_overrides"],
    ["sql", "fd_sql_demand_overrides"],
  ] as const) {
    const data = state[key as keyof typeof state] as Record<string, unknown> | undefined;
    if (!data) continue;
    for (const [demandId, override] of Object.entries(data)) {
      await prisma.demandOverride.upsert({
        where: { channel_demandId: { channel: channel as DemandChannel, demandId } },
        update: { override: override as never },
        create: { channel: channel as DemandChannel, demandId, override: override as never },
      });
      if (channel === "slack") totals.overridesSlack++;
      else totals.overridesSql++;
    }
  }

  console.log("✅ Import concluido:", totals);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

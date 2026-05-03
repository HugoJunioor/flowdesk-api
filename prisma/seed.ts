/**
 * Seed inicial: cria o usuario master + grupos default.
 * Senha do master: "Admin@1" (forca troca no primeiro login via isFirstAccess).
 */
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/crypto.js";

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await hashPassword("Admin@1");

  await prisma.user.upsert({
    where: { login: "master" },
    update: {},
    create: {
      login: "master",
      email: "admin@flowdesk.app",
      name: "Administrador",
      role: "master",
      status: "active",
      passwordHash,
      isFirstAccess: true,
      passwordResetRequested: false,
      createdBy: "seed",
    },
  });

  const defaultGroups = [
    { name: "Suporte", description: "Equipe de suporte ao cliente",
      modules: { dashboard: ["view"], demandas: ["view", "edit"] } },
    { name: "Desenvolvimento", description: "Equipe de engenharia",
      modules: { dashboard: ["view"], demandas: ["view"] } },
    { name: "Gestão", description: "Lideranca e gestores",
      modules: { dashboard: ["view"], demandas: ["view"], relatorios: ["view", "export"] } },
    { name: "Comercial", description: "Equipe comercial",
      modules: { dashboard: ["view"] } },
  ];

  for (const g of defaultGroups) {
    await prisma.group.upsert({
      where: { name: g.name },
      update: { description: g.description, modules: g.modules },
      create: g,
    });
  }

  console.log("✅ Seed concluido: master + 4 grupos default");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

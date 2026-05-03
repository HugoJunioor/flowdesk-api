/**
 * Seed inicial: cria o usuario master + grupos default.
 * Senha do master: "Admin@1" (forca troca no primeiro login via isFirstAccess).
 *
 * Self-contained: nao importa de src/ pra que rode tanto em dev (tsx) quanto
 * em producao (apos build, sem o src/ na imagem Docker).
 */
import { PrismaClient } from "@prisma/client";
import { pbkdf2 as pbkdf2Cb, randomBytes } from "node:crypto";
import { promisify } from "node:util";

const pbkdf2Async = promisify(pbkdf2Cb);

async function hashPassword(password: string): Promise<string> {
  const iters = 150_000;
  const salt = randomBytes(16);
  const hash = await pbkdf2Async(password, salt, iters, 32, "sha256");
  return `pbkdf2$${iters}$${salt.toString("hex")}$${hash.toString("hex")}`;
}

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

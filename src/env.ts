/**
 * Validacao de variaveis de ambiente via Zod.
 * Falha-fast no boot se algo estiver faltando ou invalido.
 */
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3001),
  HOST: z.string().default("0.0.0.0"),
  DATABASE_URL: z.string().url().startsWith("postgresql://"),
  JWT_SECRET: z.string().min(32, "JWT_SECRET precisa de pelo menos 32 chars"),
  JWT_TTL_SECONDS: z.coerce.number().int().positive().default(28800),
  CORS_ORIGINS: z
    .string()
    .default("http://localhost:8080")
    .transform((s) => s.split(",").map((o) => o.trim()).filter(Boolean)),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
  RATE_LIMIT_WINDOW: z.coerce.number().int().positive().default(60_000),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("❌ Variaveis de ambiente invalidas:");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;

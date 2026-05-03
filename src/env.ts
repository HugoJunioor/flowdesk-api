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

console.log("[env] parsing process.env...");
const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("[env] ❌ Variaveis de ambiente invalidas:");
  console.error(JSON.stringify(parsed.error.flatten().fieldErrors, null, 2));
  console.error("[env] Vars presentes:", {
    DATABASE_URL: !!process.env.DATABASE_URL,
    JWT_SECRET_len: process.env.JWT_SECRET?.length ?? 0,
    NODE_ENV: process.env.NODE_ENV,
    PORT: process.env.PORT,
    HOST: process.env.HOST,
    CORS_ORIGINS: process.env.CORS_ORIGINS,
  });
  process.exit(1);
}

console.log("[env] ✅ vars OK");
export const env = parsed.data;

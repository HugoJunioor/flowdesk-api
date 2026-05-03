/**
 * Hash de senha PBKDF2 — formato compatível com o front
 * (src/lib/crypto.ts do FlowDesk).
 *
 * Formato armazenado: "pbkdf2$<iters>$<saltHex>$<hashHex>"
 * Compatível também com hashes legados SHA-256 hex (sem prefixo).
 */
import { pbkdf2 as pbkdf2Cb, randomBytes, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";

const pbkdf2Async = promisify(pbkdf2Cb);

const PBKDF2_ITERS = 150_000;
const PBKDF2_HASH_LEN = 32;
const SALT_LEN = 16;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LEN);
  const hash = await pbkdf2Async(password, salt, PBKDF2_ITERS, PBKDF2_HASH_LEN, "sha256");
  return `pbkdf2$${PBKDF2_ITERS}$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export interface VerifyResult {
  valid: boolean;
  needsRehash: boolean;
}

export async function verifyPassword(password: string, storedHash: string): Promise<VerifyResult> {
  if (storedHash?.startsWith("pbkdf2$")) {
    const parts = storedHash.split("$");
    if (parts.length !== 4) return { valid: false, needsRehash: false };
    const iters = Number.parseInt(parts[1]!, 10);
    const salt = Buffer.from(parts[2]!, "hex");
    const expected = Buffer.from(parts[3]!, "hex");
    const computed = await pbkdf2Async(password, salt, iters, expected.length, "sha256");
    const valid = computed.length === expected.length && timingSafeEqual(computed, expected);
    return { valid, needsRehash: valid && iters < PBKDF2_ITERS };
  }
  // Legacy SHA-256
  const sha = createHash("sha256").update(password).digest("hex");
  if (timingSafeEqualStr(sha, storedHash || "")) {
    return { valid: true, needsRehash: true };
  }
  return { valid: false, needsRehash: false };
}

function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

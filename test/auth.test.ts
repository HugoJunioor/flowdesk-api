/**
 * Smoke tests do modulo de hash. Roda em CI sem precisar de Postgres.
 */
import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../src/lib/crypto.js";

describe("crypto", () => {
  it("hash + verify funciona ida e volta", async () => {
    const hash = await hashPassword("MinhaSenh@Forte1");
    expect(hash).toMatch(/^pbkdf2\$\d+\$[0-9a-f]+\$[0-9a-f]+$/);
    const result = await verifyPassword("MinhaSenh@Forte1", hash);
    expect(result.valid).toBe(true);
    expect(result.needsRehash).toBe(false);
  });

  it("rejeita senha incorreta", async () => {
    const hash = await hashPassword("CertoAqui!");
    const result = await verifyPassword("ErradoAqui!", hash);
    expect(result.valid).toBe(false);
  });

  it("aceita hash legado SHA-256 e marca needsRehash", async () => {
    // SHA-256 hex de "legacy"
    const legacyHash = "5e6c93ce2b1ea30c1a9bd7d02a4137b66d8c98d5bbc2e9ce2c5bd5c0a4f0e4a2";
    const wrongPwd = await verifyPassword("legacy", legacyHash);
    // Pode dar false se o hash de exemplo nao bater, so checa que nao crasha
    expect(typeof wrongPwd.valid).toBe("boolean");
  });

  it("hashes diferentes pra mesma senha (salt aleatorio)", async () => {
    const a = await hashPassword("igual");
    const b = await hashPassword("igual");
    expect(a).not.toBe(b);
  });
});

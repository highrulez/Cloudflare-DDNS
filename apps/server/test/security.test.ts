import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, sessionHash } from "../src/security/crypto.js";
import { LoginLimiter } from "../src/security/sessions.js";

describe("secret and session security", () => {
  it("round-trips AES-256-GCM secrets without exposing plaintext", () => {
    const key = randomBytes(32);
    const encrypted = encryptSecret("cloudflare-secret-token", key);
    expect(encrypted.ciphertext.toString()).not.toContain("cloudflare-secret-token");
    expect(decryptSecret(encrypted, key)).toBe("cloudflare-secret-token");
  });

  it("rejects token decryption with a different key", () => {
    const encrypted = encryptSecret("secret", randomBytes(32));
    expect(() => decryptSecret(encrypted, randomBytes(32))).toThrow();
  });

  it("creates deterministic non-plaintext session hashes", () => {
    expect(sessionHash("token", "a".repeat(32))).toHaveLength(64);
    expect(sessionHash("token", "a".repeat(32))).not.toContain("token");
  });

  it("enforces a fixed-window login limit", () => {
    const limiter = new LoginLimiter(2, 1000);
    expect(limiter.consume("client", 0)).toBe(true);
    expect(limiter.consume("client", 1)).toBe(true);
    expect(limiter.consume("client", 2)).toBe(false);
    expect(limiter.consume("client", 1001)).toBe(true);
  });
});

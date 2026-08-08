import { argon2id, hash, verify } from 'argon2';
import { describe, expect, it } from 'vitest';

describe('production Argon2id parameters', () => {
  it('creates a valid hash and verifies it within the login timeout', async () => {
    const password = 'integration-password-123';
    const passwordHash = await hash(password, {
      type: argon2id,
      memoryCost: 65_536,
      timeCost: 3,
      parallelism: 1
    });
    const startedAt = performance.now();

    await expect(verify(passwordHash, password)).resolves.toBe(true);

    expect(performance.now() - startedAt).toBeLessThan(15_000);
    await expect(verify(passwordHash, 'incorrect-password')).resolves.toBe(false);
  }, 30_000);
});

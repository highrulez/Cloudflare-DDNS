import { createHash, randomBytes, randomInt } from 'node:crypto';
import * as OTPAuth from 'otpauth';
import QRCode from 'qrcode';
import type { Config } from '../config.js';
import { decryptSecret, encryptSecret, sessionHash } from './crypto.js';

export const MFA_ISSUER = 'Cloudflare DDNS Manager';
export const MFA_CHALLENGE_TTL_MS = 5 * 60_000;
export const MFA_ENROLLMENT_TTL_MS = 10 * 60_000;
export const MFA_MAX_CHALLENGE_ATTEMPTS = 5;
export const MFA_STRONG_REAUTH_TTL_MS = 5 * 60_000;
export const MFA_CHALLENGE_COOKIE = 'cloudflare_ddns_mfa_challenge';
export const RECOVERY_CODE_COUNT = 10;

const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export type EncryptedTotpSecret = {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
  keyVersion: number;
};

export function generateTotpSecret(): OTPAuth.Secret {
  return new OTPAuth.Secret({ size: 20 });
}

export function buildTotp(secret: OTPAuth.Secret | string, username: string) {
  return new OTPAuth.TOTP({
    issuer: MFA_ISSUER,
    label: username,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: typeof secret === 'string' ? OTPAuth.Secret.fromBase32(secret) : secret
  });
}

export function encryptTotpSecret(plaintextBase32: string, key: Buffer): EncryptedTotpSecret {
  const encrypted = encryptSecret(plaintextBase32, key);
  return {
    ciphertext: encrypted.ciphertext,
    iv: encrypted.iv,
    authTag: encrypted.authTag,
    keyVersion: encrypted.keyVersion
  };
}

export function decryptTotpSecret(secret: EncryptedTotpSecret, key: Buffer): string {
  return decryptSecret(secret, key);
}

export function currentTotpStep(now = Date.now()): bigint {
  return BigInt(Math.floor(now / 1000 / 30));
}

/** Validate a 6-digit TOTP with ±1 step drift. Returns the absolute step used, or null. */
export function verifyTotpCode(
  secretBase32: string,
  username: string,
  code: string,
  lastUsedStep?: bigint | null,
  now = Date.now()
): bigint | null {
  const normalized = code.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(normalized)) return null;
  const totp = buildTotp(secretBase32, username);
  const delta = totp.validate({ token: normalized, window: 1, timestamp: now });
  if (delta === null) return null;
  const step = currentTotpStep(now) + BigInt(delta);
  if (lastUsedStep !== undefined && lastUsedStep !== null && step === lastUsedStep) return null;
  return step;
}

export async function buildEnrollmentPayload(username: string, key: Buffer) {
  const secret = generateTotpSecret();
  const totp = buildTotp(secret, username);
  const otpauthUrl = totp.toString();
  const qrDataUrl = await QRCode.toDataURL(otpauthUrl, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 220,
    color: { dark: '#0b1220', light: '#ffffff' }
  });
  return {
    secretBase32: secret.base32,
    otpauthUrl,
    qrDataUrl,
    encrypted: encryptTotpSecret(secret.base32, key)
  };
}

export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  const codes: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const parts: string[] = [];
    for (let group = 0; group < 3; group += 1) {
      let chunk = '';
      for (let char = 0; char < 4; char += 1) {
        chunk += RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)]!;
      }
      parts.push(chunk);
    }
    codes.push(parts.join('-'));
  }
  return codes;
}

export function normalizeRecoveryCode(code: string): string {
  return code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function hashRecoveryCode(code: string, config: Config): string {
  const normalized = normalizeRecoveryCode(code);
  return sessionHash(normalized, config.SESSION_SECRET);
}

export function createChallengeToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashChallengeToken(token: string, config: Config): string {
  return sessionHash(token, config.SESSION_SECRET);
}

/** Deterministic fingerprint for audit-safe logs without revealing secrets. */
export function secretFingerprint(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}

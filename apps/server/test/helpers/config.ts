import type { Config } from '../../src/config.js';

/** Cloudflare official always-pass test keys — never call production Siteverify from unit tests. */
export const TURNSTILE_TEST_SITE_KEY = '1x00000000000000000000AA';
export const TURNSTILE_TEST_SECRET_KEY = '1x0000000000000000000000000000000AA';

export const testConfig = {
  NODE_ENV: 'test',
  APP_HOST: '127.0.0.1',
  APP_PORT: 8090,
  APP_ORIGIN: 'https://ddns.example.com',
  APP_ALLOWED_ORIGINS: ['https://ddns.example.com', 'http://192.0.2.10:8090'],
  DATABASE_URL: 'mysql://user:password@127.0.0.1:3307/ddns',
  SESSION_SECRET: 'a-session-secret-that-is-longer-than-32-characters',
  ENCRYPTION_KEY: Buffer.alloc(32),
  COOKIE_NAME: 'cloudflare_ddns_session',
  COOKIE_SECURE: true,
  SESSION_TTL_SECONDS: 3600,
  CLOUDFLARE_API_BASE: 'https://api.cloudflare.com/client/v4',
  IPV4_PROVIDERS: ['https://api4.ipify.org'],
  IPV6_PROVIDERS: ['https://api6.ipify.org'],
  HTTP_TIMEOUT_MS: 5000,
  TURNSTILE_SITE_KEY: TURNSTILE_TEST_SITE_KEY,
  TURNSTILE_SECRET_KEY: TURNSTILE_TEST_SECRET_KEY,
  TURNSTILE_EXPECTED_HOSTNAME: 'ddns.example.com',
  TURNSTILE_EXPECTED_ACTION: 'login',
  TURNSTILE_VERIFY_TIMEOUT_MS: 5000
} satisfies Config;

export function mockSiteverify(
  payload: {
    success?: boolean;
    hostname?: string;
    action?: string;
    'error-codes'?: string[];
  },
  options: { ok?: boolean; delayMs?: number; throwNetwork?: boolean; malformed?: boolean } = {}
): typeof fetch {
  const handler: typeof fetch = async () => {
    if (options.throwNetwork) throw new Error('network unavailable');
    if (options.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, options.delayMs));
    }
    if (options.malformed) {
      return {
        ok: true,
        json: () => Promise.reject(new Error('invalid json'))
      } as Response;
    }
    return {
      ok: options.ok ?? true,
      json: () => Promise.resolve(payload)
    } as Response;
  };
  return handler;
}

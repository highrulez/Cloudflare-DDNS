import { z } from 'zod';

const originSchema = z
  .string()
  .url()
  .superRefine((value, context) => {
    const parsed = new URL(value);
    if (
      parsed.username ||
      parsed.password ||
      parsed.pathname !== '/' ||
      parsed.search ||
      parsed.hash
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Origin must contain only scheme, host, and optional port'
      });
    }
  })
  .transform((value) => new URL(value).origin);

const allowedOriginsSchema = z
  .string()
  .default('')
  .transform((value, context) => {
    const items = value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    const origins: string[] = [];
    for (const item of items) {
      const parsed = originSchema.safeParse(item);
      if (!parsed.success) {
        context.addIssue({
          code: 'custom',
          message: `Invalid APP_ALLOWED_ORIGINS entry: ${item}`
        });
        return z.NEVER;
      }
      origins.push(parsed.data);
    }
    return [...new Set(origins)];
  });

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    APP_HOST: z.string().default('0.0.0.0'),
    APP_PORT: z.coerce.number().int().min(1).max(65535).default(8090),
    DATABASE_URL: z.string().url(),
    SESSION_SECRET: z.string().min(32),
    ENCRYPTION_KEY: z.string().transform((value, context) => {
      const key = Buffer.from(value, 'base64');
      if (key.length !== 32) {
        context.addIssue({
          code: 'custom',
          message: 'ENCRYPTION_KEY must be 32 bytes encoded as base64'
        });
        return z.NEVER;
      }
      return key;
    }),
    APP_ORIGIN: originSchema.optional(),
    APP_ALLOWED_ORIGINS: allowedOriginsSchema,
    COOKIE_NAME: z.string().min(1).default('cloudflare_ddns_session'),
    COOKIE_SECURE: z.stringbool().default(false),
    SESSION_TTL_SECONDS: z.coerce.number().int().min(300).max(2_592_000).default(43_200),
    CLOUDFLARE_API_BASE: z.string().url().default('https://api.cloudflare.com/client/v4'),
    IPV4_PROVIDERS: z
      .string()
      .default('https://api4.ipify.org,https://checkip.amazonaws.com,https://ipv4.icanhazip.com')
      .transform((value) =>
        value
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean)
      ),
    IPV6_PROVIDERS: z
      .string()
      .default('https://api6.ipify.org,https://ipv6.icanhazip.com,https://v6.ident.me')
      .transform((value) =>
        value
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean)
      ),
    HTTP_TIMEOUT_MS: z.coerce.number().int().min(500).max(60_000).default(10_000)
  })
  .superRefine((value, context) => {
    if (value.NODE_ENV === 'production' && !value.APP_ORIGIN) {
      context.addIssue({
        code: 'custom',
        path: ['APP_ORIGIN'],
        message: 'APP_ORIGIN is required in production'
      });
    }
    if (
      value.COOKIE_SECURE &&
      value.APP_ORIGIN &&
      new URL(value.APP_ORIGIN).protocol !== 'https:'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['APP_ORIGIN'],
        message: 'APP_ORIGIN must use HTTPS when COOKIE_SECURE is enabled'
      });
    }
    if (
      value.NODE_ENV === 'production' &&
      value.APP_ORIGIN?.startsWith('https://') &&
      !value.COOKIE_SECURE
    ) {
      context.addIssue({
        code: 'custom',
        path: ['COOKIE_SECURE'],
        message: 'COOKIE_SECURE must be enabled for a production HTTPS origin'
      });
    }
  });

export type Config = z.infer<typeof schema>;

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): Config {
  return schema.parse(environment);
}

/** Exact browser origins permitted for mutating requests. */
export function resolveAllowedOrigins(config: Config): Set<string> {
  const origins = new Set(config.APP_ALLOWED_ORIGINS);
  if (config.APP_ORIGIN) origins.add(config.APP_ORIGIN);
  return origins;
}

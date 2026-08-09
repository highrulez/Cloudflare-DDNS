import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_HOST: z.string().default("0.0.0.0"),
  APP_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().url(),
  SESSION_SECRET: z.string().min(32),
  ENCRYPTION_KEY: z.string().transform((value, context) => {
    const key = Buffer.from(value, "base64");
    if (key.length !== 32) {
      context.addIssue({ code: "custom", message: "ENCRYPTION_KEY must be 32 bytes encoded as base64" });
      return z.NEVER;
    }
    return key;
  }),
  APP_ORIGIN: z.string().url().optional(),
  COOKIE_NAME: z.string().min(1).default("cloudflare_ddns_session"),
  COOKIE_SECURE: z.stringbool().default(false),
  SESSION_TTL_SECONDS: z.coerce.number().int().min(300).max(2_592_000).default(43_200),
  CLOUDFLARE_API_BASE: z.string().url().default("https://api.cloudflare.com/client/v4"),
  IPV4_PROVIDERS: z
    .string()
    .default("https://api.ipify.org,https://checkip.amazonaws.com,https://icanhazip.com")
    .transform((value) => value.split(",").map((item) => item.trim()).filter(Boolean)),
  IPV6_PROVIDERS: z
    .string()
    .default("https://api6.ipify.org,https://icanhazip.com")
    .transform((value) => value.split(",").map((item) => item.trim()).filter(Boolean)),
  HTTP_TIMEOUT_MS: z.coerce.number().int().min(500).max(60_000).default(10_000),
});

export type Config = z.infer<typeof schema>;
export function loadConfig(environment: NodeJS.ProcessEnv = process.env): Config {
  return schema.parse(environment);
}

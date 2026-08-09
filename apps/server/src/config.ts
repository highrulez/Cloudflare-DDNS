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
  PUBLIC_ORIGIN: z.string().url().optional(),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(168),
});

export type Config = z.infer<typeof schema>;
export function loadConfig(environment: NodeJS.ProcessEnv = process.env): Config {
  return schema.parse(environment);
}

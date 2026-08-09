import { z } from "zod";

export const recordTypeSchema = z.enum(["A", "AAAA"]);
export const runTriggerSchema = z.enum(["SCHEDULED", "MANUAL_CHECK", "MANUAL_UPDATE", "FORCE", "SETUP"]);

export const loginSchema = z.object({
  username: z.string().trim().min(1).max(191),
  password: z.string().min(8).max(256),
});

export const adminSetupSchema = loginSchema.extend({
  password: z.string().min(12).max(256),
});

export const cloudflareAccountSchema = z.object({
  name: z.string().trim().min(1).max(191),
  token: z.string().trim().min(20).max(2048),
});

export const settingsSchema = z.object({
  intervalMinutes: z.number().int().min(1).max(1440),
  ipv4Enabled: z.boolean(),
  ipv6Enabled: z.boolean(),
  automaticUpdates: z.boolean(),
  providerPolicy: z.enum(["ordered"]),
  requestTimeoutMs: z.number().int().min(1000).max(30000),
  retentionDays: z.number().int().min(1).max(3650),
  timezone: z.string().min(1).max(64).default("Asia/Kuala_Lumpur"),
}).refine((value) => value.ipv4Enabled || value.ipv6Enabled, {
  message: "At least one IP family must be enabled",
});

export const recordInputSchema = z.object({
  accountId: z.string().min(1),
  zoneId: z.string().min(1),
  cloudflareRecordId: z.string().max(64).nullable().optional(),
  type: recordTypeSchema,
  hostname: z.string().trim().min(1).max(253),
  content: z.string().max(45).nullable().optional(),
  proxied: z.boolean().default(false),
  ttl: z.number().int().min(1).max(86400).default(1),
  enabled: z.boolean().default(true),
  automatic: z.boolean().default(true),
});

export const recordPatchSchema = recordInputSchema.omit({ accountId: true, zoneId: true }).partial();

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const historyQuerySchema = paginationSchema.extend({
  status: z.enum(["RUNNING", "SUCCESS", "PARTIAL", "FAILED", "SKIPPED"]).optional(),
  trigger: runTriggerSchema.optional(),
  recordId: z.string().optional(),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type SettingsInput = z.infer<typeof settingsSchema>;
export type RecordInput = z.infer<typeof recordInputSchema>;

export interface ApiError {
  error: { code: string; message: string; details?: unknown };
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

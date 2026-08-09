import { describe, expect, it } from "vitest";
import { recordInputSchema, settingsSchema } from "../src/index.js";

describe("shared API contracts", () => {
  it("normalizes safe record defaults", () => {
    const value = recordInputSchema.parse({
      accountId: "account",
      zoneId: "zone",
      type: "A",
      hostname: "Home.Example.com",
    });
    expect(value).toMatchObject({ ttl: 1, proxied: false, enabled: true, automatic: true });
  });

  it("requires at least one address family", () => {
    const result = settingsSchema.safeParse({
      intervalMinutes: 5,
      ipv4Enabled: false,
      ipv6Enabled: false,
      automaticUpdates: true,
      providerPolicy: "ordered",
      requestTimeoutMs: 5000,
      retentionDays: 90,
      timezone: "Asia/Kuala_Lumpur",
    });
    expect(result.success).toBe(false);
  });
});

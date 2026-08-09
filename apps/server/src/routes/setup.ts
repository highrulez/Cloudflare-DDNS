import argon2 from "argon2";
import type { PrismaClient } from "@ddns/database";
import { adminSetupSchema, cloudflareAccountSchema, recordInputSchema, settingsSchema } from "@ddns/shared";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { Config } from "../config.js";
import { CloudflareClient } from "../cloudflare/client.js";
import { parsePublicAddress } from "../ip/detection.js";
import { encryptSecret } from "../security/crypto.js";

async function ensureSetupOpen(db: PrismaClient, reply: FastifyReply) {
  const state = await db.setupState.findUnique({ where: { id: 1 } });
  if (state?.completedAt) {
    await reply.code(409).send({ error: { code: "SETUP_COMPLETE", message: "Initial setup is already complete" } });
    return false;
  }
  return true;
}

export function registerSetupRoutes(app: FastifyInstance, db: PrismaClient, config: Config) {
  app.get("/api/setup/status", async () => {
    const [state, users] = await Promise.all([
      db.setupState.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} }),
      db.user.count(),
    ]);
    return { completed: Boolean(state.completedAt), step: state.step, hasAdmin: users > 0 };
  });

  app.post("/api/setup/admin", async (request, reply) => {
    if (!(await ensureSetupOpen(db, reply))) return;
    const input = adminSetupSchema.parse(request.body);
    const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
    try {
      const user = await db.$transaction(async (transaction) => {
        if ((await transaction.user.count()) > 0) throw new Error("ADMIN_EXISTS");
        const created = await transaction.user.create({ data: { username: input.username, passwordHash } });
        await transaction.setupState.upsert({ where: { id: 1 }, create: { id: 1, step: 2 }, update: { step: 2 } });
        return created;
      }, { isolationLevel: "Serializable" });
      return reply.code(201).send({ id: user.id, username: user.username, step: 2 });
    } catch (error) {
      if (error instanceof Error && error.message === "ADMIN_EXISTS") {
        return reply.code(409).send({ error: { code: "ADMIN_EXISTS", message: "An administrator already exists" } });
      }
      throw error;
    }
  });

  app.post("/api/setup/cloudflare/test", async (request, reply) => {
    if (!(await ensureSetupOpen(db, reply))) return;
    const input = cloudflareAccountSchema.parse(request.body);
    const client = new CloudflareClient(input.token, fetch, config.HTTP_TIMEOUT_MS, 4, config.CLOUDFLARE_API_BASE);
    const [verification, zones] = await Promise.all([client.verifyToken(), client.listZones()]);
    return { valid: verification.status === "active", zones };
  });

  app.post("/api/setup/cloudflare", async (request, reply) => {
    if (!(await ensureSetupOpen(db, reply))) return;
    const input = cloudflareAccountSchema.parse(request.body);
    const client = new CloudflareClient(input.token, fetch, config.HTTP_TIMEOUT_MS, 4, config.CLOUDFLARE_API_BASE);
    await client.verifyToken();
    const zones = await client.listZones();
    const encrypted = encryptSecret(input.token, config.ENCRYPTION_KEY);
    const account = await db.cloudflareAccount.create({
      data: {
        name: input.name,
        tokenCiphertext: new Uint8Array(encrypted.ciphertext),
        tokenIv: new Uint8Array(encrypted.iv),
        tokenAuthTag: new Uint8Array(encrypted.authTag),
        tokenKeyVersion: encrypted.keyVersion,
        tokenHint: encrypted.hint,
        verifiedAt: new Date(),
        zones: { create: zones.map((zone) => ({ cloudflareId: zone.id, name: zone.name, status: zone.status })) },
      },
      include: { zones: true },
    });
    await db.setupState.upsert({ where: { id: 1 }, create: { id: 1, step: 3 }, update: { step: 3 } });
    return reply.code(201).send({ ...account, tokenCiphertext: undefined, tokenIv: undefined, tokenAuthTag: undefined });
  });

  app.post("/api/setup/record", async (request, reply) => {
    if (!(await ensureSetupOpen(db, reply))) return;
    const input = recordInputSchema.parse(request.body);
    const account = await db.cloudflareAccount.findUnique({ where: { id: input.accountId } });
    const zone = await db.cloudflareZone.findUnique({ where: { id: input.zoneId } });
    if (!account || !zone || zone.accountId !== account.id) {
      return reply.code(400).send({ error: { code: "BAD_ZONE", message: "Zone does not belong to the selected account" } });
    }
    const token = (await import("../security/crypto.js")).decryptSecret({
      ciphertext: Buffer.from(account.tokenCiphertext),
      iv: Buffer.from(account.tokenIv),
      authTag: Buffer.from(account.tokenAuthTag),
      keyVersion: account.tokenKeyVersion,
    }, config.ENCRYPTION_KEY);
    const client = new CloudflareClient(token, fetch, config.HTTP_TIMEOUT_MS, 4, config.CLOUDFLARE_API_BASE);
    let cloudflareRecordId = input.cloudflareRecordId ?? null;
    if (!cloudflareRecordId) {
      if (!input.content) return reply.code(400).send({ error: { code: "CONTENT_REQUIRED", message: "An initial IP is required" } });
      const content = parsePublicAddress(input.content, input.type === "A" ? "IPV4" : "IPV6");
      const created = await client.createRecord(zone.cloudflareId, {
        type: input.type,
        name: input.hostname.toLowerCase(),
        content,
        proxied: input.proxied,
        ttl: input.ttl,
      });
      cloudflareRecordId = created.data.id;
    }
    const record = await db.managedDnsRecord.create({
      data: {
        accountId: input.accountId,
        zoneId: input.zoneId,
        cloudflareRecordId,
        type: input.type,
        hostname: input.hostname.toLowerCase(),
        normalizedHostname: input.hostname.toLowerCase(),
        content: input.content ?? null,
        proxied: input.proxied,
        ttl: input.ttl,
        enabled: input.enabled,
        automatic: input.automatic,
      },
    });
    await db.setupState.update({ where: { id: 1 }, data: { step: 4 } });
    return reply.code(201).send(record);
  });

  app.put("/api/setup/settings", async (request, reply) => {
    if (!(await ensureSetupOpen(db, reply))) return;
    const input = settingsSchema.parse(request.body);
    const settings = await db.appSettings.upsert({ where: { id: 1 }, create: { id: 1, ...input }, update: input });
    return settings;
  });

  app.post("/api/setup/complete", async (_request, reply) => {
    if (!(await ensureSetupOpen(db, reply))) return;
    const [users, accounts, records] = await Promise.all([db.user.count(), db.cloudflareAccount.count(), db.managedDnsRecord.count()]);
    if (!users || !accounts || !records) {
      return reply.code(400).send({ error: { code: "SETUP_INCOMPLETE", message: "Administrator, Cloudflare account, and record are required" } });
    }
    const state = await db.setupState.update({ where: { id: 1 }, data: { step: 4, completedAt: new Date() } });
    return { completed: true, completedAt: state.completedAt };
  });
}

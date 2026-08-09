import type { PrismaClient } from "@ddns/database";
import { cloudflareAccountSchema } from "@ddns/shared";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { Config } from "../config.js";
import { CloudflareClient } from "../cloudflare/client.js";
import { decryptSecret, encryptSecret } from "../security/crypto.js";
import { requireAuth } from "../security/sessions.js";

function publicAccount(account: {
  id: string; name: string; tokenHint: string; verifiedAt: Date | null; lastError: string | null;
  createdAt: Date; updatedAt: Date; zones?: unknown;
}) {
  return account;
}

async function clientFor(db: PrismaClient, config: Config, id: string, reply: FastifyReply) {
  const account = await db.cloudflareAccount.findUnique({ where: { id } });
  if (!account) {
    await reply.code(404).send({ error: { code: "NOT_FOUND", message: "Cloudflare account not found" } });
    return null;
  }
  const token = decryptSecret({
    ciphertext: Buffer.from(account.tokenCiphertext),
    iv: Buffer.from(account.tokenIv),
    authTag: Buffer.from(account.tokenAuthTag),
    keyVersion: account.tokenKeyVersion,
  }, config.ENCRYPTION_KEY);
  return {
    account,
    client: new CloudflareClient(token, fetch, config.HTTP_TIMEOUT_MS, 4, config.CLOUDFLARE_API_BASE),
  };
}

export function registerCloudflareRoutes(app: FastifyInstance, db: PrismaClient, config: Config) {
  app.get("/api/cloudflare/accounts", { preHandler: requireAuth }, async () => {
    const accounts = await db.cloudflareAccount.findMany({
      select: {
        id: true, name: true, tokenHint: true, verifiedAt: true, lastError: true, createdAt: true, updatedAt: true,
        zones: { select: { id: true, cloudflareId: true, name: true, status: true } },
        _count: { select: { records: true } },
      },
      orderBy: { name: "asc" },
    });
    return { items: accounts };
  });

  app.post("/api/cloudflare/accounts", { preHandler: requireAuth }, async (request, reply) => {
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
      select: { id: true, name: true, tokenHint: true, verifiedAt: true, lastError: true, createdAt: true, updatedAt: true, zones: true },
    });
    return reply.code(201).send(publicAccount(account));
  });

  app.post("/api/cloudflare/accounts/test", { preHandler: requireAuth }, async (request) => {
    const input = cloudflareAccountSchema.parse(request.body);
    const client = new CloudflareClient(input.token, fetch, config.HTTP_TIMEOUT_MS, 4, config.CLOUDFLARE_API_BASE);
    const [verification, zones] = await Promise.all([client.verifyToken(), client.listZones()]);
    return { valid: verification.status === "active", zones };
  });

  app.post("/api/cloudflare/accounts/:id/test", { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const context = await clientFor(db, config, id, reply);
    if (!context) return;
    const verification = await context.client.verifyToken();
    await db.cloudflareAccount.update({ where: { id }, data: { verifiedAt: new Date(), lastError: null } });
    return { valid: verification.status === "active" };
  });

  app.put("/api/cloudflare/accounts/:id/token", { preHandler: requireAuth }, async (request) => {
    const { id } = request.params as { id: string };
    const token = (request.body as { token?: unknown })?.token;
    const input = cloudflareAccountSchema.pick({ token: true }).parse({ token });
    const client = new CloudflareClient(input.token, fetch, config.HTTP_TIMEOUT_MS, 4, config.CLOUDFLARE_API_BASE);
    await client.verifyToken();
    const encrypted = encryptSecret(input.token, config.ENCRYPTION_KEY);
    const account = await db.cloudflareAccount.update({
      where: { id },
      data: {
        tokenCiphertext: new Uint8Array(encrypted.ciphertext),
        tokenIv: new Uint8Array(encrypted.iv),
        tokenAuthTag: new Uint8Array(encrypted.authTag),
        tokenKeyVersion: encrypted.keyVersion, tokenHint: encrypted.hint, verifiedAt: new Date(), lastError: null,
      },
      select: { id: true, name: true, tokenHint: true, verifiedAt: true, lastError: true, createdAt: true, updatedAt: true },
    });
    return account;
  });

  app.patch("/api/cloudflare/accounts/:id", { preHandler: requireAuth }, async (request) => {
    const { id } = request.params as { id: string };
    const input = cloudflareAccountSchema.partial().parse(request.body);
    let tokenData = {};
    if (input.token) {
      const client = new CloudflareClient(input.token, fetch, config.HTTP_TIMEOUT_MS, 4, config.CLOUDFLARE_API_BASE);
      await client.verifyToken();
      const encrypted = encryptSecret(input.token, config.ENCRYPTION_KEY);
      tokenData = {
        tokenCiphertext: new Uint8Array(encrypted.ciphertext),
        tokenIv: new Uint8Array(encrypted.iv),
        tokenAuthTag: new Uint8Array(encrypted.authTag),
        tokenKeyVersion: encrypted.keyVersion,
        tokenHint: encrypted.hint,
        verifiedAt: new Date(),
        lastError: null,
      };
    }
    return db.cloudflareAccount.update({
      where: { id },
      data: {
        ...(input.name ? { name: input.name } : {}),
        ...tokenData,
      },
      select: {
        id: true,
        name: true,
        tokenHint: true,
        verifiedAt: true,
        lastError: true,
        createdAt: true,
        updatedAt: true,
        zones: true,
        _count: { select: { records: true } },
      },
    });
  });

  app.post("/api/cloudflare/accounts/:id/zones/refresh", { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const context = await clientFor(db, config, id, reply);
    if (!context) return;
    const zones = await context.client.listZones();
    for (const zone of zones) {
      await db.cloudflareZone.upsert({
        where: { accountId_cloudflareId: { accountId: id, cloudflareId: zone.id } },
        create: { accountId: id, cloudflareId: zone.id, name: zone.name, status: zone.status },
        update: { name: zone.name, status: zone.status },
      });
    }
    return { items: await db.cloudflareZone.findMany({ where: { accountId: id }, orderBy: { name: "asc" } }) };
  });

  app.get("/api/cloudflare/accounts/:id/zones/:zoneId/records", { preHandler: requireAuth }, async (request, reply) => {
    const { id, zoneId } = request.params as { id: string; zoneId: string };
    const [context, zone] = await Promise.all([
      clientFor(db, config, id, reply),
      db.cloudflareZone.findFirst({ where: { id: zoneId, accountId: id } }),
    ]);
    if (!context || !zone) return reply.code(404).send({ error: { code: "NOT_FOUND", message: "Zone not found" } });
    return { items: await context.client.listRecords(zone.cloudflareId) };
  });

  app.delete("/api/cloudflare/accounts/:id", { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (await db.managedDnsRecord.count({ where: { accountId: id } })) {
      return reply.code(409).send({ error: { code: "ACCOUNT_IN_USE", message: "Remove managed records before deleting this account" } });
    }
    await db.cloudflareAccount.delete({ where: { id } });
    return reply.code(204).send();
  });
}

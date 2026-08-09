import type { Prisma, PrismaClient } from "@ddns/database";
import { paginationSchema, recordInputSchema, recordPatchSchema } from "@ddns/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Config } from "../config.js";
import { CloudflareClient } from "../cloudflare/client.js";
import type { DdnsEngine } from "../ddns/engine.js";
import type { Scheduler } from "../ddns/scheduler.js";
import { parsePublicAddress } from "../ip/detection.js";
import { decryptSecret } from "../security/crypto.js";
import { requireAuth } from "../security/sessions.js";

async function cloudflareContext(db: PrismaClient, config: Config, accountId: string, zoneId: string, reply: FastifyReply) {
  const [account, zone] = await Promise.all([
    db.cloudflareAccount.findUnique({ where: { id: accountId } }),
    db.cloudflareZone.findFirst({ where: { id: zoneId, accountId } }),
  ]);
  if (!account || !zone) {
    await reply.code(400).send({ error: { code: "BAD_ZONE", message: "Invalid account or zone" } });
    return null;
  }
  const token = decryptSecret({
    ciphertext: Buffer.from(account.tokenCiphertext), iv: Buffer.from(account.tokenIv),
    authTag: Buffer.from(account.tokenAuthTag), keyVersion: account.tokenKeyVersion,
  }, config.ENCRYPTION_KEY);
  return { zone, client: new CloudflareClient(token) };
}

export function registerRecordRoutes(
  app: FastifyInstance,
  db: PrismaClient,
  config: Config,
  engine: DdnsEngine,
  scheduler: Scheduler,
) {
  app.get("/api/records", { preHandler: requireAuth }, async (request) => {
    const query = request.query as Record<string, unknown>;
    const { page, pageSize } = paginationSchema.parse(query);
    const where: Prisma.ManagedDnsRecordWhereInput = {
      ...(query.type === "A" || query.type === "AAAA" ? { type: query.type } : {}),
      ...(query.enabled === "true" ? { enabled: true } : query.enabled === "false" ? { enabled: false } : {}),
      ...(typeof query.search === "string" && query.search ? { hostname: { contains: query.search } } : {}),
    };
    const [items, total] = await Promise.all([
      db.managedDnsRecord.findMany({
        where, include: { account: { select: { id: true, name: true } }, zone: true },
        orderBy: [{ hostname: "asc" }, { type: "asc" }], skip: (page - 1) * pageSize, take: pageSize,
      }),
      db.managedDnsRecord.count({ where }),
    ]);
    return { items, page, pageSize, total, totalPages: Math.ceil(total / pageSize) };
  });

  app.post("/api/records", { preHandler: requireAuth }, async (request, reply) => {
    const input = recordInputSchema.parse(request.body);
    const context = await cloudflareContext(db, config, input.accountId, input.zoneId, reply);
    if (!context) return;
    const hostname = input.hostname.toLowerCase().replace(/\.$/, "");
    if (hostname !== context.zone.name && !hostname.endsWith(`.${context.zone.name}`)) {
      return reply.code(400).send({ error: { code: "HOST_OUTSIDE_ZONE", message: "Hostname is outside the selected zone" } });
    }
    let remote;
    if (input.cloudflareRecordId) {
      remote = await context.client.getRecord(context.zone.cloudflareId, input.cloudflareRecordId);
      if (remote.type !== input.type) return reply.code(400).send({ error: { code: "TYPE_MISMATCH", message: "Record type does not match" } });
    } else {
      if (!input.content) return reply.code(400).send({ error: { code: "CONTENT_REQUIRED", message: "Initial public IP is required" } });
      const content = parsePublicAddress(input.content, input.type === "A" ? "IPV4" : "IPV6");
      remote = (await context.client.createRecord(context.zone.cloudflareId, {
        type: input.type, name: hostname, content, proxied: input.proxied, ttl: input.ttl,
      })).data;
    }
    const record = await db.managedDnsRecord.create({
      data: {
        accountId: input.accountId, zoneId: input.zoneId, cloudflareRecordId: remote.id,
        type: input.type, hostname, normalizedHostname: hostname, content: remote.content,
        proxied: remote.proxied, ttl: remote.ttl, enabled: input.enabled, automatic: input.automatic,
      },
    });
    return reply.code(201).send(record);
  });

  app.patch("/api/records/:id", { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const input = recordPatchSchema.parse(request.body);
    const current = await db.managedDnsRecord.findUnique({ where: { id } });
    if (!current) return reply.code(404).send({ error: { code: "NOT_FOUND", message: "Record not found" } });
    const hostname = input.hostname?.toLowerCase().replace(/\.$/, "");
    return db.managedDnsRecord.update({
      where: { id },
      data: {
        ...(hostname ? { hostname, normalizedHostname: hostname } : {}),
        ...(input.enabled !== undefined ? { enabled: input.enabled, health: input.enabled ? "UNKNOWN" : "DISABLED" } : {}),
        ...(input.automatic !== undefined ? { automatic: input.automatic } : {}),
        ...(input.proxied !== undefined ? { proxied: input.proxied } : {}),
        ...(input.ttl !== undefined ? { ttl: input.ttl } : {}),
      },
    });
  });

  const runRecord = (trigger: "MANUAL_CHECK" | "MANUAL_UPDATE") =>
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      if (!(await db.managedDnsRecord.findUnique({ where: { id } }))) {
        return reply.code(404).send({ error: { code: "NOT_FOUND", message: "Record not found" } });
      }
      const result = await scheduler.runExclusive(() => engine.run({ trigger, recordId: id }));
      if (!result) return reply.code(409).send({ error: { code: "RUN_IN_PROGRESS", message: "Another DDNS run is active" } });
      return result;
    };
  app.post("/api/records/:id/check", { preHandler: requireAuth }, runRecord("MANUAL_CHECK"));
  app.post("/api/records/:id/update", { preHandler: requireAuth }, runRecord("MANUAL_UPDATE"));

  app.delete("/api/records/:id", { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await db.managedDnsRecord.delete({ where: { id } });
    return reply.code(204).send();
  });
}

import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@ddns/database";
import type { DdnsEngine } from "./engine.js";

export class Scheduler {
  readonly ownerId = `${process.pid}-${randomUUID()}`;
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(private readonly db: PrismaClient, private readonly engine: DdnsEngine) {}

  private async acquire(name = "ddns", leaseMs = 120_000) {
    const now = new Date();
    const leaseExpiresAt = new Date(now.getTime() + leaseMs);
    const updated = await this.db.schedulerLease.updateMany({
      where: { name, OR: [{ ownerId: this.ownerId }, { leaseExpiresAt: { lt: now } }] },
      data: { ownerId: this.ownerId, leaseExpiresAt, heartbeatAt: now },
    });
    if (updated.count > 0) return true;
    try {
      await this.db.schedulerLease.create({ data: { name, ownerId: this.ownerId, leaseExpiresAt, heartbeatAt: now } });
      return true;
    } catch {
      return false;
    }
  }

  private async release(name = "ddns") {
    await this.db.schedulerLease.deleteMany({ where: { name, ownerId: this.ownerId } });
  }

  async runExclusive<T>(task: () => Promise<T>): Promise<T | null> {
    if (!(await this.acquire())) return null;
    try {
      return await task();
    } finally {
      await this.release();
    }
  }

  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const settings = await this.db.appSettings.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
      const state = await this.db.schedulerState.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
      if (!settings.automaticUpdates || (state.nextCheckAt && state.nextCheckAt > new Date())) return;
      const nextCheckAt = new Date(Date.now() + settings.intervalMinutes * 60_000);
      const result = await this.runExclusive(() => this.engine.run({ trigger: "SCHEDULED" }));
      await this.db.schedulerState.update({
        where: { id: 1 },
        data: {
          ownerId: this.ownerId,
          running: false,
          lastCheckAt: new Date(),
          nextCheckAt,
          lastRunId: result?.id ?? null,
          lastError: result ? null : "Another process owns the scheduler lease",
        },
      });
    } catch (error) {
      await this.db.schedulerState.upsert({
        where: { id: 1 },
        create: { id: 1, lastError: error instanceof Error ? error.message : "Scheduler failed" },
        update: { running: false, lastError: error instanceof Error ? error.message : "Scheduler failed" },
      });
    } finally {
      this.running = false;
    }
  }

  async start() {
    const staleBefore = new Date(Date.now() - 15 * 60_000);
    await this.db.ddnsRun.updateMany({
      where: { status: "RUNNING", startedAt: { lt: staleBefore } },
      data: { status: "FAILED", finishedAt: new Date(), summary: "Recovered stale run after restart" },
    });
    await this.tick();
    this.timer = setInterval(() => void this.tick(), 15_000);
    this.timer.unref();
    const cleanup = async () => {
      const settings = await this.db.appSettings.findUnique({ where: { id: 1 } });
      const before = new Date(Date.now() - (settings?.retentionDays ?? 90) * 86_400_000);
      const oldRuns = await this.db.ddnsRun.findMany({ where: { startedAt: { lt: before } }, select: { id: true }, take: 500 });
      if (oldRuns.length) await this.db.ddnsRun.deleteMany({ where: { id: { in: oldRuns.map(({ id }) => id) } } });
    };
    const cleanupTimer = setInterval(() => void cleanup(), 86_400_000);
    cleanupTimer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }
}

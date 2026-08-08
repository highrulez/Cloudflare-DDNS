import { z } from 'zod';

export const QUEUES = {
  dns: 'infra-hub:dns:v1',
  system: 'infra-hub:system:v1'
} as const;

export const JOBS = {
  connectProvider: 'connect-provider',
  syncProvider: 'sync-provider',
  testProvider: 'test-provider',
  replaceCredential: 'replace-credential',
  observePublicIp: 'observe-public-ip'
} as const;

export const connectionJobSchema = z
  .object({
    connectionId: z.string().cuid(),
    userId: z.string().cuid(),
    syncRunId: z.string().cuid(),
    credentialId: z.string().cuid().optional()
  })
  .strict();
export type ConnectionJob = z.infer<typeof connectionJobSchema>;

export const observePublicIpJobSchema = z
  .object({
    source: z.enum(['schedule', 'manual']).default('schedule')
  })
  .strict();
export type ObservePublicIpJob = z.infer<typeof observePublicIpJobSchema>;

export const defaultJobOptions = {
  attempts: 4,
  backoff: { type: 'exponential', delay: 2_000 },
  removeOnComplete: { age: 86_400, count: 500 },
  removeOnFail: { age: 604_800, count: 1_000 }
} as const;

export function connectionJobId(name: string, connectionId: string): string {
  return `${name}:${connectionId}`;
}

export function connectionRunJobId(name: string, connectionId: string, syncRunId: string): string {
  return `${name}:${connectionId}:${syncRunId}`;
}

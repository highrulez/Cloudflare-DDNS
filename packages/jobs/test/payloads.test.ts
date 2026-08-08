import { describe, expect, it } from 'vitest';
import { connectionJobSchema, connectionRunJobId } from '../src/index.js';

describe('connection job payloads', () => {
  const payload = {
    connectionId: 'cm12345678901234567890123',
    userId: 'cm22345678901234567890123',
    syncRunId: 'cm32345678901234567890123'
  };

  it('contains identifiers only and rejects credential material', () => {
    expect(connectionJobSchema.parse(payload)).toEqual(payload);
    expect(() => connectionJobSchema.parse({ ...payload, apiToken: 'secret' })).toThrow();
  });

  it('creates a deterministic per-run job id', () => {
    expect(connectionRunJobId('sync-provider', payload.connectionId, payload.syncRunId)).toBe(
      `sync-provider:${payload.connectionId}:${payload.syncRunId}`
    );
  });
});

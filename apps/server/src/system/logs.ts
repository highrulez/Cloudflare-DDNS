import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import type { FastifyBaseLogger } from 'fastify';
import pino, { multistream } from 'pino';

export type SystemLogCategory =
  'application' | 'cloudflare' | 'scheduler' | 'authentication' | 'database';

export interface SystemLogEntry {
  id: string;
  time: string;
  level: 'info' | 'warning' | 'error';
  category: SystemLogCategory;
  message: string;
  details?: Record<string, unknown>;
}

const sensitiveKey = /authorization|cookie|password|secret|token|cipher|authTag|database_url/i;

export function sanitizeDiagnosticText(value: string) {
  return value
    .replace(/\b(?:mysql|mariadb):\/\/[^\s"'`]+/gi, '[Redacted database URL]')
    .replace(/\bBearer\s+[^\s"'`]+/gi, 'Bearer [Redacted]')
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[Redacted opaque value]');
}

function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 5) return '[Truncated]';
  if (typeof value === 'string') return sanitizeDiagnosticText(value);
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitize(item, depth + 1));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !sensitiveKey.test(key))
      .map(([key, item]) => [key, sanitize(item, depth + 1)])
  );
}

function categoryFor(value: Record<string, unknown>): SystemLogCategory {
  const text = `${String(value.event ?? '')} ${String(value.msg ?? '')}`.toLowerCase();
  if (text.includes('cloudflare')) return 'cloudflare';
  if (text.includes('scheduler') || text.includes('ddns')) return 'scheduler';
  if (text.includes('auth') || text.includes('login') || text.includes('session'))
    return 'authentication';
  if (text.includes('database') || text.includes('prisma') || text.includes('mariadb'))
    return 'database';
  return 'application';
}

class SystemLogStore {
  private readonly entries: SystemLogEntry[] = [];
  constructor(private readonly limit = 1000) {}

  addLine(line: string) {
    try {
      const value = JSON.parse(line) as Record<string, unknown>;
      const levelNumber = Number(value.level ?? 30);
      const details = sanitize(
        Object.fromEntries(
          Object.entries(value).filter(
            ([key]) => !['level', 'time', 'msg', 'pid', 'hostname'].includes(key)
          )
        )
      ) as Record<string, unknown>;
      this.entries.push({
        id: randomUUID(),
        time: new Date(Number(value.time ?? Date.now())).toISOString(),
        level: levelNumber >= 50 ? 'error' : levelNumber >= 40 ? 'warning' : 'info',
        category: categoryFor(value),
        message: sanitizeDiagnosticText(String(value.msg ?? value.event ?? 'Application event')),
        ...(Object.keys(details).length ? { details } : {})
      });
      if (this.entries.length > this.limit)
        this.entries.splice(0, this.entries.length - this.limit);
    } catch {
      // Ignore non-JSON output from third-party libraries.
    }
  }

  list(filters: { level?: string; category?: string; limit?: number } = {}) {
    const limit = Math.min(Math.max(filters.limit ?? 200, 1), 1000);
    return this.entries
      .filter(
        (entry) =>
          (!filters.level || entry.level === filters.level) &&
          (!filters.category || entry.category === filters.category)
      )
      .slice(-limit)
      .reverse();
  }
}

export const systemLogs = new SystemLogStore();

export function createSystemLogger(level = 'info'): FastifyBaseLogger {
  const capture = new Writable({
    write(chunk, _encoding, callback) {
      systemLogs.addLine(String(chunk));
      callback();
    }
  });
  return pino(
    {
      level,
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'request.headers.authorization',
          'request.headers.cookie',
          '*.password',
          '*.token',
          '*.secret',
          '*.DATABASE_URL'
        ],
        censor: '[Redacted]'
      }
    },
    multistream([{ stream: process.stdout }, { stream: capture }])
  );
}

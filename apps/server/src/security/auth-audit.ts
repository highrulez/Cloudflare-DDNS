import type { AuthAuditEventType, PrismaClient } from '@ddns/database';
import type { FastifyBaseLogger, FastifyRequest } from 'fastify';

function readUserAgent(request: FastifyRequest): string | null {
  const value = request.headers['user-agent'];
  return typeof value === 'string' ? value.slice(0, 512) : null;
}

export async function writeAuthAudit(
  db: PrismaClient,
  logger: FastifyBaseLogger | undefined,
  input: {
    type: AuthAuditEventType;
    success: boolean;
    request: FastifyRequest;
    username?: string | undefined;
  }
) {
  const sourceIp = String(input.request.ip ?? '').slice(0, 64) || null;
  const userAgent = readUserAgent(input.request);
  const username = input.username?.slice(0, 191) ?? null;
  try {
    await db.authAuditEvent.create({
      data: {
        type: input.type,
        success: input.success,
        sourceIp,
        userAgent,
        username
      }
    });
  } catch {
    logger?.error(
      { event: 'auth.audit.write_failed' },
      'Failed to persist authentication audit event'
    );
  }
  logger?.info(
    {
      event: `auth.${input.type.toLowerCase()}`,
      success: input.success,
      sourceIp,
      ...(username ? { username } : {})
    },
    input.type
  );
}

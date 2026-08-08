import PrismaClientPackage from '@prisma/client';
import type { PrismaClient as PrismaClientType } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';

const { PrismaClient } = PrismaClientPackage;
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClientType };
const envFile = [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')].find(
  existsSync
);
if (envFile) loadDotenv({ path: envFile, quiet: true });

function timeoutFromEnv(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  return Number.isInteger(value) && value >= 500 ? value : fallback;
}

function createClient(): PrismaClientType {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const url = new URL(databaseUrl);
  if (url.protocol !== 'mysql:') throw new Error('DATABASE_URL must use the mysql protocol');
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!database) throw new Error('DATABASE_URL must include a database name');
  const adapter = new PrismaMariaDb({
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database,
    connectionLimit: 10,
    connectTimeout: timeoutFromEnv('DATABASE_CONNECT_TIMEOUT_MS', 5_000),
    acquireTimeout: timeoutFromEnv('DATABASE_OPERATION_TIMEOUT_MS', 5_000),
    socketTimeout: timeoutFromEnv('DATABASE_OPERATION_TIMEOUT_MS', 5_000),
    queryTimeout: timeoutFromEnv('DATABASE_OPERATION_TIMEOUT_MS', 5_000)
  });
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error']
  });
}

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export * from '@prisma/client';

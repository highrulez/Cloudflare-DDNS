import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "../generated/prisma/client.js";

export * from "../generated/prisma/client.js";

function databaseOptions(url: string) {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 3306),
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.slice(1),
    connectionLimit: 10,
  };
}

export function createDatabase(url = process.env.DATABASE_URL): PrismaClient {
  if (!url) throw new Error("DATABASE_URL is required");
  return new PrismaClient({ adapter: new PrismaMariaDb(databaseOptions(url)) });
}

declare global {
  // eslint-disable-next-line no-var
  var __ddnsPrisma: PrismaClient | undefined;
}

export const db = globalThis.__ddnsPrisma ?? createDatabase();
if (process.env.NODE_ENV !== "production") globalThis.__ddnsPrisma = db;

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

/**
 * The database is optional: it only backs the platform `/api/health` endpoint.
 * The application itself is fully on-chain, so no connection is created unless
 * DATABASE_URL is present — Vercel deploys run fine without it.
 */
const databaseUrl = process.env.DATABASE_URL;

const globalForDb = globalThis as typeof globalThis & {
  __arenaNextJsPostgresqlPool?: Pool;
};

export const pool = databaseUrl
  ? globalForDb.__arenaNextJsPostgresqlPool ?? new Pool({ connectionString: databaseUrl })
  : null;

if (pool && process.env.NODE_ENV !== "production") {
  globalForDb.__arenaNextJsPostgresqlPool = pool;
}

export const db = pool ? drizzle(pool) : null;

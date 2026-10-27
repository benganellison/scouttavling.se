import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import { DATABASE_URL } from '$app/env/private';

if (!DATABASE_URL) throw new Error('DATABASE_URL is not set');

// One pool per process: Vite re-runs this module on every change (schema.ts, …) in dev, and a new
// pool each time leaked 10 connections until Postgres refused clients. idle_timeout returns
// connections nobody uses. The drizzle wrapper below is rebuilt, so a changed schema still applies.
const g = globalThis as unknown as { __pgClient?: ReturnType<typeof postgres>; __healthClient?: ReturnType<typeof postgres> };
// 20 connections: sync bursts hold a connection each while they wait for their competition's
// change_seq lock. Timeouts: nothing waits on a lock or runs a statement for ever.
const client = (g.__pgClient ??= postgres(DATABASE_URL, {
	max: 20,
	idle_timeout: 60,
	connection: { lock_timeout: 5000, statement_timeout: 30000 }
}));

export const db = drizzle(client, { schema });

/**
 * Own single connection for /healthz: a busy main pool (sync bursts) must not make the health check
 * fail, or Traefik would take the only app instance out of service.
 */
export const healthSql = (g.__healthClient ??= postgres(DATABASE_URL, { max: 1, idle_timeout: 60, connect_timeout: 3, connection: { statement_timeout: 2000 } }));

/** Closes both pools (graceful shutdown; see hooks.server.ts). */
export const closeDb = () => Promise.all([client.end({ timeout: 5 }), healthSql.end({ timeout: 2 })]);
export type DB = typeof db;
export { schema };

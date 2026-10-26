import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import { DATABASE_URL } from '$app/env/private';

if (!DATABASE_URL) throw new Error('DATABASE_URL is not set');

// One pool per process: Vite re-runs this module on every change (schema.ts, …) in dev, and a new
// pool each time leaked 10 connections until Postgres refused clients. idle_timeout returns
// connections nobody uses. The drizzle wrapper below is rebuilt, so a changed schema still applies.
const g = globalThis as unknown as { __pgClient?: ReturnType<typeof postgres> };
const client = (g.__pgClient ??= postgres(DATABASE_URL, { max: 10, idle_timeout: 60 }));

export const db = drizzle(client, { schema });

/** Closes the pool (graceful shutdown; see hooks.server.ts). */
export const closeDb = () => client.end({ timeout: 5 });
export type DB = typeof db;
export { schema };

/** Applies scripts/db-extras.sql (triggers etc. that drizzle-kit does not manage). */
import { readFileSync } from 'node:fs';
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
await sql.unsafe(readFileSync(new URL('./db-extras.sql', import.meta.url), 'utf8'));
console.log('db-extras applied');
await sql.end();

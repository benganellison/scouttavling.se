/**
 * Applies pending SQL migrations from ./drizzle. Safe to run repeatedly.
 * Dev: `npm run db:migrate`. Production: the one-shot `migrate` container runs
 * this before the app starts (never on app start itself).
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');

const client = postgres(url, { max: 1, onnotice: () => {} });
try {
	await migrate(drizzle(client), {
		migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
		migrationsTable: '__drizzle_migrations',
		migrationsSchema: 'public'
	});
	console.log('migrations applied');
} finally {
	await client.end();
}

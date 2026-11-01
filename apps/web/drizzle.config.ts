import { defineConfig } from 'drizzle-kit';

/**
 * Versioned SQL migrations live in ./drizzle and are committed.
 * Change the schema → `npm run db:generate` → review the SQL → commit.
 * Applied by scripts/migrate.ts (dev: db:reset/db:migrate, prod: the migrate container).
 * `generate` needs no database connection, so DATABASE_URL is optional here.
 */
export default defineConfig({
	schema: './src/lib/server/db/schema.ts',
	out: './drizzle',
	dialect: 'postgresql',
	dbCredentials: { url: process.env.DATABASE_URL ?? 'postgres://unused' },
	migrations: { table: '__drizzle_migrations', schema: 'public' },
	verbose: true,
	strict: true
});

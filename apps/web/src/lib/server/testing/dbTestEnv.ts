/**
 * Shared setup for the `*.db.test.ts` integration tests: find the dev/CI database and check that it
 * is reachable and migrated. Without one the tests are skipped, except when REQUIRE_DB=1 (CI), where
 * a missing database fails the run instead of silently skipping it.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

export function databaseUrl(): string | undefined {
	if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
	try {
		const env = readFileSync(fileURLToPath(new URL('../../../../.env', import.meta.url)), 'utf8');
		return /^DATABASE_URL=["']?([^"'\n]+)/m.exec(env)?.[1];
	} catch {
		return undefined;
	}
}

/** True when the database answers and has the schema (migrations run). */
export async function databaseReady(url = databaseUrl()): Promise<boolean> {
	let ok = false;
	if (url) {
		const probe = postgres(url, { max: 1, connect_timeout: 2, onnotice: () => {} });
		try {
			await probe`select 1 from score, audit_log limit 0`;
			ok = true;
		} catch {
			ok = false;
		} finally {
			await probe.end({ timeout: 1 });
		}
	}
	if (!ok && process.env.REQUIRE_DB === '1') throw new Error('REQUIRE_DB=1 but no reachable, migrated database (DATABASE_URL)');
	return ok;
}

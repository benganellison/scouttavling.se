/**
 * Integration test: a real MySQL with gokapp's schema and INVENTED data (e2e/fixtures/gokapp-invented.sql)
 * → writeImport → scouttavling's Postgres. Checks the archived edition, the results, and that none of the
 * "HEMLIG-…" markers in gokapp's personal columns reached ANY table.
 *
 * Skipped unless GOKAPP_TEST_SOURCE points at a MySQL server the test may create databases on:
 *   docker run -d --name gokapp-test -e MYSQL_ROOT_PASSWORD=test -p 127.0.0.1:3317:3306 mysql:8.4.13
 *   GOKAPP_TEST_SOURCE=mysql://root:test@127.0.0.1:3317 npx vitest run apps/web/src/lib/server/gokappImport.db.test.ts
 */
import { afterAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import postgres from 'postgres';
import mysql from 'mysql2/promise';
import { NEVER_READ, readGokapp, writeImport } from './gokappImport.ts';

function databaseUrl(): string | undefined {
	if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
	try {
		const env = readFileSync(fileURLToPath(new URL('../../../.env', import.meta.url)), 'utf8');
		return /^DATABASE_URL=["']?([^"'\n]+)/m.exec(env)?.[1];
	} catch {
		return undefined;
	}
}
const PG = databaseUrl();
const MY = process.env.GOKAPP_TEST_SOURCE;

describe.skipIf(!PG || !MY)('gokapp import (MySQL → Postgres)', () => {
	const tag = randomBytes(4).toString('hex');
	const myDb = `gokapp_test_${tag}`;
	const seriesSlug = `pahittade-hajken-${tag}`;
	const memberNo = `9${Date.now() % 1e9}`;
	const sql = postgres(PG!, { max: 1, onnotice: () => {} });
	let admin: mysql.Connection;

	afterAll(async () => {
		await sql`delete from competition where series_id in (select id from series where slug = ${seriesSlug})`;
		await sql`delete from series where slug = ${seriesSlug}`;
		await sql`delete from app_user where member_no = ${memberNo}`;
		await sql.end();
		if (admin) {
			await admin.query(`DROP DATABASE IF EXISTS ${myDb}`);
			await admin.end();
		}
	});

	it('creates an archived edition with points per station and no personal data', async () => {
		admin = await mysql.createConnection({ uri: MY!, multipleStatements: true });
		await admin.query(`CREATE DATABASE ${myDb} CHARACTER SET utf8mb4`);
		await admin.query(`USE ${myDb}`);
		await admin.query(readFileSync(fileURLToPath(new URL('../../../e2e/fixtures/gokapp-invented.sql', import.meta.url)), 'utf8'));

		await sql`insert into app_user (member_no, name) values (${memberNo}, 'Importör Påhittad')`;
		const source = await mysql.createConnection({ uri: `${MY}/${myDb}`, timezone: 'Z' });
		const data = await readGokapp(source);
		await source.end();
		const r = await writeImport(sql, data, {
			series: seriesSlug, seriesName: 'Påhittade Hajken', year: 2023, ownerMemberNo: memberNo, withTimes: true, operator: 'cli:test'
		});
		expect(r.plan.rankingDiffs).toEqual([]);

		const [comp] = await sql`select * from competition where slug = ${r.slug}`;
		expect(comp).toMatchObject({ status: 'closed', public_results: true, archive_public: true, edition_year: 2023, name: 'Påhittade Hajken 2023' });
		expect(comp.anonymised_at).not.toBeNull();
		expect(comp.start_date).toBe('2023-05-13');
		const patrols = await sql`select number, name, troop, status, paid, contact_name from patrol where competition_id = ${comp.id} order by number`;
		expect(patrols.map((p) => [p.number, p.status])).toEqual([[101, 'finished'], [102, 'finished'], [201, 'finished'], [202, 'active'], [203, 'resigned']]);
		expect(patrols.every((p) => p.paid === false && p.contact_name === null)).toBe(true);
		const items = await sql`select i.mode, s.all_tracks from score_item i join station s on s.id = i.station_id where s.competition_id = ${comp.id} order by s.sort`;
		expect(items.map((i) => i.mode)).toEqual(['RANGE', 'CHECKIN', 'DISTINCT', 'RANGE']);
		const [{ n, timed }] = await sql`select count(*)::int n, count(scored_at)::int timed from score where competition_id = ${comp.id}`;
		expect([n, timed]).toEqual([10, 10]);
		const [audit] = await sql`select action, actor_kind from audit_log where competition_id = ${comp.id}`;
		expect(audit).toEqual({ action: 'competition.import_gokapp', actor_kind: 'cli' });

		// No marker from gokapp's personal columns anywhere in the database.
		const tables = await sql`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'`;
		for (const { table_name } of tables) {
			const [{ hits }] = await sql.unsafe(`select count(*)::int hits from "${table_name}" t where t::text ilike '%hemlig%'`);
			expect(hits, `HEMLIG in ${table_name}`).toBe(0);
		}
		expect(NEVER_READ).toContain('members');
	});

	it('refuses the same year twice and writes nothing', async () => {
		const source = await mysql.createConnection({ uri: `${MY}/${myDb}`, timezone: 'Z' });
		const data = await readGokapp(source);
		await source.end();
		const before = await sql`select count(*)::int n from competition`;
		await expect(
			writeImport(sql, data, { series: seriesSlug, year: 2023, slug: `annan-${tag}`, ownerMemberNo: memberNo, withTimes: true, operator: 'cli:test' })
		).rejects.toThrow(/redan ett år 2023/);
		expect(await sql`select count(*)::int n from competition`).toEqual(before);
	});
});

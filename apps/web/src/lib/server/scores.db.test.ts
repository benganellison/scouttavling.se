/**
 * Integration test against the real dev/CI database: concurrent score writes. Two first reports
 * for the same patrol and item must become one score and one conflict (never a unique-key error),
 * and score writes racing with patrol updates (desk status, HQ edits) must never deadlock.
 * Skipped when no database is reachable. All data is invented and removed afterwards.
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import { databaseReady, databaseUrl } from './testing/dbTestEnv.ts';

const URL_ = databaseUrl();
const ok = await databaseReady(URL_);

vi.mock('$app/env/private', () => ({ DATABASE_URL: URL_, ORIGIN: 'http://localhost' }));
vi.mock('$app/env', () => ({ dev: true }));

describe.skipIf(!ok)('concurrent score writes (database)', async () => {
	const { db, schema } = await import('./db/index.ts');
	const { writeScore, voidScore } = await import('./scores.ts');
	const { recordChange } = await import('./changes.ts');
	const { eq, and } = await import('drizzle-orm');
	const { randomBytes } = await import('node:crypto');
	const slug = `race-test-${randomBytes(4).toString('hex')}`;
	let compId = '';

	afterAll(async () => {
		if (compId) await db.delete(schema.competition).where(eq(schema.competition.id, compId));
	});

	async function setup() {
		const [comp] = await db
			.insert(schema.competition)
			.values({ slug, name: 'Kapplöpning', startDate: '2027-05-15', endDate: '2027-05-15', status: 'live', patrolCodeKey: 'k' })
			.returning();
		compId = comp.id;
		const [st] = await db.insert(schema.station).values({ competitionId: comp.id, sort: 1, name: 'K1' }).returning();
		const [item] = await db.insert(schema.scoreItem).values({ stationId: st.id, sort: 1, name: 'K1', mode: 'RANGE', min: 0, max: 20, styleEnabled: false }).returning();
		const patrols = await db
			.insert(schema.patrol)
			.values(Array.from({ length: 10 }, (_, i) => ({ competitionId: comp.id, number: 100 + i, name: `P${i}`, troop: 'Testkåren' })))
			.returning();
		return { comp, item, patrols };
	}

	it('two first reports at the same moment: one score, one conflict, no error', async () => {
		const { comp, item, patrols } = await setup();
		for (const p of patrols) {
			const write = (value: number, deviceId: string | null) =>
				writeScore({ competitionId: comp.id, patrolId: p.id, itemId: item.id, raw: { value, style: null }, baseVersion: null, origin: 'paper', userId: null, deviceId });
			const results = await Promise.all([write(12, null), write(15, null)]);
			expect(results.map((r) => r.result).sort(), p.name).toEqual(['accepted', 'conflict']);
			const scores = await db.select().from(schema.score).where(and(eq(schema.score.patrolId, p.id), eq(schema.score.itemId, item.id)));
			expect(scores).toHaveLength(1);
			const conflicts = await db.select().from(schema.scoreConflict).where(eq(schema.scoreConflict.patrolId, p.id));
			expect(conflicts).toHaveLength(1);
		}
		// Same value twice at once: merged, not a conflict.
		const p = patrols[0];
		await db.delete(schema.score).where(eq(schema.score.patrolId, p.id));
		const same = await Promise.all([1, 2].map(() => writeScore({ competitionId: comp.id, patrolId: p.id, itemId: item.id, raw: { value: 9, style: null }, baseVersion: null, origin: 'paper' })));
		expect(same.map((r) => r.result).sort()).toEqual(['accepted', 'duplicate']);
	});

	it('score writes racing with patrol updates never deadlock', async () => {
		const [comp] = await db.select().from(schema.competition).where(eq(schema.competition.id, compId));
		const [item] = await db
			.select({ id: schema.scoreItem.id })
			.from(schema.scoreItem)
			.innerJoin(schema.station, eq(schema.station.id, schema.scoreItem.stationId))
			.where(eq(schema.station.competitionId, comp.id));
		const patrols = await db.select().from(schema.patrol).where(eq(schema.patrol.competitionId, comp.id));
		// Like the start & finish desk / HQ edits: patrol row first, then a change_log entry.
		const deskUpdate = (patrolId: string) =>
			db.transaction(async (tx) => {
				await tx.select().from(schema.patrol).where(eq(schema.patrol.id, patrolId)).for('update');
				await tx.update(schema.patrol).set({ paid: true }).where(eq(schema.patrol.id, patrolId));
				await recordChange(tx, comp.id, 'patrol', patrolId);
			});
		const jobs: Promise<unknown>[] = [];
		for (let round = 0; round < 5; round++) {
			for (const p of patrols) {
				jobs.push(writeScore({ competitionId: comp.id, patrolId: p.id, itemId: item.id, raw: { value: round, style: null }, baseVersion: null, origin: 'admin', force: true }));
				jobs.push(deskUpdate(p.id));
			}
		}
		const settled = await Promise.allSettled(jobs);
		const failed = settled.filter((s) => s.status === 'rejected').map((s) => String((s as PromiseRejectedResult).reason));
		expect(failed).toEqual([]);
	});

	it('undoing the Mål scan of the wrong patrol takes it back to På banan', async () => {
		const [comp] = await db.select().from(schema.competition).where(eq(schema.competition.id, compId));
		const [mal] = await db.insert(schema.station).values({ competitionId: comp.id, sort: 9, name: 'Mål', role: 'finish' }).returning();
		const [malItem] = await db.insert(schema.scoreItem).values({ stationId: mal.id, sort: 1, name: 'Mål', mode: 'CHECKIN', min: 0, max: 0, styleEnabled: false }).returning();
		const [p] = await db.select().from(schema.patrol).where(and(eq(schema.patrol.competitionId, comp.id), eq(schema.patrol.number, 105)));
		const status = async () => (await db.select({ s: schema.patrol.status }).from(schema.patrol).where(eq(schema.patrol.id, p.id)))[0].s;
		expect(await status()).toBe('active'); // it has a K1 score from the tests above
		const w = { competitionId: comp.id, patrolId: p.id, itemId: malItem.id, origin: 'admin' as const };
		const r = await writeScore({ ...w, raw: { value: 1, style: null }, baseVersion: null });
		expect(await status()).toBe('finished');
		await voidScore({ ...w, baseVersion: r.result === 'accepted' ? r.version : null });
		expect(await status()).toBe('active');
		const events = await db.select({ s: schema.statusEvent.status }).from(schema.statusEvent).where(eq(schema.statusEvent.patrolId, p.id));
		expect(events.map((e) => e.s).slice(-2)).toEqual(['finished', 'active']);
	});
});


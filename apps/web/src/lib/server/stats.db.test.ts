/**
 * Integration test against the real dev/CI database: visit times (score.scored_at), payment dates
 * (patrol.paid_at) and the statistics built on them, also after "Ta bort personuppgifter".
 * Skipped when no database is reachable. All data is invented and removed afterwards.
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import { databaseReady, databaseUrl } from './testing/dbTestEnv.ts';

const URL_ = databaseUrl();
const ok = await databaseReady(URL_);

vi.mock('$app/env/private', () => ({ DATABASE_URL: URL_, ORIGIN: 'http://localhost' }));
vi.mock('$app/env', () => ({ dev: true }));

describe.skipIf(!ok)('statistics (database)', async () => {
	const { db, schema } = await import('./db/index.ts');
	const { writeScore } = await import('./scores.ts');
	const { loadStats } = await import('./stats.ts');
	const { paidAtFor } = await import('./payments.ts');
	const { anonymiseCompetition } = await import('./anonymise.ts');
	const { eq, and } = await import('drizzle-orm');
	const { randomBytes } = await import('node:crypto');
	const slug = `stats-test-${randomBytes(4).toString('hex')}`;
	let compId = '';

	afterAll(async () => {
		if (compId) await db.delete(schema.competition).where(eq(schema.competition.id, compId));
	});

	it('times come from the phones only, corrections keep them, and they survive removal of personal data', async () => {
		const [comp] = await db
			.insert(schema.competition)
			.values({ slug, name: 'Statistiktest', startDate: '2027-05-15', endDate: '2027-05-15', status: 'live', patrolCodeKey: 'k', feePerPatrol: 120 })
			.returning();
		compId = comp.id;
		const stations = await db
			.insert(schema.station)
			.values([1, 2, 3].map((i) => ({ competitionId: comp.id, sort: i, name: `Kontroll ${i}` })))
			.returning();
		const items = await db
			.insert(schema.scoreItem)
			.values(stations.map((s) => ({ stationId: s.id, sort: 1, name: s.name, mode: 'RANGE' as const, min: 0, max: 20, styleEnabled: false })))
			.returning();
		const patrols = await db
			.insert(schema.patrol)
			.values([1, 2, 3].map((n) => ({ competitionId: comp.id, number: 100 + n, name: `Patrull ${n}`, troop: 'Testkåren' })))
			.returning();
		const at = (hhmm: string) => new Date(`2027-05-15T${hhmm}:00+02:00`);
		const w = (p: number, i: number, value: number, origin: 'device' | 'paper' | 'admin', when?: string, baseVersion: number | null = null) =>
			writeScore({ competitionId: comp.id, patrolId: patrols[p].id, itemId: items[i].id, raw: { value, style: null }, baseVersion, origin, at: when ? at(when) : null });

		// Patrol 1: three phone reports. Patrol 2: two phone reports, then HQ corrects one. Patrol 3: paper only.
		await w(0, 0, 12, 'device', '10:00');
		await w(0, 1, 16, 'device', '10:30');
		await w(0, 2, 20, 'device', '11:20');
		await w(1, 0, 8, 'device', '10:10');
		await w(1, 1, 10, 'device', '10:50');
		expect((await w(1, 1, 14, 'admin', undefined, 1)).result).toBe('accepted');
		await w(2, 0, 18, 'paper');

		const scored = await db.select({ p: schema.score.patrolId, i: schema.score.itemId, at: schema.score.scoredAt, origin: schema.score.origin }).from(schema.score).where(eq(schema.score.competitionId, comp.id));
		const of = (p: number, i: number) => scored.find((s) => s.p === patrols[p].id && s.i === items[i].id)!;
		expect(of(0, 1).at).toEqual(at('10:30'));
		expect(of(1, 1).origin).toBe('admin');
		expect(of(1, 1).at).toEqual(at('10:50')); // the correction keeps the visit time
		expect(of(2, 0).at).toBeNull(); // paper has no time

		// Payments: ticking sets the date once, re-saving keeps it, unticking clears it.
		const pay = (p: number, paid: boolean) => db.update(schema.patrol).set({ paid, paidAt: paidAtFor(paid) }).where(eq(schema.patrol.id, patrols[p].id));
		const paidAt = async (p: number) => (await db.select({ a: schema.patrol.paidAt }).from(schema.patrol).where(eq(schema.patrol.id, patrols[p].id)))[0].a;
		await pay(0, true);
		const first = await paidAt(0);
		expect(first).toBeInstanceOf(Date);
		await pay(0, true);
		expect(await paidAt(0)).toEqual(first);
		await pay(1, true);
		await pay(1, false);
		expect(await paidAt(1)).toBeNull();

		const fresh = (await db.select().from(schema.competition).where(eq(schema.competition.id, comp.id)))[0];
		const stats = await loadStats(fresh, { internal: true });
		const all = stats.scopes[0];
		expect(all.participation).toEqual({ registered: 3, started: 3, finished: 0, resigned: 0 });
		const k1 = all.stations.find((s) => s.name === 'Kontroll 1')!;
		expect(k1.points).toMatchObject({ n: 3, min: 8, max: 18, median: 12 });
		expect(k1.pctOfMax).toBe(63);
		const leg = all.times!.legs.find((l) => l.fromName === 'Kontroll 1' && l.toName === 'Kontroll 2')!;
		expect(leg.minutes).toMatchObject({ n: 2, min: 30, max: 40 });
		expect(all.times!.timedPatrols).toBe(2);
		expect(stats.payments).toMatchObject({ fee: 120, paid: 1, unpaid: 2, received: 120, outstanding: 240 });

		// Public view while live: participation only (the organiser has not turned on station results).
		const pub = await loadStats(fresh);
		expect(pub.stationsShown).toBe(false);
		expect(pub.scopes[0].stations).toEqual([]);
		expect(pub.scopes[0].times).toBeNull();
		expect('payments' in pub).toBe(false);

		// Close and remove personal data: the same statistics remain, now public.
		await db.update(schema.competition).set({ status: 'closed' }).where(eq(schema.competition.id, comp.id));
		await anonymiseCompetition(comp.id);
		const closed = (await db.select().from(schema.competition).where(eq(schema.competition.id, comp.id)))[0];
		const after = await loadStats(closed);
		expect(after.stationsShown).toBe(true);
		expect(after.scopes).toEqual(stats.scopes);
		const left = await db.select({ at: schema.score.scoredAt }).from(schema.score).where(and(eq(schema.score.competitionId, comp.id), eq(schema.score.patrolId, patrols[0].id)));
		expect(left.every((s) => s.at instanceof Date)).toBe(true);
	});
});

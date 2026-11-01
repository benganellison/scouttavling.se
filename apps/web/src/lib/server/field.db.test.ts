/**
 * Integration test against the dev/CI database: signed commands from a real (test) phone through
 * syncCommands — accepted and duplicate, a "pending" placeholder left by a crash is processed again
 * (never answered as a rejection), a closed competition keeps late reports for HQ, and one phone
 * cannot park more than MAX_OPEN_QUARANTINE reports. All data is invented and removed afterwards.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { databaseReady, databaseUrl } from './testing/dbTestEnv.ts';

const URL_ = databaseUrl();
const ok = await databaseReady(URL_);

vi.mock('$app/env/private', () => ({ DATABASE_URL: URL_, ORIGIN: 'http://localhost', GRANT_SIGNING_KEY: undefined }));
vi.mock('$app/env', () => ({ dev: true }));

const SLUG = 'vt-field-sync-test';

describe.skipIf(!ok)('field sync commands (database)', async () => {
	const { db, schema } = await import('./db/index.ts');
	const { and, eq } = await import('drizzle-orm');
	const { randomToken, sha256 } = await import('./auth.ts');
	const { redeemInvite } = await import('./field/join.ts');
	const { authenticateDevice } = await import('./field/device.ts');
	const { syncCommands } = await import('./field/commands.ts');
	const { generateDeviceKey, signCommand, uuidv7 } = await import('#lib/field/protocol.ts');
	const { resolveConflict } = await import('./conflicts.ts');

	let compId = '';
	let itemId = '';
	const patrolIds: string[] = [];
	let key: Awaited<ReturnType<typeof generateDeviceKey>>;
	let deviceId = '';
	let grant = '';
	let seq = 0;

	const ctx = () =>
		authenticateDevice(new Request(`http://localhost/api/v1/field/${SLUG}/sync/commands`, { headers: { authorization: `Grant ${grant}` } }), SLUG);
	const score = (patrolId: string, value: number, commandId = uuidv7()) =>
		signCommand(key.privateKey, {
			commandId,
			deviceId,
			deviceSeq: ++seq,
			baseVersion: null,
			clientNow: new Date().toISOString(),
			prev: null,
			type: 'SetScore',
			payload: { patrolId, itemId, value, style: null }
		});

	beforeAll(async () => {
		await db.delete(schema.competition).where(eq(schema.competition.slug, SLUG));
		const [comp] = await db
			.insert(schema.competition)
			.values({ slug: SLUG, name: 'Synktest', startDate: '2099-05-15', endDate: '2099-05-15', status: 'live', patrolCodeKey: 'k' })
			.returning();
		compId = comp.id;
		const [station] = await db.insert(schema.station).values({ competitionId: compId, sort: 1, name: 'Kontroll 1' }).returning();
		const [item] = await db
			.insert(schema.scoreItem)
			.values({ stationId: station.id, sort: 1, name: 'Kontroll 1', mode: 'RANGE' as const, min: 0, max: 20, styleEnabled: false })
			.returning();
		itemId = item.id;
		const patrols = await db
			.insert(schema.patrol)
			.values([1, 2, 3, 4].map((n) => ({ competitionId: compId, number: 100 + n, name: `Patrull ${n}`, troop: 'Testkåren' })))
			.returning();
		patrolIds.push(...patrols.map((p) => p.id));
		const secret = randomToken(16);
		await db.insert(schema.invite).values({ competitionId: compId, stationId: station.id, role: 'station_volunteer', secretHash: await sha256(secret) });
		key = await generateDeviceKey();
		const joined = await redeemInvite({ secret, displayName: 'Testtelefon', publicJwk: key.publicJwk });
		grant = joined.grant;
		deviceId = joined.deviceId;
	});

	afterAll(async () => {
		await db.delete(schema.competition).where(eq(schema.competition.id, compId));
	});

	it('accepts a signed score once and answers a resend as a duplicate', async () => {
		const jws = await score(patrolIds[0], 17);
		const first = await syncCommands(await ctx(), [jws]);
		expect(first.results[0]).toMatchObject({ result: 'accepted', version: 1 });
		const again = await syncCommands(await ctx(), [jws]);
		expect(again.results[0].result).toBe('duplicate');
		const [s] = await db
			.select()
			.from(schema.score)
			.where(and(eq(schema.score.patrolId, patrolIds[0]), eq(schema.score.itemId, itemId)));
		expect(s.points).toBe(17);
	});

	it('processes a command again when a crash left only its pending placeholder', async () => {
		const commandId = uuidv7();
		const jws = await score(patrolIds[1], 12, commandId);
		await db.insert(schema.command).values({
			id: commandId,
			competitionId: compId,
			deviceId,
			deviceSeq: seq,
			type: 'SetScore',
			payload: {},
			clientAt: new Date(),
			result: 'rejected',
			resultDetail: { pending: true }
		});
		const r = await syncCommands(await ctx(), [jws]);
		expect(r.results[0]).toMatchObject({ result: 'accepted' });
		const [row] = await db.select().from(schema.command).where(eq(schema.command.id, commandId));
		expect(row.result).toBe('accepted');
	});

	it('keeps a late report for HQ when the competition is closed, up to the per-phone limit', async () => {
		await db.update(schema.competition).set({ status: 'closed' }).where(eq(schema.competition.id, compId));
		const late = await syncCommands(await ctx(), [await score(patrolIds[2], 9)]);
		expect(late.results[0]).toMatchObject({ result: 'quarantined', reason: 'Tävlingen är avslutad' });
		const scored = await db.select().from(schema.score).where(eq(schema.score.patrolId, patrolIds[2]));
		expect(scored).toHaveLength(0);
		const open = await db
			.select()
			.from(schema.scoreConflict)
			.where(and(eq(schema.scoreConflict.competitionId, compId), eq(schema.scoreConflict.kind, 'quarantine')));
		expect(open).toHaveLength(1);
		expect(open[0].incoming).toMatchObject({ deviceId, reason: 'Tävlingen är avslutad', raw: { value: 9 } });

		// Fill this phone's quarantine to the limit: the next late report is refused, not parked.
		await db.insert(schema.scoreConflict).values(
			Array.from({ length: 199 }, () => ({
				competitionId: compId,
				patrolId: patrolIds[3],
				itemId,
				kind: 'quarantine' as const,
				existing: {},
				incoming: { type: 'SetScore' as const, deviceId, reason: 'test' }
			}))
		);
		const full = await syncCommands(await ctx(), [await score(patrolIds[3], 5)]);
		expect(full.results[0].result).toBe('rejected');
		const count = await db.select().from(schema.scoreConflict).where(eq(schema.scoreConflict.competitionId, compId));
		expect(count).toHaveLength(200);
	});

	it('HQ uses the parked late report: applied and resolved together, and only once', async () => {
		const [parked] = await db
			.select()
			.from(schema.scoreConflict)
			.where(and(eq(schema.scoreConflict.competitionId, compId), eq(schema.scoreConflict.patrolId, patrolIds[2])));
		const [hq] = await db.select({ id: schema.appUser.id }).from(schema.appUser).limit(1);
		const first = await resolveConflict(compId, parked.id, 'useNew', hq.id);
		expect(first).toMatchObject({ ok: true, message: 'Den nya poängen används.' });
		const [s] = await db.select().from(schema.score).where(eq(schema.score.patrolId, patrolIds[2]));
		expect(s.points).toBe(9);
		const [after] = await db.select().from(schema.scoreConflict).where(eq(schema.scoreConflict.id, parked.id));
		expect(after.status).toBe('resolved');
		expect(await resolveConflict(compId, parked.id, 'useNew', hq.id)).toMatchObject({ ok: false, status: 404 });
	});
});

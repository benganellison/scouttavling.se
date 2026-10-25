/**
 * Integration test against the real dev/CI database: rank → "Ta bort personuppgifter" → rank,
 * the results must be deep-equal, and no personal data may remain in any affected table.
 * Skipped when no database is reachable (the plain unit-test CI job has none; the UAT job runs it).
 * All data is invented and removed afterwards.
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

function databaseUrl(): string | undefined {
	if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
	try {
		const env = readFileSync(fileURLToPath(new URL('../../../.env', import.meta.url)), 'utf8');
		return /^DATABASE_URL=["']?([^"'\n]+)/m.exec(env)?.[1];
	} catch {
		return undefined;
	}
}
const URL_ = databaseUrl();
async function reachable() {
	if (!URL_) return false;
	const probe = postgres(URL_, { max: 1, connect_timeout: 2, onnotice: () => {} });
	try {
		const [{ n }] = await probe`select count(*)::int n from information_schema.tables where table_name = 'retired_link'`;
		return n === 1;
	} catch {
		return false;
	} finally {
		await probe.end({ timeout: 1 });
	}
}
const ok = await reachable();

vi.mock('$app/env/private', () => ({ DATABASE_URL: URL_, ORIGIN: 'http://localhost' }));
vi.mock('$app/env', () => ({ dev: true }));

describe.skipIf(!ok)('anonymiseCompetition (database)', async () => {
	const { db, schema } = await import('./db/index.ts');
	const { anonymiseCompetition, personalDataLeft, archivedLinkTarget } = await import('./anonymise.ts');
	const { computeResults, loadResultsInput } = await import('./live.ts');
	const { eq, inArray } = await import('drizzle-orm');
	const { createHash, randomBytes } = await import('node:crypto');
	const sha = (t: string) => createHash('sha256').update(t).digest('base64url');
	const slug = `anon-test-${randomBytes(4).toString('hex')}`;
	const manageToken = randomBytes(16).toString('base64url');
	const followToken = randomBytes(16).toString('base64url');
	let compId = '';
	const userIds: string[] = [];

	afterAll(async () => {
		if (compId) await db.delete(schema.competition).where(eq(schema.competition.id, compId));
		if (userIds.length) await db.delete(schema.appUser).where(inArray(schema.appUser.id, userIds));
	});

	it('keeps the ranking identical and leaves no personal data', async () => {
		const [owner, helper] = await db
			.insert(schema.appUser)
			.values([
				{ memberNo: `t-${slug}-1`, name: 'Ägare Påhittad' },
				{ memberNo: `t-${slug}-2`, name: 'Hjälpare Påhittad' }
			])
			.returning();
		userIds.push(owner.id, helper.id);
		const [comp] = await db
			.insert(schema.competition)
			.values({ slug, name: 'Testtävling', startDate: '2026-05-16', endDate: '2026-05-16', status: 'closed', patrolCodeKey: 'k', hqPhone: '070-1', publicResults: true })
			.returning();
		compId = comp.id;
		await db.insert(schema.competitionMember).values([
			{ competitionId: comp.id, userId: owner.id, role: 'owner' },
			{ competitionId: comp.id, userId: helper.id, role: 'organiser' },
			{ competitionId: comp.id, userId: helper.id, role: 'hq' }
		]);
		const tracks = await db.insert(schema.track).values([{ competitionId: comp.id, name: 'A', sort: 1 }, { competitionId: comp.id, name: 'B', sort: 2 }]).returning();
		const stations = await db
			.insert(schema.station)
			.values([1, 2, 3].map((i) => ({ competitionId: comp.id, sort: i, name: `K${i}`, contactName: 'Kontrollansvarig Påhittad', contactPhone: '070-2' })))
			.returning();
		const items = await db
			.insert(schema.scoreItem)
			.values(stations.map((s) => ({ stationId: s.id, sort: 1, name: s.name, mode: 'RANGE' as const, min: 0, max: 20 })))
			.returning();
		const patrols = await db
			.insert(schema.patrol)
			.values(
				[1, 2, 3, 4, 5, 6].map((n) => ({
					competitionId: comp.id, number: 100 + n, name: `Patrull ${n}`, troop: 'Testkåren', trackId: tracks[n % 2].id, status: 'finished' as const,
					contactName: 'Förälder Påhittad', contactEmail: 'p@example.org', contactPhone: '070-3', contactMemberNo: '123',
					manageTokenHash: n === 1 ? sha(manageToken) : null, followTokenHash: n === 1 ? sha(followToken) : null, followTokenEnc: n === 1 ? 'enc' : null
				}))
			)
			.returning();
		await db.insert(schema.member).values(patrols.flatMap((p) => [{ patrolId: p.id, firstName: 'Scout', lastName: 'Påhittad', troopText: 'Testkåren' }]));
		const [invite] = await db.insert(schema.invite).values({ competitionId: comp.id, role: 'station_volunteer', stationId: stations[0].id, secretHash: sha(slug) }).returning();
		const [device] = await db
			.insert(schema.device)
			.values({ competitionId: comp.id, inviteId: invite.id, role: 'station_volunteer', stationIds: [stations[0].id], displayName: 'Volontär Påhittad', publicJwk: { kty: 'EC' } })
			.returning();
		// Scores with a tie (patrol 2 and 4) and a style-decided pair.
		const pts: Record<number, [number, number][]> = { 1: [[18, 4], [15, 3], [12, 2]], 2: [[10, 2], [10, 2], [10, 2]], 3: [[20, 5], [19, 5], [2, 0]], 4: [[10, 2], [10, 2], [10, 2]], 5: [[14, 1], [14, 1], [14, 1]], 6: [[13, 5], [13, 5], [13, 5]] };
		for (const [i, p] of patrols.entries()) {
			for (const [j, [v, st]] of pts[i + 1].entries()) {
				const [sc] = await db
					.insert(schema.score)
					.values({ competitionId: comp.id, patrolId: p.id, itemId: items[j].id, points: v, stylePoints: st, raw: { value: v, style: st }, origin: 'device', deviceId: device.id, userId: helper.id, note: 'Rättad av Hjälpare Påhittad' })
					.returning();
				await db.insert(schema.scoreRevision).values({ scoreId: sc.id, version: 1, points: v, stylePoints: st, state: 'active', origin: 'device', deviceId: device.id, userId: helper.id, commandId: crypto.randomUUID(), reason: 'Enligt Hjälpare Påhittad' });
			}
			await db.insert(schema.statusEvent).values({ patrolId: p.id, status: 'finished', deviceId: device.id, userId: helper.id });
		}
		await db.insert(schema.scoreConflict).values({
			competitionId: comp.id, patrolId: patrols[0].id, itemId: items[0].id, existing: { points: 18 },
			incoming: { points: 17, deviceName: 'Volontär Påhittad', deviceId: device.id, reason: 'Ångrat av Volontär Påhittad' }, commandId: crypto.randomUUID()
		});
		await db.insert(schema.command).values({ id: crypto.randomUUID(), competitionId: comp.id, deviceId: device.id, type: 'RecordScore', payload: { note: 'Volontär Påhittad' }, result: 'accepted', resultDetail: { by: 'Volontär Påhittad' } });
		const [msg] = await db.insert(schema.message).values({ competitionId: comp.id, title: 'Hej', body: 'Ring Hjälpare Påhittad', createdBy: helper.id }).returning();
		await db.insert(schema.messageRead).values({ messageId: msg.id, deviceId: device.id });
		await db.insert(schema.asset).values({ competitionId: comp.id, kind: 'cover', mime: 'image/png', size: 1, width: 1, height: 1, sha256: 'x', data: new Uint8Array([1]), uploadedBy: helper.id });

		expect(await personalDataLeft(comp.id)).toBe(6);
		const before = computeResults(await loadResultsInput(comp));
		expect(before.flatMap((t) => t.rows).some((r) => r.tied)).toBe(true);

		await anonymiseCompetition(comp.id);

		const after = computeResults(await loadResultsInput(comp));
		expect(after).toEqual(before);
		expect(await personalDataLeft(comp.id)).toBe(0);

		// Every affected table, queried directly.
		const pids = patrols.map((p) => p.id);
		const ps = await db.select().from(schema.patrol).where(eq(schema.patrol.competitionId, comp.id));
		for (const p of ps) {
			expect([p.contactName, p.contactEmail, p.contactPhone, p.contactMemberNo, p.manageTokenHash, p.followTokenHash, p.followTokenEnc]).toEqual([null, null, null, null, null, null, null]);
			expect(p.name).toMatch(/^Patrull \d$/);
			expect(p.troop).toBe('Testkåren');
		}
		expect(await db.select().from(schema.member).where(inArray(schema.member.patrolId, pids))).toEqual([]);
		expect(await db.select().from(schema.device).where(eq(schema.device.competitionId, comp.id))).toEqual([]);
		expect(await db.select().from(schema.invite).where(eq(schema.invite.competitionId, comp.id))).toEqual([]);
		expect(await db.select().from(schema.message).where(eq(schema.message.competitionId, comp.id))).toEqual([]);
		expect(await db.select().from(schema.messageRead).where(eq(schema.messageRead.messageId, msg.id))).toEqual([]);
		const scores = await db.select().from(schema.score).where(eq(schema.score.competitionId, comp.id));
		expect(scores).toHaveLength(18);
		expect(scores.every((s) => s.note === null && s.userId === null && s.deviceId === null)).toBe(true);
		const revs = await db.select().from(schema.scoreRevision).where(inArray(schema.scoreRevision.scoreId, scores.map((s) => s.id)));
		expect(revs.every((r) => r.reason === null && r.userId === null && r.deviceId === null && r.commandId === null)).toBe(true);
		const [conflict] = await db.select().from(schema.scoreConflict).where(eq(schema.scoreConflict.competitionId, comp.id));
		expect(conflict.incoming).toEqual({ points: 17 });
		expect(conflict.commandId).toBeNull();
		const events = await db.select().from(schema.statusEvent).where(inArray(schema.statusEvent.patrolId, pids));
		expect(events.every((e) => e.deviceId === null && e.userId === null)).toBe(true);
		const [cmd] = await db.select().from(schema.command).where(eq(schema.command.competitionId, comp.id));
		expect([cmd.payload, cmd.resultDetail, cmd.deviceId]).toEqual([{}, null, null]);
		const members = await db.select().from(schema.competitionMember).where(eq(schema.competitionMember.competitionId, comp.id));
		expect(members).toEqual([{ competitionId: comp.id, userId: owner.id, role: 'owner' }]);
		const sts = await db.select().from(schema.station).where(eq(schema.station.competitionId, comp.id));
		expect(sts.every((s) => s.contactName === null && s.contactPhone === null)).toBe(true);
		const [asset] = await db.select().from(schema.asset).where(eq(schema.asset.competitionId, comp.id));
		expect(asset.uploadedBy).toBeNull();
		const [c] = await db.select().from(schema.competition).where(eq(schema.competition.id, comp.id));
		expect(c.anonymisedAt).toBeInstanceOf(Date);
		expect(c.hqPhone).toBeNull();
		// No text column of the edition still holds an invented name.
		const dump = JSON.stringify({ ps, scores, revs, conflict, cmd, sts, events });
		expect(dump).not.toMatch(/Påhittad|example\.org/);
		// Old links now point to the archived page.
		expect(await archivedLinkTarget(manageToken)).toBe(`/arkiverad/${slug}`);
		expect(await archivedLinkTarget(followToken)).toBe(`/arkiverad/${slug}`);
	});

	it('refuses an edition that is not closed', async () => {
		await db.update(schema.competition).set({ status: 'live' }).where(eq(schema.competition.id, compId));
		await expect(anonymiseCompetition(compId)).rejects.toThrow(/avslutad/);
	});
});

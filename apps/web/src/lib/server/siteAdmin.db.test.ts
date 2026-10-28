/**
 * Integration tests against the dev/CI database: the ≥ 1 owner invariant (also under concurrency),
 * the site-admin gate, temporary access expiry, a suspended competition refusing field sync, the
 * append-only audit log and the site-admin CLI. Skipped without a reachable, migrated database.
 * All data is invented and removed afterwards (audit rows stay: the log is append-only).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import postgres from 'postgres';
import { databaseReady, databaseUrl } from './testing/dbTestEnv.ts';

const URL_ = databaseUrl();
const ok = await databaseReady(URL_);

vi.mock('$app/env/private', () => ({ DATABASE_URL: URL_, ORIGIN: 'http://localhost', GRANT_SIGNING_KEY: undefined }));
vi.mock('$app/env', () => ({ dev: true }));

const run = promisify(execFile);
const WEB = fileURLToPath(new URL('../../..', import.meta.url));
const SLUG = 'vt-siteadmin-test';
const NOS = ['7100001', '7100002', '7100003', '7100004'];

describe.skipIf(!ok)('owners, site admin and audit (database)', async () => {
	const { db, schema } = await import('./db/index.ts');
	const { eq, inArray, and } = await import('drizzle-orm');
	const own = await import('./ownership.ts');
	const sa = await import('./siteAdmin.ts');
	const auth = await import('./auth.ts');
	const field = await import('./field.ts');
	const sql = postgres(URL_!, { max: 2, onnotice: () => {} });

	let compId = '';
	let seriesId = '';
	const u: Record<string, { id: string; name: string }> = {};
	const scope = () => ({ kind: 'competition' as const, id: compId });
	const user = (k: string) => ({ kind: 'user' as const, userId: u[k].id });
	const owners = async () =>
		(
			await db
				.select()
				.from(schema.competitionMember)
				.where(and(eq(schema.competitionMember.competitionId, compId), eq(schema.competitionMember.role, 'owner')))
		).length;

	async function cleanup() {
		await db.delete(schema.competition).where(eq(schema.competition.slug, SLUG));
		await db.delete(schema.series).where(eq(schema.series.slug, SLUG + '-serie'));
		await db.delete(schema.appUser).where(inArray(schema.appUser.memberNo, NOS));
	}

	beforeAll(async () => {
		await cleanup();
		for (const [i, k] of ['anna', 'bo', 'cia', 'admin'].entries()) {
			const [row] = await db
				.insert(schema.appUser)
				.values({ memberNo: NOS[i], name: `Test ${k}`, groups: [] })
				.returning();
			u[k] = { id: row.id, name: row.name };
		}
		const [s] = await db
			.insert(schema.series)
			.values({ slug: SLUG + '-serie', name: 'Testserie' })
			.returning();
		seriesId = s.id;
		const [c] = await db
			.insert(schema.competition)
			.values({ slug: SLUG, name: 'Testtävling', startDate: '2027-05-01', endDate: '2027-05-01', patrolCodeKey: 'k', status: 'live', seriesId })
			.returning();
		compId = c.id;
		await db.insert(schema.competitionMember).values([
			{ competitionId: compId, userId: u.anna.id, role: 'owner' },
			{ competitionId: compId, userId: u.bo.id, role: 'organiser' }
		]);
	});
	afterAll(async () => {
		await cleanup();
		await sql.end();
	});

	it('the last owner cannot leave, demote or remove themselves', async () => {
		await expect(own.changeMembers(scope(), user('anna'), [{ op: 'remove', userId: u.anna.id }])).rejects.toMatchObject({ code: 'last_owner' });
		await expect(own.changeMembers(scope(), user('anna'), [{ op: 'set', userId: u.anna.id, role: 'organiser' }])).rejects.toMatchObject({ code: 'last_owner' });
		await expect(own.transferOwnership(scope(), user('anna'), u.anna.id)).rejects.toMatchObject({ code: 'no_change' });
		expect(await owners()).toBe(1);
	});

	it('organisers cannot change owners; owners add a co-owner and transfer ownership (audited)', async () => {
		await expect(own.changeMembers(scope(), user('bo'), [{ op: 'set', userId: u.bo.id, role: 'owner' }])).rejects.toMatchObject({ code: 'forbidden' });
		await expect(own.changeMembers(scope(), user('bo'), [{ op: 'remove', userId: u.anna.id }])).rejects.toMatchObject({ code: 'forbidden' });
		await expect(own.changeMembers(scope(), user('cia'), [{ op: 'set', userId: u.cia.id, role: 'organiser' }])).rejects.toMatchObject({ code: 'forbidden' });
		// Organisers may add organisers.
		await own.changeMembers(scope(), user('bo'), [{ op: 'set', userId: u.cia.id, role: 'organiser' }]);
		await own.transferOwnership(scope(), user('anna'), u.bo.id);
		const list = await own.listMembers(scope());
		expect(list.map((m) => [m.name, m.role])).toEqual([
			['Test bo', 'owner'],
			['Test anna', 'organiser'],
			['Test cia', 'organiser']
		]);
		const rows = await sql`select action, actor_user_id from audit_log where competition_id = ${compId} order by at`;
		expect(rows.map((r) => r.action)).toEqual(['member.add', 'owner.transfer']);
	});

	it('concurrent changes can never leave zero owners', async () => {
		await own.changeMembers(scope(), user('bo'), [{ op: 'set', userId: u.anna.id, role: 'owner' }]);
		expect(await owners()).toBe(2);
		// Both owners leave at the same time. Each transaction holds a while before commit, so without
		// the row lock both would see "2 owners" and both succeed.
		const hold = () => new Promise<void>((r) => setTimeout(r, 300));
		const results = await Promise.allSettled([
			own.changeMembers(scope(), user('anna'), [{ op: 'remove', userId: u.anna.id }], { beforeCommit: hold }),
			own.changeMembers(scope(), user('bo'), [{ op: 'remove', userId: u.bo.id }], { beforeCommit: hold })
		]);
		expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
		const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
		expect(rejected.reason).toMatchObject({ code: 'last_owner' });
		expect(await owners()).toBe(1);
		// Mutual demotion at the same time: also exactly one owner left.
		const [left] = (await own.listMembers(scope())).filter((m) => m.role === 'owner');
		const other = left.userId === u.anna.id ? 'bo' : 'anna';
		await own.changeMembers(scope(), { kind: 'user', userId: left.userId }, [{ op: 'set', userId: u[other].id, role: 'owner' }]);
		await Promise.allSettled([
			own.changeMembers(scope(), user('anna'), [{ op: 'set', userId: u.bo.id, role: 'organiser' }], { beforeCommit: hold }),
			own.changeMembers(scope(), user('bo'), [{ op: 'set', userId: u.anna.id, role: 'organiser' }], { beforeCommit: hold })
		]);
		expect(await owners()).toBe(1);
	});

	it('series owners: lazily taken from the editions, same invariant', async () => {
		const s = { kind: 'series' as const, id: seriesId };
		const list = await own.listMembers(s);
		expect(list.filter((m) => m.role === 'owner')).toHaveLength(1);
		const owner = list.find((m) => m.role === 'owner')!;
		await expect(own.changeMembers(s, { kind: 'user', userId: owner.userId }, [{ op: 'remove', userId: owner.userId }])).rejects.toMatchObject({
			code: 'last_owner'
		});
	});

	it('a site admin replaces a gone owner in one step, with a reason', async () => {
		const [cur] = (await own.listMembers(scope())).filter((m) => m.role === 'owner');
		const adminActor = { kind: 'site_admin' as const, userId: u.admin.id, reason: 'kort' };
		await expect(own.changeMembers(scope(), adminActor, [{ op: 'set', userId: u.cia.id, role: 'owner' }])).rejects.toMatchObject({ code: 'reason' });
		const actor = { ...adminActor, reason: 'Ägaren har slutat, ärende från distriktet' };
		// Removing first alone would leave zero owners.
		await expect(own.changeMembers(scope(), actor, [{ op: 'remove', userId: cur.userId }])).rejects.toMatchObject({ code: 'last_owner' });
		await own.changeMembers(scope(), actor, [
			{ op: 'set', userId: u.cia.id, role: 'owner' },
			{ op: 'remove', userId: cur.userId }
		]);
		const list = await own.listMembers(scope());
		expect(list.filter((m) => m.role === 'owner').map((m) => m.name)).toEqual(['Test cia']);
		const [row] = await sql`select actor_kind, reason from audit_log where competition_id = ${compId} order by at desc limit 1`;
		expect(row).toMatchObject({ actor_kind: 'site_admin', reason: 'Ägaren har slutat, ärende från distriktet' });
	});

	it('the audit log is append-only (UPDATE, DELETE and TRUNCATE fail)', async () => {
		await expect(sql`update audit_log set reason = 'x' where competition_id = ${compId}`).rejects.toThrow(/append-only/);
		await expect(sql`delete from audit_log where competition_id = ${compId}`).rejects.toThrow(/append-only/);
		await expect(sql`truncate audit_log`).rejects.toThrow(/append-only/);
	});

	it('the site-admin gate answers 404 to everyone else', async () => {
		const asUser = (siteAdmin: boolean | null) => ({
			locals: { user: siteAdmin === null ? null : { id: u.cia.id, memberNo: NOS[2], name: 'x', groups: [], csrf: 'c', siteAdmin } }
		});
		expect(() => sa.requireSiteAdmin(asUser(null))).toThrow(expect.objectContaining({ status: 404 }));
		expect(() => sa.requireSiteAdmin(asUser(false))).toThrow(expect.objectContaining({ status: 404 }));
		expect(sa.requireSiteAdmin(asUser(true)).id).toBe(u.cia.id);
	});

	it('temporary access: a role source in requireCompetition that expires by itself', async () => {
		await db.insert(schema.siteAdmin).values({ userId: u.admin.id, grantedBy: 'test', reason: 'integration test' });
		const admin = { id: u.admin.id, memberNo: NOS[3], name: 'Test admin', groups: [], csrf: 'c', siteAdmin: true };
		const event = (method = 'GET') =>
			({
				locals: { user: admin },
				url: new URL('http://localhost/admin/' + SLUG),
				route: { id: '/admin/[slug]' },
				request: new Request('http://localhost/', { method })
			}) as never;
		// No automatic access.
		await expect(auth.requireCompetition(event(), SLUG)).rejects.toMatchObject({ status: 403 });
		await expect(sa.grantAccess(admin, compId, 'kort', 2)).rejects.toThrow(/minst 10/);
		const a = await sa.grantAccess(admin, compId, 'Ägaren bad om hjälp med kontrollerna', 2);
		const r = await auth.requireCompetition(event(), SLUG, ['owner', 'organiser']);
		expect(r.roles).toEqual(['organiser']);
		expect(r.access?.reason).toBe('Ägaren bad om hjälp med kontrollerna');
		// Organiser-level only: not owner pages.
		await expect(auth.requireCompetition(event(), SLUG, ['owner'])).rejects.toMatchObject({ status: 403 });
		// Owners are told.
		expect((await sa.accessNotices(compId))[0]).toMatchObject({ adminName: 'Test admin', active: true });
		// Expiry: no job needed, the read checks the time.
		await db
			.update(schema.siteAdminAccess)
			.set({ expiresAt: new Date(Date.now() - 1000) })
			.where(eq(schema.siteAdminAccess.id, a.id));
		await expect(auth.requireCompetition(event(), SLUG)).rejects.toMatchObject({ status: 403 });
		expect((await sa.accessNotices(compId))[0]).toMatchObject({ active: false });
		await db.delete(schema.siteAdmin).where(eq(schema.siteAdmin.userId, u.admin.id));
	});

	it('a suspended competition refuses field sync, joining and admin writes', async () => {
		// A real device: invite → redeem with a fresh key → grant.
		const secret = auth.randomToken(16);
		const [inv] = await db
			.insert(schema.invite)
			.values({ competitionId: compId, role: 'startfinish', secretHash: await auth.sha256(secret) })
			.returning();
		const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
		const publicJwk = await crypto.subtle.exportKey('jwk', kp.publicKey);
		const { grant } = await field.redeemInvite({ secret, displayName: 'Testtelefon', publicJwk });
		const req = () => new Request(`http://localhost/api/v1/field/${SLUG}/snapshot`, { headers: { authorization: `Grant ${grant}` } });
		await expect(field.authenticateDevice(req(), SLUG)).resolves.toMatchObject({ comp: { id: compId } });

		const admin = { id: u.admin.id, memberNo: NOS[3], name: 'Test admin', groups: [], csrf: 'c', siteAdmin: true };
		await sa.setCompetitionSuspended(admin, compId, true, 'Misstänkt missbruk, utreds');
		await expect(field.authenticateDevice(req(), SLUG)).rejects.toMatchObject({ status: 423 });
		await expect(field.redeemInvite({ secret, displayName: 'Telefon 2', publicJwk })).rejects.toMatchObject({ status: 423 });
		const [owner] = (await own.listMembers(scope())).filter((m) => m.role === 'owner');
		const ownerUser = { id: owner.userId, memberNo: owner.memberNo, name: owner.name, groups: [], csrf: 'c', siteAdmin: false };
		const ev = (method: string) =>
			({
				locals: { user: ownerUser },
				url: new URL('http://localhost/'),
				route: { id: '/admin/[slug]/settings' },
				request: new Request('http://localhost/', { method })
			}) as never;
		await expect(auth.requireCompetition(ev('POST'), SLUG)).rejects.toMatchObject({ status: 423 });
		await expect(auth.requireCompetition(ev('GET'), SLUG)).resolves.toBeTruthy();

		await sa.setCompetitionSuspended(admin, compId, false, 'Utrett, inget missbruk');
		await expect(field.authenticateDevice(req(), SLUG)).resolves.toBeTruthy();
		await db.delete(schema.invite).where(eq(schema.invite.id, inv.id));
	});

	it('a suspended user cannot log in and loses their sessions', async () => {
		await db.insert(schema.session).values({ idHash: 'vt-session-' + u.bo.id, userId: u.bo.id, csrf: 'c', expiresAt: new Date(Date.now() + 3600_000) });
		const admin = { id: u.admin.id, memberNo: NOS[3], name: 'Test admin', groups: [], csrf: 'c', siteAdmin: true };
		await sa.setUserSuspended(admin, u.bo.id, true, 'Kontot används av fel person');
		expect(await db.select().from(schema.session).where(eq(schema.session.userId, u.bo.id))).toHaveLength(0);
		const cookies = { set: () => {}, get: () => undefined } as never;
		await expect(auth.createSession(cookies, new URL('http://localhost/'), u.bo.id)).rejects.toMatchObject({ status: 403 });
		await sa.setUserSuspended(admin, u.bo.id, false, 'Utrett med kåren, öppnas igen');
	});

	it('the CLI grants, lists and revokes site admin (and refuses unknown users)', async () => {
		const cli = (...args: string[]) =>
			run('node', ['scripts/site-admin.ts', ...args], { cwd: WEB, env: { ...process.env, DATABASE_URL: URL_, SITE_ADMIN_OPERATOR: 'vitest' } });
		await expect(cli('grant', NOS[2])).rejects.toMatchObject({ code: 2 });
		await expect(cli('grant', '7199999', '--reason', 'Testar okänd användare')).rejects.toMatchObject({ stderr: expect.stringMatching(/must log in/) });
		const g = await cli('grant', NOS[2], '--reason', 'Driftansvarig under test');
		expect(g.stdout).toMatch(/is now a site admin \(cli:vitest\)/);
		expect((await cli('list')).stdout).toMatch(new RegExp(`${NOS[2]}\\tTest cia\\tgranted .* by cli:vitest`));
		const [row] = await db.select().from(schema.siteAdmin).where(eq(schema.siteAdmin.userId, u.cia.id));
		expect(row).toMatchObject({ grantedBy: 'cli:vitest', reason: 'Driftansvarig under test' });
		expect((await cli('revoke', NOS[2], '--reason', 'Slutar som driftansvarig')).stdout).toMatch(/no longer/);
		expect(await db.select().from(schema.siteAdmin).where(eq(schema.siteAdmin.userId, u.cia.id))).toHaveLength(0);
		const logged =
			await sql`select action, actor_kind, actor_user_id, details from audit_log where target_id = ${u.cia.id} and target_type = 'site_admin' order by at`;
		expect(logged.map((r) => [r.action, r.actor_kind, r.actor_user_id, r.details.by])).toEqual([
			['site_admin.grant', 'cli', null, 'cli:vitest'],
			['site_admin.revoke', 'cli', null, 'cli:vitest']
		]);
	}, 30_000);
});

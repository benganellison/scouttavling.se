import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from './db/index.ts';
import { recordChange } from './changes.ts';
import { reasonError, writeAudit, type Actor } from './audit.ts';

/**
 * Owners and organisers of a competition (edition) or a series: the ONE write path.
 *
 * Invariant: a competition and a series always keep at least one owner. Every change runs in one
 * transaction that first locks the competition/series row (`FOR UPDATE`), so concurrent changes are
 * serialised and the owner count is checked against committed data before commit. The last owner can
 * therefore never leave, be demoted or be removed, also not by two requests at the same time
 * (tested in ownership.db.test.ts). A list of operations is applied atomically, so a site admin can
 * replace the last owner in one step: [set new → owner, remove old].
 *
 * Who may do what (checked inside the lock):
 * - owner: everything (add/remove/change owners and organisers, transfer, leave unless last owner)
 * - organiser: add/remove organisers and leave; never touches an owner or grants owner
 * - site admin (from /site-admin, reason required): everything, still ≥ 1 owner
 * - site admin with "Tillfällig åtkomst" inside the admin pages: like its access role (organiser)
 * Every operation writes an audit row in the same transaction.
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type ManagedRole = 'owner' | 'organiser';
export type Scope = { kind: 'competition'; id: string } | { kind: 'series'; id: string };
export type MemberOp = { op: 'set'; userId: string; role: ManagedRole } | { op: 'remove'; userId: string };
export interface OwnershipActor extends Actor {
	/** Role from a site admin's temporary access when acting inside the admin pages. */
	accessRole?: ManagedRole;
}

export class OwnershipError extends Error {
	constructor(
		public code: 'last_owner' | 'forbidden' | 'not_found' | 'no_change' | 'reason',
		message: string
	) {
		super(message);
	}
}

export const ROLE_TEXT: Record<ManagedRole, string> = { owner: 'Ägare', organiser: 'Arrangör' };

const MANAGED: ManagedRole[] = ['owner', 'organiser'];

/** Locks the competition/series row; everything after this sees committed member rows. */
async function lockScope(tx: Tx, scope: Scope) {
	const rows =
		scope.kind === 'competition'
			? await tx.select({ id: schema.competition.id, seriesId: schema.competition.seriesId }).from(schema.competition).where(eq(schema.competition.id, scope.id)).for('update')
			: await tx.select({ id: schema.series.id, seriesId: schema.series.id }).from(schema.series).where(eq(schema.series.id, scope.id)).for('update');
	if (!rows[0]) throw new OwnershipError('not_found', scope.kind === 'competition' ? 'Tävlingen finns inte.' : 'Serien finns inte.');
	return rows[0];
}

/**
 * A series without member rows (created before series_member existed, or by an older app version)
 * starts with its editions' owners and organisers. Idempotent.
 */
export async function ensureSeriesMembers(tx: Tx | typeof db, seriesId: string) {
	const [any] = await tx.select({ u: schema.seriesMember.userId }).from(schema.seriesMember).where(eq(schema.seriesMember.seriesId, seriesId)).limit(1);
	if (any) return;
	await tx.execute(sql`
		insert into series_member (series_id, user_id, role)
		select ${seriesId}::uuid, m.user_id, case when bool_or(m.role = 'owner') then 'owner'::competition_role else 'organiser'::competition_role end
		from competition_member m join competition c on c.id = m.competition_id
		where c.series_id = ${seriesId}::uuid and m.role in ('owner', 'organiser')
		group by m.user_id
		on conflict do nothing`);
}

/** userId → managed role (owner wins over organiser), optionally row-locked. */
async function currentRoles(tx: Tx | typeof db, scope: Scope, lock = false): Promise<Map<string, ManagedRole>> {
	const map = new Map<string, ManagedRole>();
	if (scope.kind === 'competition') {
		const q = tx
			.select({ userId: schema.competitionMember.userId, role: schema.competitionMember.role })
			.from(schema.competitionMember)
			.where(and(eq(schema.competitionMember.competitionId, scope.id), inArray(schema.competitionMember.role, MANAGED)));
		for (const r of await (lock ? q.for('update') : q)) if (r.role === 'owner' || !map.has(r.userId)) map.set(r.userId, r.role as ManagedRole);
	} else {
		const q = tx
			.select({ userId: schema.seriesMember.userId, role: schema.seriesMember.role })
			.from(schema.seriesMember)
			.where(eq(schema.seriesMember.seriesId, scope.id));
		for (const r of await (lock ? q.for('update') : q)) map.set(r.userId, r.role as ManagedRole);
	}
	return map;
}

async function ownerCount(tx: Tx, scope: Scope): Promise<number> {
	const [{ n }] =
		scope.kind === 'competition'
			? await tx
					.select({ n: sql<number>`count(distinct ${schema.competitionMember.userId})::int` })
					.from(schema.competitionMember)
					.where(and(eq(schema.competitionMember.competitionId, scope.id), eq(schema.competitionMember.role, 'owner')))
			: await tx
					.select({ n: sql<number>`count(*)::int` })
					.from(schema.seriesMember)
					.where(and(eq(schema.seriesMember.seriesId, scope.id), eq(schema.seriesMember.role, 'owner')));
	return n;
}

async function writeRole(tx: Tx, scope: Scope, userId: string, role: ManagedRole | null) {
	if (scope.kind === 'competition') {
		await tx
			.delete(schema.competitionMember)
			.where(and(eq(schema.competitionMember.competitionId, scope.id), eq(schema.competitionMember.userId, userId), inArray(schema.competitionMember.role, MANAGED)));
		if (role) await tx.insert(schema.competitionMember).values({ competitionId: scope.id, userId, role });
	} else {
		await tx.delete(schema.seriesMember).where(and(eq(schema.seriesMember.seriesId, scope.id), eq(schema.seriesMember.userId, userId)));
		if (role) await tx.insert(schema.seriesMember).values({ seriesId: scope.id, userId, role });
	}
}

export interface ChangeOptions {
	/** Write ONE audit row with this action instead of one per operation (e.g. owner.transfer). */
	summary?: { action: string; details?: Record<string, unknown> };
	/** Test hook: runs inside the transaction after the checks, before commit. */
	beforeCommit?: () => Promise<void>;
}

/** Applies `ops` atomically. Throws OwnershipError (nothing changed) when not allowed. */
export async function changeMembers(scope: Scope, actor: OwnershipActor, ops: MemberOp[], opts: ChangeOptions = {}): Promise<void> {
	if (!ops.length) throw new OwnershipError('no_change', 'Inget att ändra.');
	if (actor.kind !== 'user' && !actor.accessRole && reasonError(actor.reason)) throw new OwnershipError('reason', reasonError(actor.reason)!);
	await db.transaction(async (tx) => {
		const locked = await lockScope(tx, scope);
		if (scope.kind === 'series') await ensureSeriesMembers(tx, scope.id);
		const before = await currentRoles(tx, scope, true);
		const power: ManagedRole | 'platform' | null = actor.accessRole ?? (actor.kind === 'user' ? (actor.userId ? (before.get(actor.userId) ?? null) : null) : 'platform');
		if (!power) throw new OwnershipError('forbidden', 'Du är inte ägare eller arrangör här.');

		const now = new Map(before);
		const audits: { action: string; userId: string; from: ManagedRole | null; to: ManagedRole | null }[] = [];
		for (const op of ops) {
			const from = now.get(op.userId) ?? null;
			const to = op.op === 'set' ? op.role : null;
			if (from === to) continue;
			const touchesOwner = from === 'owner' || to === 'owner';
			if (touchesOwner && power === 'organiser') throw new OwnershipError('forbidden', 'Bara en ägare kan ändra ägare.');
			if (to) {
				const [u] = await tx.select({ id: schema.appUser.id }).from(schema.appUser).where(eq(schema.appUser.id, op.userId)).limit(1);
				if (!u) throw new OwnershipError('not_found', 'Användaren finns inte.');
			}
			await writeRole(tx, scope, op.userId, to);
			if (to) now.set(op.userId, to);
			else now.delete(op.userId);
			const self = op.userId === actor.userId;
			audits.push({ action: !to ? (self ? 'member.leave' : 'member.remove') : from ? 'member.role' : 'member.add', userId: op.userId, from, to });
		}
		if (!audits.length) throw new OwnershipError('no_change', 'Inget att ändra.');
		// Fresh count from the database (not the in-memory map): the invariant itself.
		if ((await ownerCount(tx, scope)) < 1) {
			throw new OwnershipError('last_owner', `${scope.kind === 'competition' ? 'Tävlingen' : 'Serien'} måste ha minst en ägare. Lägg till en ny ägare först.`);
		}
		const where = scope.kind === 'competition' ? { competitionId: scope.id, seriesId: locked.seriesId } : { competitionId: null, seriesId: scope.id };
		if (opts.summary) {
			await writeAudit(tx, actor, { action: opts.summary.action, targetType: scope.kind, targetId: scope.id, ...where, details: { ...opts.summary.details, changes: audits } });
		} else {
			for (const a of audits) {
				await writeAudit(tx, actor, { action: a.action, targetType: scope.kind, targetId: scope.id, ...where, details: { userId: a.userId, from: a.from, to: a.to } });
			}
		}
		if (scope.kind === 'competition') await recordChange(tx, scope.id, 'competition', scope.id);
		await opts.beforeCommit?.();
	});
}

/** The actor (an owner) hands ownership to `toUserId` and becomes organiser. */
export async function transferOwnership(scope: Scope, actor: OwnershipActor, toUserId: string) {
	if (!actor.userId || actor.userId === toUserId) throw new OwnershipError('no_change', 'Välj någon annan än dig själv.');
	await changeMembers(
		scope,
		actor,
		[
			{ op: 'set', userId: toUserId, role: 'owner' },
			{ op: 'set', userId: actor.userId, role: 'organiser' }
		],
		{ summary: { action: 'owner.transfer', details: { userId: toUserId } } }
	);
}

export interface MemberRow {
	userId: string;
	name: string;
	memberNo: string;
	role: ManagedRole;
	suspended: boolean;
}

/** Owners first, then organisers, by name. */
export async function listMembers(scope: Scope): Promise<MemberRow[]> {
	if (scope.kind === 'series') await ensureSeriesMembers(db, scope.id);
	const roles = await currentRoles(db, scope);
	if (!roles.size) return [];
	const users = await db
		.select({ id: schema.appUser.id, name: schema.appUser.name, memberNo: schema.appUser.memberNo, suspendedAt: schema.appUser.suspendedAt })
		.from(schema.appUser)
		.where(inArray(schema.appUser.id, [...roles.keys()]))
		.orderBy(asc(schema.appUser.name));
	return users
		.map((u) => ({ userId: u.id, name: u.name, memberNo: u.memberNo, role: roles.get(u.id)!, suspended: !!u.suspendedAt }))
		.sort((a, b) => (a.role === b.role ? 0 : a.role === 'owner' ? -1 : 1));
}

/** The user's managed role in a series (after lazy initialisation), or null. */
export async function seriesRole(seriesId: string, userId: string): Promise<ManagedRole | null> {
	await ensureSeriesMembers(db, seriesId);
	const [r] = await db
		.select({ role: schema.seriesMember.role })
		.from(schema.seriesMember)
		.where(and(eq(schema.seriesMember.seriesId, seriesId), eq(schema.seriesMember.userId, userId)))
		.limit(1);
	return (r?.role as ManagedRole) ?? null;
}

/** Looks up a user by member number (they must have logged in once). */
export async function userByMemberNo(memberNo: string) {
	const no = memberNo.replace(/\s+/g, '');
	if (!/^\d{3,12}$/.test(no)) return { error: 'Skriv ett medlemsnummer (bara siffror).' } as const;
	const [u] = await db.select().from(schema.appUser).where(eq(schema.appUser.memberNo, no)).limit(1);
	if (!u) return { error: `Ingen med medlemsnummer ${no} har loggat in här. Personen måste logga in en gång först.` } as const;
	return { user: u } as const;
}

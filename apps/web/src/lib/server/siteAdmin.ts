import { error, type RequestEvent } from '@sveltejs/kit';
import { and, desc, eq, gt, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import { db, schema } from './db/index.ts';
import { recordChange } from './changes.ts';
import { reasonError, writeAudit, type Actor } from './audit.ts';
import { anonymiseCompetition } from './anonymise.ts';
import type { SessionUser } from './auth.ts';

/**
 * Site admin (platform operator), docs/architecture/04-security-and-operations.md §10.
 * - Granted/revoked only from the command line (scripts/site-admin.ts); never from the web.
 * - /site-admin answers 404 to everyone else, so its existence is not revealed.
 * - A site admin does not see a competition's admin pages by default: they take a time-limited,
 *   logged "Tillfällig åtkomst" with a reason, which the owners are shown.
 * - Every action needs a reason (≥ 10 characters) and writes an audit row.
 */

export const ACCESS_HOURS = [1, 2, 4, 8] as const;
export const DEFAULT_ACCESS_HOURS = 2;

/** 404 for anyone but a site admin (also when logged out). */
export function requireSiteAdmin(event: Pick<RequestEvent, 'locals'>): SessionUser {
	const user = event.locals.user;
	if (!user?.siteAdmin) error(404, 'Sidan finns inte');
	return user;
}

export function adminActor(user: SessionUser, reason: string): Actor {
	return { kind: 'site_admin', userId: user.id, reason };
}

export class SiteAdminError extends Error {}

function needReason(reason: string) {
	const e = reasonError(reason);
	if (e) throw new SiteAdminError(e);
}

// ---------- temporary access ----------

export async function grantAccess(admin: SessionUser, competitionId: string, reason: string, hours: number) {
	needReason(reason);
	if (!ACCESS_HOURS.includes(hours as (typeof ACCESS_HOURS)[number])) throw new SiteAdminError('Välj en giltig tid.');
	return db.transaction(async (tx) => {
		const expiresAt = new Date(Date.now() + hours * 3600_000);
		// One active access per admin and competition: a new one replaces the old.
		await tx
			.update(schema.siteAdminAccess)
			.set({ endedAt: new Date() })
			.where(and(eq(schema.siteAdminAccess.userId, admin.id), eq(schema.siteAdminAccess.competitionId, competitionId), isNull(schema.siteAdminAccess.endedAt), gt(schema.siteAdminAccess.expiresAt, new Date())));
		const [row] = await tx.insert(schema.siteAdminAccess).values({ userId: admin.id, competitionId, role: 'organiser', reason: reason.trim(), expiresAt }).returning();
		await writeAudit(tx, adminActor(admin, reason), {
			action: 'access.grant', targetType: 'competition', targetId: competitionId, competitionId,
			details: { accessId: row.id, role: 'organiser', hours, expiresAt: expiresAt.toISOString() }
		});
		return row;
	});
}

export async function endAccess(admin: SessionUser, accessId: string) {
	await db.transaction(async (tx) => {
		const [row] = await tx
			.update(schema.siteAdminAccess)
			.set({ endedAt: new Date() })
			.where(and(eq(schema.siteAdminAccess.id, accessId), eq(schema.siteAdminAccess.userId, admin.id), isNull(schema.siteAdminAccess.endedAt)))
			.returning();
		if (!row) return;
		await writeAudit(tx, { kind: 'site_admin', userId: admin.id, reason: row.reason }, {
			action: 'access.end', targetType: 'competition', targetId: row.competitionId, competitionId: row.competitionId, details: { accessId: row.id }
		});
	});
}

export interface AccessNotice {
	id: string;
	adminName: string;
	reason: string;
	grantedAt: Date;
	/** When it ended or will end. */
	until: Date;
	active: boolean;
}

/** Temporary accesses to a competition in the last `days` days (newest first), for the owners' notice. */
export async function accessNotices(competitionId: string, days = 30): Promise<AccessNotice[]> {
	const rows = await db
		.select({ a: schema.siteAdminAccess, name: schema.appUser.name })
		.from(schema.siteAdminAccess)
		.innerJoin(schema.appUser, eq(schema.appUser.id, schema.siteAdminAccess.userId))
		.where(and(eq(schema.siteAdminAccess.competitionId, competitionId), gt(schema.siteAdminAccess.grantedAt, new Date(Date.now() - days * 86400_000))))
		.orderBy(desc(schema.siteAdminAccess.grantedAt))
		.limit(10);
	const now = Date.now();
	return rows.map(({ a, name }) => {
		const until = a.endedAt && a.endedAt < a.expiresAt ? a.endedAt : a.expiresAt;
		return { id: a.id, adminName: name, reason: a.reason, grantedAt: a.grantedAt, until, active: until.getTime() > now };
	});
}

// ---------- suspension ----------

export async function setCompetitionSuspended(admin: SessionUser, competitionId: string, suspended: boolean, reason: string) {
	needReason(reason);
	await db.transaction(async (tx) => {
		const [c] = await tx.select().from(schema.competition).where(eq(schema.competition.id, competitionId)).for('update');
		if (!c) throw new SiteAdminError('Tävlingen finns inte.');
		if (!!c.suspendedAt === suspended) throw new SiteAdminError(suspended ? 'Tävlingen är redan avstängd.' : 'Tävlingen är inte avstängd.');
		await tx.update(schema.competition).set({ suspendedAt: suspended ? new Date() : null }).where(eq(schema.competition.id, competitionId));
		await writeAudit(tx, adminActor(admin, reason), {
			action: suspended ? 'competition.suspend' : 'competition.unsuspend', targetType: 'competition', targetId: competitionId, competitionId, seriesId: c.seriesId
		});
		await recordChange(tx, competitionId, 'competition', competitionId);
	});
}

export async function setUserSuspended(admin: SessionUser, userId: string, suspended: boolean, reason: string) {
	needReason(reason);
	if (userId === admin.id) throw new SiteAdminError('Du kan inte stänga av dig själv.');
	await db.transaction(async (tx) => {
		const [u] = await tx.select().from(schema.appUser).where(eq(schema.appUser.id, userId)).for('update');
		if (!u) throw new SiteAdminError('Användaren finns inte.');
		if (!!u.suspendedAt === suspended) throw new SiteAdminError(suspended ? 'Användaren är redan avstängd.' : 'Användaren är inte avstängd.');
		await tx.update(schema.appUser).set({ suspendedAt: suspended ? new Date() : null }).where(eq(schema.appUser.id, userId));
		// Revoke every session at once (readSession also refuses suspended users).
		if (suspended) await tx.delete(schema.session).where(eq(schema.session.userId, userId));
		await writeAudit(tx, adminActor(admin, reason), { action: suspended ? 'user.suspend' : 'user.unsuspend', targetType: 'user', targetId: userId });
	});
}

// ---------- personal data ----------

/** "Ta bort personuppgifter" on behalf of the owners (e.g. a GDPR request forwarded by the district). */
export async function anonymiseOnBehalf(admin: SessionUser, competitionId: string, reason: string) {
	needReason(reason);
	return anonymiseCompetition(competitionId, adminActor(admin, reason));
}

// ---------- search ----------

export interface CompetitionHit {
	id: string;
	slug: string;
	name: string;
	status: string;
	startDate: string;
	seriesName: string | null;
	suspended: boolean;
	anonymised: boolean;
	patrols: number;
	lastActivity: Date | null;
	owners: string[];
	organisers: string[];
}

function like(q: string) {
	return `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
}

/** Competitions with their people and activity, for the search list and the detail page. */
export async function competitionHits(where: ReturnType<typeof and> | undefined, limit = 30): Promise<CompetitionHit[]> {
	const comps = await db
		.select({ c: schema.competition, seriesName: schema.series.name })
		.from(schema.competition)
		.leftJoin(schema.series, eq(schema.series.id, schema.competition.seriesId))
		.where(where)
		.orderBy(desc(schema.competition.startDate))
		.limit(limit);
	const ids = comps.map((r) => r.c.id);
	if (!ids.length) return [];
	const [members, patrols, activity] = await Promise.all([
		db
			.select({ cid: schema.competitionMember.competitionId, role: schema.competitionMember.role, name: schema.appUser.name })
			.from(schema.competitionMember)
			.innerJoin(schema.appUser, eq(schema.appUser.id, schema.competitionMember.userId))
			.where(and(inArray(schema.competitionMember.competitionId, ids), inArray(schema.competitionMember.role, ['owner', 'organiser'])))
			.orderBy(schema.appUser.name),
		db
			.select({ cid: schema.patrol.competitionId, n: sql<number>`count(*)::int` })
			.from(schema.patrol)
			.where(inArray(schema.patrol.competitionId, ids))
			.groupBy(schema.patrol.competitionId),
		db
			.select({ cid: schema.changeLog.competitionId, at: sql<string>`max(${schema.changeLog.at})` })
			.from(schema.changeLog)
			.where(inArray(schema.changeLog.competitionId, ids))
			.groupBy(schema.changeLog.competitionId)
	]);
	const pc = new Map(patrols.map((p) => [p.cid, p.n]));
	const act = new Map(activity.map((a) => [a.cid, a.at ? new Date(a.at) : null]));
	return comps.map(({ c, seriesName }) => ({
		id: c.id, slug: c.slug, name: c.name, status: c.status, startDate: c.startDate, seriesName,
		suspended: !!c.suspendedAt, anonymised: !!c.anonymisedAt, patrols: pc.get(c.id) ?? 0,
		lastActivity: act.get(c.id) ?? null,
		owners: members.filter((m) => m.cid === c.id && m.role === 'owner').map((m) => m.name),
		organisers: [...new Set(members.filter((m) => m.cid === c.id && m.role === 'organiser').map((m) => m.name))]
	}));
}

export async function search(qRaw: string) {
	const q = qRaw.trim().slice(0, 80);
	if (!q) {
		// Nothing typed: the most recent competitions, so the page is never empty.
		return { competitions: await competitionHits(undefined, 15), series: [], users: [] };
	}
	const p = like(q);
	const competitions = await competitionHits(or(ilike(schema.competition.name, p), ilike(schema.competition.slug, p)));
	const series = await db
		.select({ id: schema.series.id, slug: schema.series.slug, name: schema.series.name, editions: sql<number>`(select count(*)::int from competition c where c.series_id = ${schema.series.id})` })
		.from(schema.series)
		.where(or(ilike(schema.series.name, p), ilike(schema.series.slug, p)))
		.orderBy(schema.series.name)
		.limit(20);
	const users = await db
		.select({
			id: schema.appUser.id, name: schema.appUser.name, memberNo: schema.appUser.memberNo, suspended: sql<boolean>`${schema.appUser.suspendedAt} is not null`,
			siteAdmin: sql<boolean>`exists (select 1 from site_admin a where a.user_id = ${schema.appUser.id})`,
			competitions: sql<number>`(select count(distinct m.competition_id)::int from competition_member m where m.user_id = ${schema.appUser.id})`,
			lastLogin: schema.appUser.lastLoginAt
		})
		.from(schema.appUser)
		.where(or(ilike(schema.appUser.name, p), ilike(schema.appUser.memberNo, p)))
		.orderBy(schema.appUser.name)
		.limit(20);
	return { competitions, series, users };
}

/** Days after the last competition day before an edition that still holds personal data is listed. */
export const PERSONAL_DATA_FOLLOW_UP_DAYS = 30;

/**
 * Editions that ended more than PERSONAL_DATA_FOLLOW_UP_DAYS ago and still hold personal data
 * (members, patrol contacts or patrol links), oldest first. Removal stays manual and owner-only
 * (docs/architecture/05 §4); this list is for the operator to follow up. One query.
 */
export async function personalDataOverdue() {
	const rows = await db.execute(sql`
		select c.slug, c.name, c.status, c.end_date as "endDate",
			(select count(*)::int from patrol p where p.competition_id = c.id and (
				p.contact_name is not null or p.contact_phone is not null or p.contact_email is not null or p.contact_member_no is not null
				or p.manage_token_hash is not null or p.follow_token_hash is not null
				or exists (select 1 from member m where m.patrol_id = p.id))) as patrols,
			(select string_agg(u.name, ', ' order by u.name) from competition_member cm join app_user u on u.id = cm.user_id
				where cm.competition_id = c.id and cm.role = 'owner') as owners
		from competition c
		where c.anonymised_at is null and c.end_date < (now() at time zone 'Europe/Stockholm')::date - ${PERSONAL_DATA_FOLLOW_UP_DAYS}::int
		order by c.end_date asc
	`);
	return (rows as unknown as { slug: string; name: string; status: string; endDate: string; patrols: number; owners: string | null }[]).filter((r) => r.patrols > 0);
}

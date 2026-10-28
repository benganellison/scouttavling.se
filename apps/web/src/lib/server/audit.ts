import { and, desc, eq, gte, inArray, lt, or, sql, type SQL } from 'drizzle-orm';
import { db, schema, type Tx } from './db/index.ts';

/**
 * The append-only audit log (docs/architecture/04-security-and-operations.md §10). The only write
 * path is `writeAudit`; a DB trigger refuses UPDATE/DELETE. Rows hold ids only: names are looked up
 * when the log is read, so removing a user's or a competition's personal data never needs to touch it.
 * The `reason` text is free text from an organiser or site admin and must never name patrol members.
 */

export type AuditActorKind = (typeof schema.auditLog.$inferInsert)['actorKind'];
export type AuditTargetType = (typeof schema.auditLog.$inferInsert)['targetType'];

export interface Actor {
	kind: AuditActorKind;
	/** null for the command line. */
	userId: string | null;
	/** Required (≥ 10 characters) for every site-admin action. */
	reason?: string | null;
	/** "cli:<os user>" etc. Stored in details. */
	label?: string;
}

export interface AuditEntry {
	action: string;
	targetType: AuditTargetType;
	targetId?: string | null;
	competitionId?: string | null;
	seriesId?: string | null;
	details?: Record<string, unknown>;
}

/** Action → Swedish label for the lists. */
export const AUDIT_ACTIONS: Record<string, string> = {
	'member.add': 'Lade till',
	'member.role': 'Ändrade roll',
	'member.remove': 'Tog bort',
	'member.leave': 'Lämnade',
	'owner.transfer': 'Överlät ägarskapet',
	'owner.replace': 'Ersatte ägaren',
	'competition.suspend': 'Stängde av tävlingen',
	'competition.unsuspend': 'Öppnade tävlingen igen',
	'competition.anonymise': 'Tog bort personuppgifter',
	'competition.export_personal_data': 'Exporterade personuppgifter',
	'competition.import_gokapp': 'Importerade år från gokapp',
	'user.suspend': 'Stängde av användaren',
	'user.unsuspend': 'Öppnade användaren igen',
	'access.grant': 'Tog tillfällig åtkomst',
	'access.end': 'Avslutade tillfällig åtkomst',
	'site_admin.grant': 'Gav plattformsadmin',
	'site_admin.revoke': 'Tog bort plattformsadmin'
};

export const MIN_REASON = 10;

/** A site-admin reason: trimmed, 10–500 characters. Returns an error text or null. */
export function reasonError(reason: string | null | undefined): string | null {
	const r = (reason ?? '').trim();
	if (r.length < MIN_REASON) return `Skriv en anledning (minst ${MIN_REASON} tecken).`;
	if (r.length > 500) return 'Anledningen får vara högst 500 tecken.';
	return null;
}

export async function writeAudit(tx: Tx | typeof db, actor: Actor, e: AuditEntry) {
	await tx.insert(schema.auditLog).values({
		actorUserId: actor.userId,
		actorKind: actor.kind,
		action: e.action,
		targetType: e.targetType,
		targetId: e.targetId ?? null,
		competitionId: e.competitionId ?? null,
		seriesId: e.seriesId ?? null,
		reason: actor.reason?.trim() || null,
		details: { ...(actor.label ? { by: actor.label } : {}), ...(e.details ?? {}) }
	});
}

export interface AuditFilter {
	competitionId?: string;
	seriesId?: string;
	/** Rows about a competition or the series it belongs to. */
	competitionOrSeries?: { competitionId: string; seriesId: string | null };
	actorUserId?: string;
	action?: string;
	/** Site-admin/cli rows only. */
	siteAdminOnly?: boolean;
	from?: Date;
	to?: Date;
	limit?: number;
}

export interface AuditRow {
	id: string;
	at: Date;
	actorKind: AuditActorKind;
	actorName: string;
	action: string;
	actionText: string;
	targetType: AuditTargetType;
	targetName: string | null;
	competition: { slug: string; name: string } | null;
	series: { slug: string; name: string } | null;
	reason: string | null;
	details: Record<string, unknown>;
	/** details.userId / role, resolved to a name. */
	subjectName: string | null;
	/** details.replaced (the previous owner in owner.replace), resolved to a name. */
	replacedName: string | null;
}

/** Reads the log, newest first, with names resolved now (never stored). */
export async function listAudit(f: AuditFilter = {}): Promise<AuditRow[]> {
	const where: SQL[] = [];
	const a = schema.auditLog;
	if (f.competitionId) where.push(eq(a.competitionId, f.competitionId));
	if (f.seriesId) where.push(eq(a.seriesId, f.seriesId));
	if (f.competitionOrSeries) {
		const c = f.competitionOrSeries;
		where.push(c.seriesId ? or(eq(a.competitionId, c.competitionId), and(eq(a.seriesId, c.seriesId), sql`${a.competitionId} is null`))! : eq(a.competitionId, c.competitionId));
	}
	if (f.actorUserId) where.push(eq(a.actorUserId, f.actorUserId));
	if (f.action) where.push(f.action.endsWith('.') ? sql`${a.action} like ${f.action + '%'}` : eq(a.action, f.action));
	if (f.siteAdminOnly) where.push(inArray(a.actorKind, ['site_admin', 'cli']));
	if (f.from) where.push(gte(a.at, f.from));
	if (f.to) where.push(lt(a.at, f.to));
	const rows = await db
		.select()
		.from(a)
		.where(where.length ? and(...where) : undefined)
		.orderBy(desc(a.at))
		.limit(Math.min(f.limit ?? 200, 1000));

	const userIds = new Set<string>();
	const compIds = new Set<string>();
	const seriesIds = new Set<string>();
	for (const r of rows) {
		if (r.actorUserId) userIds.add(r.actorUserId);
		if ((r.targetType === 'user' || r.targetType === 'site_admin') && r.targetId) userIds.add(r.targetId);
		for (const k of ['userId', 'replaced']) if (typeof r.details?.[k] === 'string') userIds.add(r.details[k] as string);
		if (r.competitionId) compIds.add(r.competitionId);
		if (r.seriesId) seriesIds.add(r.seriesId);
	}
	const [users, comps, sers] = await Promise.all([
		userIds.size ? db.select({ id: schema.appUser.id, name: schema.appUser.name }).from(schema.appUser).where(inArray(schema.appUser.id, [...userIds])) : [],
		compIds.size ? db.select({ id: schema.competition.id, slug: schema.competition.slug, name: schema.competition.name }).from(schema.competition).where(inArray(schema.competition.id, [...compIds])) : [],
		seriesIds.size ? db.select({ id: schema.series.id, slug: schema.series.slug, name: schema.series.name }).from(schema.series).where(inArray(schema.series.id, [...seriesIds])) : []
	]);
	const uName = new Map(users.map((u) => [u.id, u.name]));
	const cMap = new Map(comps.map((c) => [c.id, c]));
	const sMap = new Map(sers.map((s) => [s.id, s]));
	const gone = 'Borttagen användare';
	return rows.map((r) => {
		const comp = r.competitionId ? cMap.get(r.competitionId) : undefined;
		const ser = r.seriesId ? sMap.get(r.seriesId) : undefined;
		const sub = typeof r.details?.userId === 'string' ? (uName.get(r.details.userId as string) ?? gone) : null;
		const actorName =
			r.actorKind === 'cli' ? `Kommandoraden${typeof r.details?.by === 'string' ? ` (${r.details.by})` : ''}` : r.actorUserId ? (uName.get(r.actorUserId) ?? gone) : '–';
		const targetName =
			r.targetType === 'user' || r.targetType === 'site_admin'
				? r.targetId ? (uName.get(r.targetId) ?? gone) : null
				: r.targetType === 'competition'
					? (comp?.name ?? (r.competitionId ? 'Borttagen tävling' : null))
					: (ser?.name ?? (r.seriesId ? 'Borttagen serie' : null));
		return {
			id: r.id,
			at: r.at,
			actorKind: r.actorKind,
			actorName,
			action: r.action,
			actionText: AUDIT_ACTIONS[r.action] ?? r.action,
			targetType: r.targetType,
			targetName,
			competition: comp ? { slug: comp.slug, name: comp.name } : null,
			series: ser ? { slug: ser.slug, name: ser.name } : null,
			reason: r.reason,
			details: r.details ?? {},
			subjectName: sub,
			replacedName: typeof r.details?.replaced === 'string' ? (uName.get(r.details.replaced as string) ?? gone) : null
		};
	});
}

/**
 * Public registration, manage links (/m/<token>) and follow links (/folj/<token>).
 *
 * Tokens are 128-bit random base64url. Only SHA-256 hashes are stored; the
 * follow token is additionally stored AES-GCM encrypted so the manage page can
 * show the follow link again (same scheme as invite.secret_enc, own key context).
 */
import { and, asc, eq, max, ne, sql } from 'drizzle-orm';
import QRCode from 'qrcode';
import { ORIGIN } from '$app/env/private';
import { dev } from '$app/env';
import { db, schema } from './db/index.ts';
import { randomToken, sha256 } from './auth.ts';
import { recordChange } from './changes.ts';
import { RateLimiter } from './rateLimit.ts';
import { registrationWindow, type ManageData, type RegistrationData } from '#lib/registration/rules.ts';
import { todayIso } from '#lib/ui/admin/format.ts';
import { trackColors } from '#lib/brand/colors.ts';

type CompRow = typeof schema.competition.$inferSelect;
export type PatrolRow = typeof schema.patrol.$inferSelect;

const FOLLOW_KEY_CONTEXT = 'scouttavling.follow-token.v1';
const TOKEN_RE = /^[A-Za-z0-9_-]{22}$/;

/** 10 registrations per IP and hour (generous in dev so e2e reruns don't lock you out). */
export const registerLimiter = new RateLimiter(dev ? 200 : 10, 3600_000);
/** Unknown-token lookups per IP (enumeration guard). */
export const missLimiter = new RateLimiter(30, 600_000);

export function publicOrigin(url: URL): string {
	return (ORIGIN || url.origin).replace(/\/$/, '');
}

export async function qrSvg(text: string): Promise<string> {
	return QRCode.toString(text, { type: 'svg', errorCorrectionLevel: 'M', margin: 1, color: { dark: '#000000', light: '#ffffff' } });
}

// ---------- crypto ----------

async function key(patrolCodeKey: string, usage: KeyUsage[]) {
	const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${patrolCodeKey}|${FOLLOW_KEY_CONTEXT}`));
	return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, usage);
}

export async function encryptToken(patrolCodeKey: string, token: string): Promise<string> {
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(patrolCodeKey, ['encrypt']), new TextEncoder().encode(token)));
	const out = new Uint8Array(iv.length + ct.length);
	out.set(iv);
	out.set(ct, iv.length);
	return Buffer.from(out).toString('base64url');
}

export async function decryptToken(patrolCodeKey: string, enc: string | null): Promise<string | null> {
	if (!enc) return null;
	try {
		const buf = new Uint8Array(Buffer.from(enc, 'base64url'));
		const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf.slice(0, 12) }, await key(patrolCodeKey, ['decrypt']), buf.slice(12));
		return new TextDecoder().decode(pt);
	} catch {
		return null;
	}
}

// ---------- competition ----------

export async function competitionBySlug(slug: string): Promise<CompRow | null> {
	const [c] = await db.select().from(schema.competition).where(eq(schema.competition.slug, slug)).limit(1);
	return c ?? null;
}

export async function isMember(competitionId: string, userId: string | undefined): Promise<boolean> {
	if (!userId) return false;
	const rows = await db
		.select({ role: schema.competitionMember.role })
		.from(schema.competitionMember)
		.where(and(eq(schema.competitionMember.competitionId, competitionId), eq(schema.competitionMember.userId, userId)))
		.limit(1);
	return rows.length > 0;
}

type Q = Pick<typeof db, 'select'>;

/** Patrols that take a spot (everything except resigned). */
export async function spotCount(competitionId: string, q: Q = db): Promise<number> {
	const [r] = await q
		.select({ n: sql<number>`count(*)::int` })
		.from(schema.patrol)
		.where(and(eq(schema.patrol.competitionId, competitionId), ne(schema.patrol.status, 'resigned')));
	return r?.n ?? 0;
}

export function windowFor(comp: CompRow, patrolCount: number, now = new Date()) {
	const today = todayIso(now);
	return {
		today,
		...registrationWindow({
			status: comp.status, registrationOpen: comp.registrationOpen, registrationOpensOn: comp.registrationOpensOn,
			registrationClosesOn: comp.registrationClosesOn, endDate: comp.endDate, maxPatrols: comp.maxPatrols, patrolCount, today
		})
	};
}

export async function tracksWithCounts(competitionId: string) {
	const [tracks, counts] = await Promise.all([
		db.select({ id: schema.track.id, name: schema.track.name, color: schema.track.color }).from(schema.track).where(eq(schema.track.competitionId, competitionId)).orderBy(asc(schema.track.sort)),
		db
			.select({ trackId: schema.patrol.trackId, n: sql<number>`count(*)::int` })
			.from(schema.patrol)
			.where(and(eq(schema.patrol.competitionId, competitionId), ne(schema.patrol.status, 'resigned')))
			.groupBy(schema.patrol.trackId)
	]);
	const by = new Map(counts.map((c) => [c.trackId, c.n]));
	const colors = trackColors(tracks);
	return tracks.map((t) => ({ ...t, color: colors[t.id], patrols: by.get(t.id) ?? 0 }));
}

// ---------- registration ----------

export type RegisterResult =
	| { ok: true; number: number; manageToken: string; followToken: string }
	| { ok: false; reason: 'closed' | 'full' };

/**
 * Creates the patrol in one transaction. The competition row is locked, so the
 * window/max check and the next number are race-free.
 */
export async function registerPatrol(compId: string, data: RegistrationData): Promise<RegisterResult> {
	const manageToken = randomToken(16);
	const followToken = randomToken(16);
	return db.transaction(async (tx) => {
		const [comp] = await tx.select().from(schema.competition).where(eq(schema.competition.id, compId)).for('update');
		const w = windowFor(comp, await spotCount(comp.id, tx));
		if (w.state === 'full') return { ok: false, reason: 'full' } as const;
		if (w.state !== 'open') return { ok: false, reason: 'closed' } as const;
		const [{ n }] = await tx.select({ n: max(schema.patrol.number) }).from(schema.patrol).where(eq(schema.patrol.competitionId, comp.id));
		const number = n ? n + 1 : 101;
		const [p] = await tx
			.insert(schema.patrol)
			.values({
				competitionId: comp.id, number, name: data.patrolName, troop: data.troop, trackId: data.trackId, status: 'registered',
				contactName: data.contactName, contactPhone: data.contactPhone, contactEmail: data.contactEmail,
				manageTokenHash: await sha256(manageToken), followTokenHash: await sha256(followToken),
				followTokenEnc: await encryptToken(comp.patrolCodeKey, followToken)
			})
			.returning({ id: schema.patrol.id });
		await tx.insert(schema.member).values(data.members.map((m) => ({ patrolId: p.id, firstName: m.firstName, lastName: m.lastName })));
		await recordChange(tx, comp.id, 'patrol', p.id);
		return { ok: true, number, manageToken, followToken } as const;
	});
}

// ---------- token lookups ----------

async function byHash(column: 'manageTokenHash' | 'followTokenHash', token: string) {
	if (!TOKEN_RE.test(token)) return null;
	const [row] = await db
		.select({ patrol: schema.patrol, comp: schema.competition })
		.from(schema.patrol)
		.innerJoin(schema.competition, eq(schema.competition.id, schema.patrol.competitionId))
		.where(eq(schema.patrol[column], await sha256(token)))
		.limit(1);
	return row ?? null;
}

export const patrolByManageToken = (token: string) => byHash('manageTokenHash', token);
export const patrolByFollowToken = (token: string) => byHash('followTokenHash', token);

export async function updateRegistration(compId: string, patrolId: string, data: ManageData) {
	await db.transaction(async (tx) => {
		await tx
			.update(schema.patrol)
			.set({ contactName: data.contactName, contactPhone: data.contactPhone, contactEmail: data.contactEmail })
			.where(eq(schema.patrol.id, patrolId));
		await tx.delete(schema.member).where(eq(schema.member.patrolId, patrolId));
		await tx.insert(schema.member).values(data.members.map((m) => ({ patrolId, firstName: m.firstName, lastName: m.lastName })));
		await recordChange(tx, compId, 'patrol', patrolId);
	});
}

export const NO_STORE = { 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex, nofollow' };

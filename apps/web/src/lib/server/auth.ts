import { error, redirect, type Cookies, type RequestEvent } from '@sveltejs/kit';
import { and, eq, gt } from 'drizzle-orm';
import { db, schema } from './db';

/**
 * Organiser sessions (BFF pattern, contract C5): the browser only ever holds an
 * opaque httpOnly cookie. ScoutID tokens never reach the client.
 * Cookie is `__Host-sid` on https; plain `sid` on http://localhost in dev.
 */
const SESSION_DAYS = 14;

/** Only same-origin paths: rejects "//host", "/\host" and absolute URLs (open-redirect guard). */
export function safeNext(next: string | null | undefined, fallback = '/admin'): string {
	if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return fallback;
	return next;
}

export function cookieName(url: URL) {
	return url.protocol === 'https:' ? '__Host-sid' : 'sid';
}

export async function sha256(text: string): Promise<string> {
	const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
	return Buffer.from(buf).toString('base64url');
}

export function randomToken(bytes = 32): string {
	return Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString('base64url');
}

export interface SessionUser {
	id: string;
	memberNo: string;
	name: string;
	groups: { groupNo: string; name: string }[];
	csrf: string;
}

export async function createSession(cookies: Cookies, url: URL, userId: string) {
	const token = randomToken();
	await db.insert(schema.session).values({
		idHash: await sha256(token),
		userId,
		csrf: randomToken(18),
		expiresAt: new Date(Date.now() + SESSION_DAYS * 86400_000)
	});
	cookies.set(cookieName(url), token, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: url.protocol === 'https:',
		maxAge: SESSION_DAYS * 86400
	});
}

export async function readSession(cookies: Cookies, url: URL): Promise<SessionUser | null> {
	const token = cookies.get(cookieName(url));
	if (!token) return null;
	const rows = await db
		.select({ s: schema.session, u: schema.appUser })
		.from(schema.session)
		.innerJoin(schema.appUser, eq(schema.appUser.id, schema.session.userId))
		.where(and(eq(schema.session.idHash, await sha256(token)), gt(schema.session.expiresAt, new Date())))
		.limit(1);
	const row = rows[0];
	if (!row) return null;
	return { id: row.u.id, memberNo: row.u.memberNo, name: row.u.name, groups: row.u.groups, csrf: row.s.csrf };
}

export async function destroySession(cookies: Cookies, url: URL) {
	const token = cookies.get(cookieName(url));
	if (token) await db.delete(schema.session).where(eq(schema.session.idHash, await sha256(token)));
	cookies.delete(cookieName(url), { path: '/' });
}

/** Upsert a user from ScoutID claims (or the dev login), keyed on member number. */
export async function upsertUser(u: { memberNo: string; name: string; email?: string | null; phone?: string | null; groups: { groupNo: string; name: string }[] }) {
	const [row] = await db
		.insert(schema.appUser)
		.values({ memberNo: u.memberNo, name: u.name, email: u.email ?? null, phone: u.phone ?? null, groups: u.groups })
		.onConflictDoUpdate({ target: schema.appUser.memberNo, set: { name: u.name, email: u.email ?? null, groups: u.groups } })
		.returning();
	return row;
}

/** Use in +page.server.ts / +server.ts for organiser-only routes. */
export function requireUser(event: RequestEvent): SessionUser {
	const user = event.locals.user;
	if (!user) redirect(303, `/login?next=${encodeURIComponent(event.url.pathname)}`);
	return user;
}

export type CompetitionRole = (typeof schema.competitionRole.enumValues)[number];

/** Loads a competition by slug and checks the user holds one of `roles` in it. */
export async function requireCompetition(event: RequestEvent, slug: string, roles: CompetitionRole[] = ['owner', 'organiser', 'hq']) {
	const user = requireUser(event);
	const [comp] = await db.select().from(schema.competition).where(eq(schema.competition.slug, slug)).limit(1);
	if (!comp) error(404, 'Tävlingen finns inte');
	const memberships = await db
		.select({ role: schema.competitionMember.role })
		.from(schema.competitionMember)
		.where(and(eq(schema.competitionMember.competitionId, comp.id), eq(schema.competitionMember.userId, user.id)));
	const mine = memberships.map((m) => m.role);
	if (!mine.some((r) => roles.includes(r))) error(403, 'Du har inte behörighet till den här tävlingen');
	// An archived (anonymised) edition is read-only: no write of any kind goes through.
	// Exception: the next-edition form only *reads* this edition to create a new one, and its
	// POST re-runs the [slug] layout load (e.g. after a validation error).
	const createsNextEdition = event.route.id === '/admin/[slug]/next-edition';
	if (comp.anonymisedAt && !createsNextEdition && event.request.method !== 'GET' && event.request.method !== 'HEAD') {
		error(409, 'Tävlingen är arkiverad och kan inte ändras');
	}
	return { user, comp, roles: mine };
}

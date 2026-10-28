import { error, fail } from '@sveltejs/kit';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { db, schema } from '#lib/server/db/index.ts';
import { listAudit } from '#lib/server/audit.ts';
import { SiteAdminError, requireSiteAdmin, setUserSuspended } from '#lib/server/siteAdmin.ts';

async function user(memberNo: string) {
	const [u] = await db.select().from(schema.appUser).where(eq(schema.appUser.memberNo, memberNo)).limit(1);
	if (!u) error(404, 'Användaren finns inte');
	return u;
}

export async function load(event) {
	requireSiteAdmin(event);
	const u = await user(event.params.memberNo);
	const [comps, admin, lastLogin, audit] = await Promise.all([
		db
			.select({ slug: schema.competition.slug, name: schema.competition.name, role: schema.competitionMember.role })
			.from(schema.competitionMember)
			.innerJoin(schema.competition, eq(schema.competition.id, schema.competitionMember.competitionId))
			.where(and(eq(schema.competitionMember.userId, u.id), inArray(schema.competitionMember.role, ['owner', 'organiser', 'hq', 'startfinish'])))
			.orderBy(desc(schema.competition.startDate)),
		db.select().from(schema.siteAdmin).where(eq(schema.siteAdmin.userId, u.id)).then((r) => r[0] ?? null),
		Promise.resolve(u.lastLoginAt),
		listAudit({ actorUserId: u.id, limit: 50 })
	]);
	return {
		person: { id: u.id, name: u.name, memberNo: u.memberNo, email: u.email, suspendedAt: u.suspendedAt, createdAt: u.createdAt, lastLogin, groups: u.groups },
		comps, isSiteAdmin: !!admin, audit
	};
}

export const actions = {
	suspend: async (event) => {
		const admin = requireSiteAdmin(event);
		const u = await user(event.params.memberNo);
		const f = await event.request.formData();
		const on = f.get('suspend') === '1';
		try {
			await setUserSuspended(admin, u.id, on, String(f.get('reason') ?? ''));
		} catch (e) {
			if (e instanceof SiteAdminError) return fail(400, { error: e.message });
			throw e;
		}
		return { ok: true, message: on ? `${u.name} är avstängd och utloggad.` : `${u.name} kan logga in igen.` };
	}
};

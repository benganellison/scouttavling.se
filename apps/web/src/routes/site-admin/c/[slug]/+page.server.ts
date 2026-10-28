import { error, fail, type RequestEvent } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db, schema } from '#lib/server/db/index.ts';
import { activeAccess } from '#lib/server/auth.ts';
import { listAudit, reasonError } from '#lib/server/audit.ts';
import { listMembers } from '#lib/server/ownership.ts';
import { memberAction, replaceOwner, type MemberAction } from '#lib/server/memberActions.ts';
import { personalDataLeft } from '#lib/server/anonymise.ts';
import {
	ACCESS_HOURS,
	DEFAULT_ACCESS_HOURS,
	SiteAdminError,
	accessNotices,
	adminActor,
	anonymiseOnBehalf,
	competitionHits,
	endAccess,
	grantAccess,
	requireSiteAdmin,
	setCompetitionSuspended
} from '#lib/server/siteAdmin.ts';

/** A competition as the site admin sees it: people, status, suspension, temporary access, personal data, log. */
async function comp(slug: string) {
	const [c] = await db.select().from(schema.competition).where(eq(schema.competition.slug, slug)).limit(1);
	if (!c) error(404, 'Tävlingen finns inte');
	return c;
}

export async function load(event) {
	const admin = requireSiteAdmin(event);
	const c = await comp(event.params.slug);
	const [hit] = await competitionHits(eq(schema.competition.id, c.id), 1);
	const [members, access, notices, audit, left, series] = await Promise.all([
		listMembers({ kind: 'competition', id: c.id }),
		activeAccess(admin.id, c.id),
		accessNotices(c.id, 30),
		listAudit({ competitionId: c.id, limit: 100 }),
		personalDataLeft(c.id),
		c.seriesId
			? db
					.select({ slug: schema.series.slug, name: schema.series.name })
					.from(schema.series)
					.where(eq(schema.series.id, c.seriesId))
					.then((r) => r[0] ?? null)
			: null
	]);
	return {
		comp: { ...hit, ownerGroupName: c.ownerGroupName, endDate: c.endDate, suspendedAt: c.suspendedAt, anonymisedAt: c.anonymisedAt },
		series,
		members,
		access,
		notices,
		audit,
		personalDataLeft: left,
		hours: ACCESS_HOURS,
		defaultHours: DEFAULT_ACCESS_HOURS
	};
}

async function members(event: RequestEvent<{ slug: string }>, kind: MemberAction) {
	const admin = requireSiteAdmin(event);
	const c = await comp(event.params.slug);
	const list = await listMembers({ kind: 'competition', id: c.id });
	return memberAction(
		kind,
		await event.request.formData(),
		{ kind: 'competition', id: c.id },
		adminActor(admin, ''),
		new Map(list.map((m) => [m.userId, m.name]))
	);
}

/** Runs a site-admin step and maps its errors to a form failure for `section`. */
async function step(section: string, fn: () => Promise<unknown>, message: string) {
	try {
		await fn();
	} catch (e) {
		if (e instanceof SiteAdminError || (e instanceof Error && /avslutad|finns inte/.test(e.message))) return fail(400, { section, error: e.message });
		throw e;
	}
	return { section, ok: true, message };
}

export const actions = {
	memberAdd: (event) => members(event, 'add'),
	memberRole: (event) => members(event, 'role'),
	memberRemove: (event) => members(event, 'remove'),
	ownerReplace: async (event) => {
		const admin = requireSiteAdmin(event);
		const c = await comp(event.params.slug);
		return replaceOwner(await event.request.formData(), { kind: 'competition', id: c.id }, adminActor(admin, ''));
	},
	suspend: async (event) => {
		const admin = requireSiteAdmin(event);
		const c = await comp(event.params.slug);
		const f = await event.request.formData();
		const on = f.get('suspend') === '1';
		return step(
			'suspend',
			() => setCompetitionSuspended(admin, c.id, on, String(f.get('reason') ?? '')),
			on ? 'Tävlingen är avstängd.' : 'Tävlingen är öppen igen.'
		);
	},
	access: async (event) => {
		const admin = requireSiteAdmin(event);
		const c = await comp(event.params.slug);
		const f = await event.request.formData();
		return step('access', () => grantAccess(admin, c.id, String(f.get('reason') ?? ''), Number(f.get('hours'))), 'Du har tillfällig åtkomst.');
	},
	endAccess: async (event) => {
		const admin = requireSiteAdmin(event);
		const f = await event.request.formData();
		return step('access', () => endAccess(admin, String(f.get('id') ?? '')), 'Åtkomsten är avslutad.');
	},
	anonymise: async (event) => {
		const admin = requireSiteAdmin(event);
		const c = await comp(event.params.slug);
		const f = await event.request.formData();
		const reason = String(f.get('reason') ?? '');
		const typed = String(f.get('confirm') ?? '').trim();
		if (c.status !== 'closed')
			return fail(409, { section: 'anonymise', error: 'Bara en avslutad tävling kan få personuppgifterna borttagna. Be ägaren avsluta den.' });
		const re = reasonError(reason);
		if (re) return fail(400, { section: 'anonymise', error: re });
		if (typed.toLocaleLowerCase('sv-SE') !== c.name.trim().toLocaleLowerCase('sv-SE'))
			return fail(400, { section: 'anonymise', error: `Skriv tävlingens namn exakt: ${c.name}` });
		return step('anonymise', () => anonymiseOnBehalf(admin, c.id, reason), 'Personuppgifterna är borttagna.');
	}
};

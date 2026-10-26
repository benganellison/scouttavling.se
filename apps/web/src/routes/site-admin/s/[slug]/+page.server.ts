import { error, type RequestEvent } from '@sveltejs/kit';
import { schema } from '#lib/server/db/index.ts';
import { eq } from 'drizzle-orm';
import { listAudit } from '#lib/server/audit.ts';
import { listMembers } from '#lib/server/ownership.ts';
import { memberAction, replaceOwner, type MemberAction } from '#lib/server/memberActions.ts';
import { seriesBySlug } from '#lib/server/series.ts';
import { adminActor, competitionHits, requireSiteAdmin } from '#lib/server/siteAdmin.ts';

async function series(slug: string) {
	const s = await seriesBySlug(slug);
	if (!s) error(404, 'Serien finns inte');
	return s;
}

export async function load(event) {
	requireSiteAdmin(event);
	const s = await series(event.params.slug);
	const [members, editions, audit] = await Promise.all([
		listMembers({ kind: 'series', id: s.id }),
		competitionHits(eq(schema.competition.seriesId, s.id), 50),
		listAudit({ seriesId: s.id, limit: 100 })
	]);
	return { series: { slug: s.slug, name: s.name, ownerGroupName: s.ownerGroupName }, members, editions, audit };
}

async function members(event: RequestEvent<{ slug: string }>, kind: MemberAction) {
	const admin = requireSiteAdmin(event);
	const s = await series(event.params.slug);
	const list = await listMembers({ kind: 'series', id: s.id });
	return memberAction(kind, await event.request.formData(), { kind: 'series', id: s.id }, adminActor(admin, ''), new Map(list.map((m) => [m.userId, m.name])));
}

export const actions = {
	memberAdd: (event) => members(event, 'add'),
	memberRole: (event) => members(event, 'role'),
	memberRemove: (event) => members(event, 'remove'),
	ownerReplace: async (event) => {
		const admin = requireSiteAdmin(event);
		const s = await series(event.params.slug);
		return replaceOwner(await event.request.formData(), { kind: 'series', id: s.id }, adminActor(admin, ''));
	}
};

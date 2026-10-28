import { error, redirect } from '@sveltejs/kit';
import { and, asc, eq } from 'drizzle-orm';
import { requireCompetition } from '#lib/server/auth.ts';
import { recordChange } from '#lib/server/changes.ts';
import { db, schema } from '#lib/server/db/index.ts';
import { loadTracks } from '../../../print/prep.server.ts';
import { savePatrol } from '../../patrolForm.server.ts';

async function findPatrol(competitionId: string, nr: string) {
	if (!/^\d{1,6}$/.test(nr)) error(404, 'Patrullen finns inte');
	const [p] = await db
		.select()
		.from(schema.patrol)
		.where(and(eq(schema.patrol.competitionId, competitionId), eq(schema.patrol.number, Number(nr))));
	if (!p) error(404, 'Patrullen finns inte');
	return p;
}

export async function load(event) {
	const { comp } = await requireCompetition(event, event.params.slug);
	const p = await findPatrol(comp.id, event.params.nr);
	const [tracks, members, scores] = await Promise.all([
		loadTracks(comp.id),
		db.select().from(schema.member).where(eq(schema.member.patrolId, p.id)).orderBy(asc(schema.member.lastName), asc(schema.member.firstName)),
		db.select({ id: schema.score.id }).from(schema.score).where(eq(schema.score.patrolId, p.id))
	]);
	return {
		competition: { slug: comp.slug, name: comp.name },
		tracks: tracks.map((t) => ({ id: t.id, name: t.name })),
		scoreCount: scores.length,
		patrol: {
			name: p.name,
			number: p.number,
			trackId: p.trackId ?? '',
			troop: p.troop,
			contactName: p.contactName ?? '',
			contactPhone: p.contactPhone ?? '',
			contactEmail: p.contactEmail ?? '',
			contactMemberNo: p.contactMemberNo ?? '',
			paid: p.paid,
			status: p.status,
			members: members.map((m) => ({ firstName: m.firstName, lastName: m.lastName, troopText: m.troopText }))
		}
	};
}

export const actions = {
	save: async (event) => {
		const { comp, user } = await requireCompetition(event, event.params.slug);
		const p = await findPatrol(comp.id, event.params.nr);
		const res = await savePatrol(comp.id, p.id, await event.request.formData(), user.id);
		if (res.error) return res.error;
		redirect(303, `/admin/${comp.slug}/patrols?saved=${res.number}`);
	},
	delete: async (event) => {
		const { comp } = await requireCompetition(event, event.params.slug, ['owner', 'organiser']);
		const p = await findPatrol(comp.id, event.params.nr);
		await db.transaction(async (tx) => {
			await tx.delete(schema.patrol).where(eq(schema.patrol.id, p.id));
			await recordChange(tx, comp.id, 'patrol', p.id);
		});
		redirect(303, `/admin/${comp.slug}/patrols`);
	}
};

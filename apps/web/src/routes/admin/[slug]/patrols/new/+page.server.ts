import { redirect } from '@sveltejs/kit';
import { requireCompetition } from '#lib/server/auth.ts';
import { loadTracks } from '../../print/prep.server.ts';
import { nextPatrolNumber, savePatrol } from '../patrolForm.server.ts';

export async function load(event) {
	const { comp } = await requireCompetition(event, event.params.slug);
	const tracks = await loadTracks(comp.id);
	return {
		competition: { slug: comp.slug, name: comp.name },
		tracks: tracks.map((t) => ({ id: t.id, name: t.name })),
		nextNumber: await nextPatrolNumber(comp.id)
	};
}

export const actions = {
	save: async (event) => {
		const { comp, user } = await requireCompetition(event, event.params.slug);
		const res = await savePatrol(comp.id, null, await event.request.formData(), user.id);
		if (res.error) return res.error;
		redirect(303, `/admin/${comp.slug}/patrols?saved=${res.number}`);
	}
};

import { redirect } from '@sveltejs/kit';
import { requireCompetition } from '#lib/server/auth.ts';

export async function load(event) {
	const { comp } = await requireCompetition(event, event.params.slug);
	return { comp: { slug: comp.slug, name: comp.name, backupMode: comp.backupMode } };
}

export const actions = {
	go: async (event) => {
		const { comp } = await requireCompetition(event, event.params.slug);
		const nr = Number((await event.request.formData()).get('nr'));
		if (Number.isInteger(nr) && nr > 0) redirect(303, `/admin/${comp.slug}/patrol/${nr}`);
		return { message: 'Ange ett patrullnummer' };
	}
};

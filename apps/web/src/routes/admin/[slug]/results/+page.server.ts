import { eq } from 'drizzle-orm';
import { requireCompetition } from '#lib/server/auth.ts';
import { db, schema } from '#lib/server/db/index.ts';
import { recordChange } from '#lib/server/changes.ts';
import { getResults } from '#lib/server/live.ts';

export async function load(event) {
	const { comp } = await requireCompetition(event, event.params.slug);
	event.depends(`live:${comp.slug}`);
	const res = await getResults(comp);
	const wanted = event.url.searchParams.get('class');
	const current = res.tracks.find((t) => t.trackId === wanted) ?? res.tracks[0] ?? null;
	return {
		comp: { slug: comp.slug, name: comp.name, publicResults: comp.publicResults, styleEnabled: comp.styleEnabled },
		tabs: res.tracks.map((t) => ({ id: t.trackId, name: t.name, count: t.rows.length })),
		current
	};
}

export const actions = {
	publish: async (event) => {
		const { comp } = await requireCompetition(event, event.params.slug);
		const on = (await event.request.formData()).get('on') === '1';
		await db.transaction(async (tx) => {
			await tx.update(schema.competition).set({ publicResults: on }).where(eq(schema.competition.id, comp.id));
			await recordChange(tx, comp.id, 'competition', comp.id);
		});
		return { published: on };
	}
};

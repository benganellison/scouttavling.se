import { requireCompetition } from '#lib/server/auth.ts';
import { loadStats } from '#lib/server/stats.ts';
import { showStationResults } from '#lib/server/live.ts';

export async function load(event) {
	const { comp } = await requireCompetition(event, event.params.slug);
	event.depends(`live:${comp.slug}`);
	return {
		comp: { slug: comp.slug, name: comp.name, publicResults: comp.publicResults, stationsPublic: showStationResults(comp), status: comp.status },
		stats: await loadStats(comp, { internal: true })
	};
}

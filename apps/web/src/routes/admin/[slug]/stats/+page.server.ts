import { requireCompetition } from '#lib/server/auth.ts';
import { loadStats } from '#lib/server/stats.ts';
import { showStationResults } from '#lib/server/results.ts';
import { liveKey } from '#lib/live.ts';

export async function load(event) {
	const { comp } = await requireCompetition(event, event.params.slug);
	event.depends(liveKey(comp.slug));
	return {
		comp: { slug: comp.slug, name: comp.name, publicResults: comp.publicResults, stationsPublic: showStationResults(comp), status: comp.status },
		stats: await loadStats(comp, { internal: true })
	};
}

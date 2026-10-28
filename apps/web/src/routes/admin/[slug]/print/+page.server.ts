import { requireCompetition } from '#lib/server/auth.ts';
import { loadPatrols, loadStations } from './prep.server.ts';
import { activeInvites } from '#lib/server/invites.ts';

export async function load(event) {
	const { comp } = await requireCompetition(event, event.params.slug);
	const [{ stations }, patrols, invites] = await Promise.all([loadStations(comp.id), loadPatrols(comp.id), activeInvites(comp.id)]);
	const active = patrols.filter((p) => p.status !== 'resigned');
	const starts = new Set(active.map((p) => p.startStationId).filter(Boolean));
	return {
		competition: { slug: comp.slug, name: comp.name, multiDay: comp.multiDay },
		stations: stations.length,
		withInvite: stations.filter((s) => invites.has(s.id)).length,
		patrols: active.length,
		distributed: active.filter((p) => p.startStationId).length,
		startStations: starts.size
	};
}

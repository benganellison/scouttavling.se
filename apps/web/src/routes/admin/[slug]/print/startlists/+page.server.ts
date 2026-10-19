import { requireCompetition } from '#lib/server/auth.ts';
import { loadPatrols, loadStations, loadTracks } from '../prep.server.ts';

export async function load(event) {
	const { comp } = await requireCompetition(event, event.params.slug);
	const [{ stations }, tracks, all] = await Promise.all([loadStations(comp.id), loadTracks(comp.id), loadPatrols(comp.id)]);
	const patrols = all.filter((p) => p.status !== 'resigned');
	const trackName = new Map(tracks.map((t) => [t.id, t.name]));
	const lists = stations
		.map((s) => ({
			id: s.id,
			code: s.code,
			name: s.name,
			patrols: patrols
				.filter((p) => p.startStationId === s.id)
				.map((p) => ({ nr: p.number, name: p.name, track: p.trackId ? (trackName.get(p.trackId) ?? '') : '', troop: p.troop, contact: [p.contactName, p.contactPhone].filter(Boolean).join(' · ') }))
		}))
		.filter((l) => l.patrols.length);
	return {
		competition: { slug: comp.slug, name: comp.name },
		lists,
		unassigned: patrols.filter((p) => !p.startStationId).map((p) => ({ nr: p.number, name: p.name }))
	};
}

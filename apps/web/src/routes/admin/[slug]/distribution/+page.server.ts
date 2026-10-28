import { fail } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { distribute, type DistPatrol, type DistStation, type Strategy } from '@scouttavling/domain';
import { requireCompetition } from '#lib/server/auth.ts';
import { recordChange } from '#lib/server/changes.ts';
import { db, schema } from '#lib/server/db/index.ts';
import { loadPatrols, loadStations, loadTracks } from '../print/prep.server.ts';

const STRATEGIES: Strategy[] = ['BALANCED', 'ALL', 'PER_TRACK'];

async function inputs(competitionId: string) {
	const [tracks, { stations: allStations, days }, all] = await Promise.all([
		loadTracks(competitionId),
		loadStations(competitionId),
		loadPatrols(competitionId)
	]);
	const patrols = all.filter((p) => p.status !== 'resigned');
	// Patrols start on the first day (later days start from that day's start), never at a start or
	// finish desk: only the first day's ordinary stations can be a start station.
	const firstDay = [...days].sort((a, b) => a.sort - b.sort || a.date.localeCompare(b.date))[0]?.id ?? null;
	const stations = allStations.filter((s) => days.length <= 1 || s.dayId === firstDay);
	const distStations: DistStation[] = stations.map((s, i) => ({ id: s.id, order: i, trackIds: s.trackIds, startable: s.startable && !s.role }));
	const distPatrols: DistPatrol[] = patrols.map((p) => ({ id: p.id, trackId: p.trackId ?? '', lockedStationId: p.startLocked ? p.startStationId : null }));
	return { tracks, stations, patrols, distStations, distPatrols };
}

export async function load(event) {
	const { comp } = await requireCompetition(event, event.params.slug);
	const { tracks, stations, patrols, distStations, distPatrols } = await inputs(comp.id);
	return {
		competition: { slug: comp.slug, name: comp.name },
		tracks: tracks.map((t) => ({ id: t.id, name: t.name })),
		stations: stations.filter((s) => s.startable && !s.role).map((s) => ({ id: s.id, code: s.code, name: s.name, trackIds: s.trackIds })),
		allStations: stations.length,
		distStations,
		distPatrols,
		saved: patrols.filter((p) => p.startStationId).length,
		locked: patrols.filter((p) => p.startLocked && p.startStationId).length,
		patrolCount: patrols.length
	};
}

export const actions = {
	save: async (event) => {
		const { comp } = await requireCompetition(event, event.params.slug, ['owner', 'organiser']);
		const form = await event.request.formData();
		const strategy = String(form.get('strategy')) as Strategy;
		const seed = Number(form.get('seed'));
		if (!STRATEGIES.includes(strategy) || !Number.isInteger(seed) || seed < 0 || seed > 2 ** 31) return fail(400, { message: 'Ogiltig fördelning' });
		const { distStations, distPatrols } = await inputs(comp.id);
		if (!distStations.some((s) => s.startable)) return fail(400, { message: 'Det finns inga kontroller som kan vara start.' });
		// Recomputed here (deterministic for the same seed) so the browser cannot place patrols arbitrarily.
		const { assignment } = distribute(distPatrols, distStations, strategy, seed);
		let saved = 0;
		await db.transaction(async (tx) => {
			for (const p of distPatrols) {
				if (p.lockedStationId) continue;
				const stationId = assignment.get(p.id) ?? null;
				await tx
					.update(schema.patrol)
					.set({ startStationId: stationId })
					.where(and(eq(schema.patrol.id, p.id), eq(schema.patrol.competitionId, comp.id), eq(schema.patrol.startLocked, false)));
				await recordChange(tx, comp.id, 'patrol', p.id);
				saved++;
			}
		});
		return { saved };
	}
};

import { count, eq, inArray } from 'drizzle-orm';
import { requireCompetition } from '#lib/server/auth.ts';
import { recordChange } from '#lib/server/changes.ts';
import { db, schema } from '#lib/server/db/index.ts';
import { loadPatrols, loadStations, loadTracks } from '../print/prep.server.ts';

export async function load(event) {
	const { comp } = await requireCompetition(event, event.params.slug);
	const [tracks, { stations }, patrols] = await Promise.all([loadTracks(comp.id), loadStations(comp.id), loadPatrols(comp.id)]);
	const ids = patrols.map((p) => p.id);
	const counts = ids.length
		? await db
				.select({ patrolId: schema.member.patrolId, n: count() })
				.from(schema.member)
				.where(inArray(schema.member.patrolId, ids))
				.groupBy(schema.member.patrolId)
		: [];
	const memberCount = new Map(counts.map((c) => [c.patrolId, c.n]));
	const trackName = new Map(tracks.map((t) => [t.id, t.name]));
	const station = new Map(stations.map((s) => [s.id, s]));
	return {
		competition: { slug: comp.slug, name: comp.name },
		tracks: tracks.map((t) => ({ id: t.id, name: t.name })),
		patrols: patrols.map((p) => ({
			id: p.id,
			number: p.number,
			name: p.name,
			trackId: p.trackId,
			track: p.trackId ? (trackName.get(p.trackId) ?? '') : '',
			troop: p.troop,
			contactName: p.contactName ?? '',
			contactPhone: p.contactPhone ?? '',
			members: memberCount.get(p.id) ?? 0,
			status: p.status,
			start: p.startStationId ? { code: station.get(p.startStationId)?.code ?? '?', name: station.get(p.startStationId)?.name ?? '' } : null,
			startLocked: p.startLocked,
			paid: p.paid
		}))
	};
}

export const actions = {
	togglePaid: async (event) => {
		const { comp } = await requireCompetition(event, event.params.slug);
		const form = await event.request.formData();
		const id = String(form.get('id') ?? '');
		const paid = form.get('paid') === '1';
		await db.transaction(async (tx) => {
			const [row] = await tx.select({ id: schema.patrol.id, c: schema.patrol.competitionId }).from(schema.patrol).where(eq(schema.patrol.id, id));
			if (!row || row.c !== comp.id) return;
			await tx.update(schema.patrol).set({ paid }).where(eq(schema.patrol.id, id));
			await recordChange(tx, comp.id, 'patrol', id);
		});
		return { ok: true };
	}
};

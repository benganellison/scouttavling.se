import { fail } from '@sveltejs/kit';
import { and, asc, eq, isNotNull, sql } from 'drizzle-orm';
import { stationCodes } from '@scouttavling/domain';
import { db, schema } from '#lib/server/db/index.ts';
import { requireCompetition } from '#lib/server/auth.ts';
import { recordChange } from '#lib/server/changes.ts';

export async function load(event) {
	const { comp, user } = await requireCompetition(event, event.params.slug);
	const cid = comp.id;
	const [patrols, [{ members }], stations, items, invited, days, tracks] = await Promise.all([
		db.select({ id: schema.patrol.id, start: schema.patrol.startStationId }).from(schema.patrol).where(eq(schema.patrol.competitionId, cid)),
		db
			.select({ members: sql<number>`count(*)::int` })
			.from(schema.member)
			.innerJoin(schema.patrol, eq(schema.patrol.id, schema.member.patrolId))
			.where(eq(schema.patrol.competitionId, cid)),
		db.select().from(schema.station).where(eq(schema.station.competitionId, cid)).orderBy(asc(schema.station.sort)),
		db
			.select({ stationId: schema.scoreItem.stationId, mode: schema.scoreItem.mode })
			.from(schema.scoreItem)
			.innerJoin(schema.station, eq(schema.station.id, schema.scoreItem.stationId))
			.where(eq(schema.station.competitionId, cid)),
		db
			.selectDistinct({ stationId: schema.invite.stationId })
			.from(schema.invite)
			.where(and(eq(schema.invite.competitionId, cid), isNotNull(schema.invite.stationId))),
		db.select().from(schema.day).where(eq(schema.day.competitionId, cid)).orderBy(asc(schema.day.sort)),
		db.select({ name: schema.track.name }).from(schema.track).where(eq(schema.track.competitionId, cid)).orderBy(asc(schema.track.sort))
	]);

	const codes = stationCodes(
		stations.map((s) => ({ id: s.id, dayId: s.dayId, order: s.sort, name: s.name, customCode: s.customCode })),
		days.map((d) => ({ id: d.id, prefix: d.prefix }))
	);
	const invitedSet = new Set(invited.map((i) => i.stationId));
	const withoutInvite = stations.filter((s) => !invitedSet.has(s.id));
	const itemStations = new Set(items.map((i) => i.stationId));
	const checkpoints = new Set(items.filter((i) => i.mode === 'CHECKIN').map((i) => i.stationId)).size;

	return {
		firstName: user.name.split(/\s+/)[0],
		stats: {
			patrols: patrols.length,
			members,
			stations: stations.length,
			checkpoints,
			stationsWithoutItems: stations.filter((s) => !itemStations.has(s.id)).length,
			withoutInvite: withoutInvite.map((s) => `${codes.get(s.id)} ${s.name}`),
			startAssigned: patrols.filter((p) => p.start).length,
			trackNames: tracks.map((t) => t.name)
		}
	};
}

export const actions = {
	status: async (event) => {
		const { comp } = await requireCompetition(event, event.params.slug, ['owner', 'organiser']);
		const f = await event.request.formData();
		const to = String(f.get('to') ?? '');
		if (!['draft', 'live', 'closed'].includes(to)) return fail(400, { statusError: 'Okänd status' });
		await db.transaction(async (tx) => {
			await tx.update(schema.competition).set({ status: to as 'draft' | 'live' | 'closed' }).where(eq(schema.competition.id, comp.id));
			await recordChange(tx, comp.id, 'competition', comp.id);
		});
		return { statusChanged: to };
	}
};

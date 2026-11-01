/** The station pack a phone downloads and keeps offline: its station, patrols, scores, messages (C1 pull). */
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '#lib/server/db/index.ts';
import { itemDef } from '#lib/server/scores.ts';
import { classColorTemplate, loadBranding } from '#lib/server/assets.ts';
import { trackColors } from '#lib/brand/colors.ts';
import { type PatrolStatus, type Snapshot, type SnapshotUnchanged } from '#lib/field/protocol.ts';
import { tracksOf } from '../queries.ts';
import type { DeviceContext } from './device.ts';
import { latestSeq } from '../changes.ts';
import { stationCodeMap } from '../queries.ts';

export async function buildSnapshot(ctx: DeviceContext, since: number | null): Promise<Snapshot | SnapshotUnchanged> {
	const { comp, device } = ctx;
	const cursor = await latestSeq(comp.id);
	const serverTime = new Date().toISOString();
	if (since !== null && since >= cursor) return { unchanged: true as const, cursor, serverTime };

	const isDesk = device.role === 'startfinish';
	// A station phone needs a new pack only for changes that concern it: the competition, stations,
	// patrols, messages, or scores at its own stations. Most changes during a competition are scores
	// elsewhere; those answer "unchanged" (with the new cursor) instead of ~200 KB per phone and pull.
	// The start & finish desk shows every patrol's progress, so any change counts there.
	if (since !== null && !isDesk) {
		const mine = device.stationIds.filter((id) => ctx.claims.stations.includes(id));
		const myScores = mine.length
			? sql`(c.kind = 'score' and exists (
					select 1 from score s join score_item i on i.id = s.item_id
					where s.id = c.entity_id and i.station_id in (${sql.join(
						mine.map((id) => sql`${id}`),
						sql`, `
					)})))`
			: sql`false`;
		const relevant = await db.execute(sql`
			select 1 from change_log c
			where c.competition_id = ${comp.id} and c.seq > ${since}
				and (c.kind in ('competition', 'station', 'patrol', 'message') or ${myScores})
			limit 1`);
		if ((relevant as unknown as unknown[]).length === 0) return { unchanged: true as const, cursor, serverTime };
	}
	const { stations, codes } = await stationCodeMap(comp.id);
	const stationTracks = await db
		.select({ stationId: schema.stationTrack.stationId, trackId: schema.stationTrack.trackId })
		.from(schema.stationTrack)
		.innerJoin(schema.station, eq(schema.station.id, schema.stationTrack.stationId))
		.where(eq(schema.station.competitionId, comp.id));
	const myStationIds = device.stationIds.filter((id) => ctx.claims.stations.includes(id));
	const tracks = await tracksOf(comp.id);
	const allItems = stations.length
		? await db
				.select()
				.from(schema.scoreItem)
				.where(
					inArray(
						schema.scoreItem.stationId,
						stations.map((s) => s.id)
					)
				)
				.orderBy(schema.scoreItem.sort)
		: [];
	const myItems = isDesk ? [] : allItems.filter((i) => myStationIds.includes(i.stationId));
	const patrols = await db.select().from(schema.patrol).where(eq(schema.patrol.competitionId, comp.id)).orderBy(schema.patrol.number);
	const trackName = new Map(tracks.map((t) => [t.id, t.name]));
	const colors = trackColors(tracks, await classColorTemplate(comp.id));

	const scores = myItems.length
		? await db
				.select({ s: schema.score, by: schema.device.displayName })
				.from(schema.score)
				.leftJoin(schema.device, eq(schema.device.id, schema.score.deviceId))
				.where(
					and(
						eq(schema.score.competitionId, comp.id),
						inArray(
							schema.score.itemId,
							myItems.map((i) => i.id)
						)
					)
				)
		: [];

	// Desk: per-patrol progress (kontroller x/y, poäng, senast sedd, tid ute).
	let progress: Record<
		string,
		{
			stationsDone: number;
			points: number;
			lastSeenAt: string | null;
			lastStationId: string | null;
			startedAt: string | null;
			finishedAt: string | null;
			campAt: string | null;
		}
	> = {};
	if (isDesk) {
		const itemStation = new Map(allItems.map((i) => [i.id, i.stationId]));
		const all = await db
			.select({
				patrolId: schema.score.patrolId,
				itemId: schema.score.itemId,
				points: schema.score.points,
				style: schema.score.stylePoints,
				at: schema.score.updatedAt
			})
			.from(schema.score)
			.where(and(eq(schema.score.competitionId, comp.id), eq(schema.score.state, 'active')));
		const events = await db
			.select({ patrolId: schema.statusEvent.patrolId, status: schema.statusEvent.status, at: schema.statusEvent.at })
			.from(schema.statusEvent)
			.innerJoin(schema.patrol, eq(schema.patrol.id, schema.statusEvent.patrolId))
			.where(eq(schema.patrol.competitionId, comp.id))
			.orderBy(schema.statusEvent.at);
		const acc = new Map<
			string,
			{ stations: Set<string>; points: number; last: Date | null; lastStation: string | null; started: Date | null; finished: Date | null; camp: Date | null }
		>();
		const get = (id: string) => {
			let a = acc.get(id);
			if (!a) acc.set(id, (a = { stations: new Set(), points: 0, last: null, lastStation: null, started: null, finished: null, camp: null }));
			return a;
		};
		for (const s of all) {
			const a = get(s.patrolId);
			const st = itemStation.get(s.itemId) ?? null;
			if (st) a.stations.add(st);
			a.points += s.points + s.style;
			if (!a.last || s.at > a.last) {
				a.last = s.at;
				a.lastStation = st;
			}
		}
		for (const e of events) {
			const a = get(e.patrolId);
			// First start counts ("Tid ute" spans every day); a camp → active next morning is not a new start.
			if (e.status === 'active' && !a.started) a.started = e.at;
			if (e.status === 'finished') a.finished = e.at;
			if (e.status === 'camp') a.camp = e.at;
			if (!a.last || e.at > a.last) {
				a.last = e.at;
				a.lastStation = null;
			}
		}
		progress = Object.fromEntries(
			[...acc].map(([id, a]) => [
				id,
				{
					stationsDone: a.stations.size,
					points: a.points,
					lastSeenAt: a.last?.toISOString() ?? null,
					lastStationId: a.lastStation,
					startedAt: a.started?.toISOString() ?? null,
					finishedAt: a.finished?.toISOString() ?? null,
					campAt: a.camp?.toISOString() ?? null
				}
			])
		);
	}

	const msgs = await db
		.select({ m: schema.message, readAt: schema.messageRead.at })
		.from(schema.message)
		.leftJoin(schema.messageRead, and(eq(schema.messageRead.messageId, schema.message.id), eq(schema.messageRead.deviceId, device.id)))
		.where(eq(schema.message.competitionId, comp.id))
		.orderBy(desc(schema.message.createdAt))
		.limit(100);
	const messages = msgs
		.filter(({ m }) => m.audience.includes('all') || (isDesk && m.audience.includes('startfinish')) || m.audience.some((a) => myStationIds.includes(a)))
		.slice(0, 50)
		.map(({ m, readAt }) => ({ id: m.id, title: m.title, body: m.body, important: m.important, createdAt: m.createdAt.toISOString(), read: !!readAt }));

	return {
		unchanged: false as const,
		cursor,
		serverTime,
		device: { id: device.id, displayName: device.displayName, role: device.role, revoked: ctx.revoked, superseded: ctx.superseded },
		competition: {
			id: comp.id,
			slug: comp.slug,
			name: comp.name,
			styleEnabled: comp.styleEnabled,
			backupMode: comp.backupMode,
			hqPhone: comp.hqPhone,
			patrolCodeKey: comp.patrolCodeKey,
			status: comp.status,
			startDate: comp.startDate,
			endDate: comp.endDate,
			branding: await loadBranding(comp)
		},
		myStationIds,
		stations: stations.map((s) => ({
			id: s.id,
			code: codes.get(s.id) ?? '',
			name: s.name,
			sort: s.sort,
			dayId: s.dayId,
			startable: s.startable,
			trackIds: s.allTracks ? null : stationTracks.filter((t) => t.stationId === s.id).map((t) => t.trackId),
			items: allItems.filter((i) => i.stationId === s.id).length
		})),
		items: myItems.map((i) => ({ ...itemDef(i, comp), stationId: i.stationId })),
		tracks: tracks.map((t) => ({ id: t.id, name: t.name, color: colors[t.id] ?? null })),
		patrols: patrols.map((p) => ({
			id: p.id,
			number: p.number,
			name: p.name,
			trackId: p.trackId,
			track: p.trackId ? (trackName.get(p.trackId) ?? '') : '',
			troop: p.troop,
			status: p.status as PatrolStatus,
			startStationId: p.startStationId,
			...(isDesk ? { phone: p.contactPhone } : {})
		})),
		scores: scores.map(({ s, by }) => ({
			patrolId: s.patrolId,
			itemId: s.itemId,
			points: s.points,
			stylePoints: s.stylePoints,
			raw: s.raw,
			state: s.state,
			version: s.version,
			at: s.updatedAt.toISOString(),
			by: s.origin === 'device' ? (by ?? 'Funktionär') : s.origin === 'paper' ? 'Pappersprotokoll' : 'Tävlingsledningen',
			mine: s.deviceId === device.id
		})),
		progress,
		messages
	};
}
export type { Snapshot };

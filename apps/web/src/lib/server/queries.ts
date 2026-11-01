/*
 * Queries many pages share: a competition's classes, stations and items in their display order.
 * Use these instead of writing the select again (and forgetting the order).
 */
import { asc, eq } from 'drizzle-orm';
import { codeInput, displayOrder, isCheckpointOnly, stationCodes } from '@scouttavling/domain';
import { db, schema, type ItemRow, type Queryable } from './db/index.ts';

/** Classes in display order. */
export function tracksOf(competitionId: string, q: Queryable = db) {
	return q.select().from(schema.track).where(eq(schema.track.competitionId, competitionId)).orderBy(asc(schema.track.sort), asc(schema.track.name));
}

/** Stations in display order (sort). */
export function stationsOf(competitionId: string, q: Queryable = db) {
	return q.select().from(schema.station).where(eq(schema.station.competitionId, competitionId)).orderBy(asc(schema.station.sort));
}

/** Score items of all the competition's stations, in sort order within each station. */
export async function itemsOf(competitionId: string, q: Queryable = db): Promise<ItemRow[]> {
	const rows = await q
		.select({ item: schema.scoreItem })
		.from(schema.scoreItem)
		.innerJoin(schema.station, eq(schema.station.id, schema.scoreItem.stationId))
		.where(eq(schema.station.competitionId, competitionId))
		.orderBy(asc(schema.scoreItem.sort));
	return rows.map((r) => r.item);
}

/** Which classes each station is for (only stations not open to all classes have rows). */
export function stationTrackLinks(competitionId: string, q: Queryable = db) {
	return q
		.select({ stationId: schema.stationTrack.stationId, trackId: schema.stationTrack.trackId })
		.from(schema.stationTrack)
		.innerJoin(schema.station, eq(schema.station.id, schema.stationTrack.stationId))
		.where(eq(schema.station.competitionId, competitionId));
}

export interface StationInfo {
	id: string;
	code: string;
	dayId: string | null;
	name: string;
	sort: number;
	allTracks: boolean;
	trackIds: string[];
	startable: boolean;
	/** The day's start / finish (null = ordinary station). */
	role: 'start' | 'finish' | null;
	/** What a report here does to the patrol's status: finish stations set I läger, or I mål on the last day. */
	finishSets: 'camp' | 'finished' | null;
	/** All items are CHECKIN / AUTO_ON_SCAN (lunch, rest stops). */
	checkpoint: boolean;
	contactPhone: string | null;
	items: ItemRow[];
}

/** Every page's view of the stations: in display order (by day, then position), with paper codes, classes and items. */
export async function loadStations(competitionId: string): Promise<StationInfo[]> {
	const [stations, days, links, items] = await Promise.all([
		stationsOf(competitionId),
		db.select().from(schema.day).where(eq(schema.day.competitionId, competitionId)),
		stationTrackLinks(competitionId),
		itemsOf(competitionId)
	]);
	const codes = stationCodes(
		stations.map(codeInput),
		days.map((d) => ({ id: d.id, prefix: d.prefix }))
	);
	const lastDay = [...days].sort((a, b) => a.sort - b.sort || a.date.localeCompare(b.date)).at(-1);
	const dayOrder = [...days].sort((a, b) => a.sort - b.sort);
	return displayOrder(stations, dayOrder).map((s) => {
		const its = items.filter((i) => i.stationId === s.id);
		const finish = s.role === 'finish' || its.some((i) => i.mode === 'AUTO_ON_SCAN');
		return {
			id: s.id,
			code: codes.get(s.id) ?? '?',
			dayId: s.dayId,
			name: s.name,
			sort: s.sort,
			allTracks: s.allTracks,
			trackIds: links.filter((l) => l.stationId === s.id).map((l) => l.trackId),
			startable: s.startable,
			role: s.role,
			finishSets: (finish ? (!lastDay || s.dayId === lastDay.id ? 'finished' : 'camp') : null) as StationInfo['finishSets'],
			checkpoint: isCheckpointOnly(its),
			contactPhone: s.contactPhone,
			items: its
		};
	});
}

export const stationAppliesTo = (s: Pick<StationInfo, 'allTracks' | 'trackIds'>, trackId: string | null) =>
	s.allTracks || (trackId !== null && s.trackIds.includes(trackId));

/** Paper codes per station (F1, L2, Mål …), with the stations in order and the days. */
export async function stationCodeMap(competitionId: string) {
	const [stations, days] = await Promise.all([stationsOf(competitionId), db.select().from(schema.day).where(eq(schema.day.competitionId, competitionId))]);
	const codes = stationCodes(
		stations.map(codeInput),
		days.map((d) => ({ id: d.id, prefix: d.prefix }))
	);
	return { stations: stations.sort((a, b) => a.sort - b.sort), days, codes };
}

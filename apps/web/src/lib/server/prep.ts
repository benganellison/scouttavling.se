import { asc, eq } from 'drizzle-orm';
import { scorableItems } from '@scouttavling/domain';
import { db, schema, type ItemRow, type StationRow } from './db/index.ts';
import { loadStations as loadAllStations, tracksOf } from './queries.ts';

/**
 * The preparation pages' view (patrols, import, distribution, invites, print): stations from the one
 * station model (queries.ts loadStations, in display order), with "all classes" as trackIds null.
 */

export type { ItemRow, StationRow };

export interface PrepStation {
	id: string;
	name: string;
	sort: number;
	dayId: string | null;
	code: string;
	startable: boolean;
	/** The day's start or finish (never a start station for distribution). */
	role: 'start' | 'finish' | null;
	/** null = all tracks */
	trackIds: string[] | null;
	items: ItemRow[];
}

export interface PrepDay {
	id: string;
	name: string;
	prefix: string;
	date: string;
	sort: number;
}

export async function loadTracks(competitionId: string) {
	return tracksOf(competitionId);
}

export async function loadStations(competitionId: string): Promise<{ days: PrepDay[]; stations: PrepStation[] }> {
	const [days, stations] = await Promise.all([
		db.select().from(schema.day).where(eq(schema.day.competitionId, competitionId)).orderBy(asc(schema.day.sort)),
		loadAllStations(competitionId)
	]);
	return {
		days: days.map((d) => ({ id: d.id, name: d.name, prefix: d.prefix, date: d.date, sort: d.sort })),
		stations: stations.map((s) => ({
			id: s.id,
			name: s.name,
			sort: s.sort,
			dayId: s.dayId,
			code: s.code,
			startable: s.startable,
			role: s.role,
			trackIds: s.allTracks ? null : s.trackIds,
			items: s.items
		}))
	};
}

export function stationDoesTrack(s: Pick<PrepStation, 'trackIds'>, trackId: string | null): boolean {
	return s.trackIds === null || (trackId !== null && s.trackIds.includes(trackId));
}

/** Items that take a score (not just a check-in / auto finish registration). */
export function scoredItems(s: Pick<PrepStation, 'items'>): ItemRow[] {
	return scorableItems(s.items);
}

export async function loadPatrols(competitionId: string) {
	return db.select().from(schema.patrol).where(eq(schema.patrol.competitionId, competitionId)).orderBy(asc(schema.patrol.number));
}

/**
 * Expected arrival order at `stationId`: patrols that start at station index i
 * reach station j after (j - i) mod n steps around the startable rotation.
 * Undistributed patrols are ordered by number after the others.
 */
export function arrivalOrder<P extends { number: number; startStationId: string | null }>(patrols: P[], stations: PrepStation[], stationId: string): P[] {
	const n = stations.length;
	const target = stations.findIndex((s) => s.id === stationId);
	const pos = (id: string | null) => {
		if (!id || n === 0) return Infinity;
		const startIdx = stations.findIndex((s) => s.id === id);
		if (startIdx < 0) return Infinity;
		// Steps along the full station list from the start station to the target.
		return (target - startIdx + n) % n;
	};
	return [...patrols].sort((a, b) => pos(a.startStationId) - pos(b.startStationId) || a.number - b.number);
}

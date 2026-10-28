import { asc, eq, inArray } from 'drizzle-orm';
import { stationCodes } from '@scouttavling/domain';
import { db, schema } from '#lib/server/db/index.ts';

/**
 * Shared loaders for the preparation pages (distribution, invites, print).
 * Owned by admin-patrols.
 */

export type StationRow = typeof schema.station.$inferSelect;
export type ItemRow = typeof schema.scoreItem.$inferSelect;

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
	return db.select().from(schema.track).where(eq(schema.track.competitionId, competitionId)).orderBy(asc(schema.track.sort), asc(schema.track.name));
}

/** Stations in running order (per day, then sort) with paper codes, tracks and items. */
export async function loadStations(competitionId: string): Promise<{ days: PrepDay[]; stations: PrepStation[] }> {
	const days = await db.select().from(schema.day).where(eq(schema.day.competitionId, competitionId)).orderBy(asc(schema.day.sort));
	const rows = await db.select().from(schema.station).where(eq(schema.station.competitionId, competitionId)).orderBy(asc(schema.station.sort));
	const ids = rows.map((r) => r.id);
	const links = ids.length ? await db.select().from(schema.stationTrack).where(inArray(schema.stationTrack.stationId, ids)) : [];
	const items = ids.length ? await db.select().from(schema.scoreItem).where(inArray(schema.scoreItem.stationId, ids)).orderBy(asc(schema.scoreItem.sort)) : [];
	const codes = stationCodes(
		rows.map((r) => ({ id: r.id, dayId: r.dayId, order: r.sort, name: r.name, customCode: r.customCode, role: r.role })),
		days.map((d) => ({ id: d.id, prefix: d.prefix }))
	);
	const daySort = new Map(days.map((d) => [d.id, d.sort]));
	const stations = rows
		.map((r) => ({
			id: r.id,
			name: r.name,
			sort: r.sort,
			dayId: r.dayId,
			code: codes.get(r.id) ?? '?',
			startable: r.startable,
			role: r.role,
			trackIds: r.allTracks ? null : links.filter((l) => l.stationId === r.id).map((l) => l.trackId),
			items: items.filter((i) => i.stationId === r.id)
		}))
		.sort((a, b) => (daySort.get(a.dayId ?? '') ?? 999) - (daySort.get(b.dayId ?? '') ?? 999) || a.sort - b.sort);
	return { days: days.map((d) => ({ id: d.id, name: d.name, prefix: d.prefix, date: d.date, sort: d.sort })), stations };
}

export function stationDoesTrack(s: Pick<PrepStation, 'trackIds'>, trackId: string | null): boolean {
	return s.trackIds === null || (trackId !== null && s.trackIds.includes(trackId));
}

/** Items that take a score (not just a check-in / auto finish registration). */
export function scoredItems(s: Pick<PrepStation, 'items'>): ItemRow[] {
	return s.items.filter((i) => i.mode !== 'CHECKIN' && i.mode !== 'AUTO_ON_SCAN');
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

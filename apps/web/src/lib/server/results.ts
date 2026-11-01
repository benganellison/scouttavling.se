/*
 * Results: ranking per class with points per station (pure, unit-tested in results.test.ts) and the
 * per-competition cache keyed by the change_log cursor.
 */
import { and, eq } from 'drizzle-orm';
import { maxPoints, rank, type RankedPatrol } from '@scouttavling/domain';
import { db, schema, type CompRow, type ItemRow } from './db/index.ts';
import { latestSeq } from './changes.ts';
import { itemDef } from './scores.ts';
import { itemsOf, stationTrackLinks, stationsOf, tracksOf } from './queries.ts';

export interface ResultsInput {
	styleEnabled: boolean;
	tracks: { id: string; name: string; sort: number }[];
	stations: { id: string; name: string; sort: number; allTracks: boolean; trackIds: string[] }[];
	items: ItemRow[];
	patrols: { id: string; number: number; name: string; troop: string; trackId: string | null; status: string }[];
	scores: { patrolId: string; itemId: string; points: number; stylePoints: number }[];
}

export interface ResultRow {
	patrolId: string;
	number: number;
	name: string;
	troop: string;
	place: number;
	total: number;
	scorePoints: number;
	stylePoints: number;
	tied: boolean;
	decidedBy: RankedPatrol['decidedBy'];
	/** Swedish one-liner explaining a tie or a tiebreak against a neighbour. */
	tieNote: string | null;
	stationsDone: number;
	stationsTotal: number;
	/** Points per station, aligned with TrackResults.stations; null = not reported yet. */
	perStation: ({ points: number; stylePoints: number } | null)[];
}

/** A station that gives points in a class (check-ins and lunch stops are left out). */
export interface ResultStation {
	id: string;
	name: string;
	sort: number;
	/** Highest points without style. */
	max: number;
	/** Highest style points (0 when style is off for all its items). */
	styleMax: number;
}

export interface TrackResults {
	trackId: string;
	name: string;
	stations: ResultStation[];
	rows: ResultRow[];
}

const DECIDED_TEXT = {
	scorePoints: 'skiljs på poäng utan stil',
	tiebreak: 'skiljs på flest maxpoäng'
} as const;

/** Per-track ranking with domain `rank()`; resigned patrols are left out. */
export function computeResults(input: ResultsInput): TrackResults[] {
	const def = new Map(input.items.map((i) => [i.id, itemDef(i, { styleEnabled: input.styleEnabled })]));
	const itemsByStation = new Map<string, ItemRow[]>();
	for (const it of input.items) itemsByStation.set(it.stationId, [...(itemsByStation.get(it.stationId) ?? []), it]);
	const scoresByPatrol = new Map<string, ResultsInput['scores']>();
	for (const s of input.scores) scoresByPatrol.set(s.patrolId, [...(scoresByPatrol.get(s.patrolId) ?? []), s]);

	const out: TrackResults[] = [];
	const tracks = [...input.tracks].sort((a, b) => a.sort - b.sort);
	for (const track of tracks) {
		const stations = input.stations.filter((s) => s.allTracks || s.trackIds.includes(track.id)).sort((a, b) => a.sort - b.sort);
		const stationOfItem = new Map<string, string>();
		for (const st of stations) for (const it of itemsByStation.get(st.id) ?? []) stationOfItem.set(it.id, st.id);
		const items = [...stationOfItem.keys()].map((id) => def.get(id)!);
		const patrols = input.patrols.filter((p) => p.trackId === track.id && p.status !== 'resigned');
		const byId = new Map(patrols.map((p) => [p.id, p]));
		const relevant = (pid: string) => (scoresByPatrol.get(pid) ?? []).filter((s) => stationOfItem.has(s.itemId));
		const columns: ResultStation[] = stations
			.map((st) => {
				const defs = (itemsByStation.get(st.id) ?? []).map((it) => def.get(it.id)!);
				return {
					id: st.id,
					name: st.name,
					sort: st.sort,
					max: defs.reduce((n, d) => n + maxPoints(d), 0),
					styleMax: defs.reduce((n, d) => n + (d.styleEnabled ? d.styleMax : 0), 0)
				};
			})
			.filter((c) => c.max > 0 || c.styleMax > 0);
		const ranked = rank(
			patrols.map((p) => ({
				id: p.id,
				number: p.number,
				scores: relevant(p.id).map((s) => ({ itemId: s.itemId, points: s.points, stylePoints: s.stylePoints }))
			})),
			items
		);
		const rows: ResultRow[] = ranked.map((r, i) => {
			const p = byId.get(r.id)!;
			const mine = relevant(r.id);
			const done = new Set(mine.map((s) => stationOfItem.get(s.itemId)));
			const perStation = columns.map((c) => {
				const at = mine.filter((s) => stationOfItem.get(s.itemId) === c.id);
				const style = (s: (typeof at)[number]) => (def.get(s.itemId)?.styleEnabled === false ? 0 : s.stylePoints);
				return at.length ? { points: at.reduce((n, s) => n + s.points, 0), stylePoints: at.reduce((n, s) => n + style(s), 0) } : null;
			});
			return {
				patrolId: r.id,
				number: r.number,
				name: p.name,
				troop: p.troop,
				place: r.place,
				total: r.total,
				scorePoints: r.scorePoints,
				stylePoints: r.stylePoints,
				tied: r.tied,
				decidedBy: r.decidedBy,
				tieNote: tieNote(ranked, i),
				stationsDone: done.size,
				stationsTotal: stations.length,
				perStation
			};
		});
		out.push({ trackId: track.id, name: track.name, stations: columns, rows });
	}
	return out;
}

/** Public results without personal data: number, patrol name, kår and points only. */
export function publicTracks(tracks: TrackResults[], withStations: boolean) {
	return tracks.map((t) => ({
		trackId: t.trackId,
		name: t.name,
		stations: withStations ? t.stations.map((s) => ({ name: s.name, max: s.max, styleMax: s.styleMax })) : [],
		rows: t.rows.map((r) => ({
			number: r.number,
			name: r.name,
			troop: r.troop,
			place: r.place,
			total: r.total,
			scorePoints: r.scorePoints,
			stylePoints: r.stylePoints,
			tied: r.tied,
			tieNote: r.tieNote,
			stationsDone: r.stationsDone,
			stationsTotal: r.stationsTotal,
			perStation: withStations ? r.perStation : []
		}))
	}));
}

/**
 * Points per station in public results: always once the competition is closed (and so in the
 * archive), during the competition only when the organiser turned it on (default off, so
 * patrols cannot see a station's scores before they get there).
 */
export const showStationResults = (comp: Pick<CompRow, 'status' | 'stationResultsLive'>) => comp.status === 'closed' || comp.stationResultsLive;
export type PublicTrack = ReturnType<typeof publicTracks>[number];

function tieNote(ranked: RankedPatrol[], i: number): string | null {
	const row = ranked[i];
	if (row.tied) {
		const others = ranked.filter((o) => o.place === row.place && o.id !== row.id).map((o) => o.number);
		return `Delad plats med ${others.join(', ')} — helt lika även på poäng utan stil och maxpoäng`;
	}
	const next = ranked[i + 1];
	if (next && (row.decidedBy === 'scorePoints' || row.decidedBy === 'tiebreak')) {
		return `Lika med ${next.number} på totalpoäng — ${DECIDED_TEXT[row.decidedBy]}`;
	}
	const prev = ranked[i - 1];
	if (prev && (prev.decidedBy === 'scorePoints' || prev.decidedBy === 'tiebreak')) {
		return `Lika med ${prev.number} på totalpoäng — ${DECIDED_TEXT[prev.decidedBy]}`;
	}
	return null;
}

interface CacheEntry {
	seq: number;
	at: number;
	data: TrackResults[];
}
const g = globalThis as unknown as { __liveResultsCache?: Map<string, CacheEntry> };
const resultsCache = (g.__liveResultsCache ??= new Map());
/** Competitions whose results are kept in memory (each up to ~1 MB with points per station). */
const RESULTS_CACHE_MAX = 50;

/**
 * Cached results. Recomputed when the change_log cursor moved, but at most
 * every `maxStaleMs` (10 s for public pages, 0 for organiser pages). Entries
 * older than a minute are refreshed anyway (covers writes outside change_log).
 */
export async function getResults(
	comp: Pick<CompRow, 'id' | 'styleEnabled'> & { status?: string },
	maxStaleMs = 0
): Promise<{ seq: number; tracks: TrackResults[] }> {
	const seq = await latestSeq(comp.id);
	const hit = resultsCache.get(comp.id);
	const age = hit ? Date.now() - hit.at : Infinity;
	// A closed competition's results do not change without a change_log entry: no 1-minute expiry.
	const fresh = age < 60_000 || comp.status === 'closed';
	if (hit && fresh && (hit.seq === seq || age < maxStaleMs)) {
		resultsCache.delete(comp.id); // least recently used goes first when the cache is full
		resultsCache.set(comp.id, hit);
		return { seq: hit.seq, tracks: hit.data };
	}
	// Single flight: many open result streams after one score share one computation.
	const key = `${comp.id}:${seq}`;
	let running = computing.get(key);
	if (!running) {
		running = (async () => {
			try {
				const data = computeResults(await loadResultsInput(comp));
				resultsCache.set(comp.id, { seq, at: Date.now(), data });
				while (resultsCache.size > RESULTS_CACHE_MAX) resultsCache.delete(resultsCache.keys().next().value!);
				return data;
			} finally {
				computing.delete(key);
			}
		})();
		computing.set(key, running);
	}
	return { seq, tracks: await running };
}
const computing = new Map<string, Promise<TrackResults[]>>();

export async function loadResultsInput(comp: Pick<CompRow, 'id' | 'styleEnabled'>): Promise<ResultsInput> {
	const [tracks, stations, links, items, patrols, scores] = await Promise.all([
		tracksOf(comp.id),
		stationsOf(comp.id),
		stationTrackLinks(comp.id),
		itemsOf(comp.id),
		db
			.select({
				id: schema.patrol.id,
				number: schema.patrol.number,
				name: schema.patrol.name,
				troop: schema.patrol.troop,
				trackId: schema.patrol.trackId,
				status: schema.patrol.status
			})
			.from(schema.patrol)
			.where(eq(schema.patrol.competitionId, comp.id)),
		db
			.select({ patrolId: schema.score.patrolId, itemId: schema.score.itemId, points: schema.score.points, stylePoints: schema.score.stylePoints })
			.from(schema.score)
			.where(and(eq(schema.score.competitionId, comp.id), eq(schema.score.state, 'active')))
	]);
	return {
		styleEnabled: comp.styleEnabled,
		tracks,
		stations: stations.map((s) => ({
			id: s.id,
			name: s.name,
			sort: s.sort,
			allTracks: s.allTracks,
			trackIds: links.filter((l) => l.stationId === s.id).map((l) => l.trackId)
		})),
		items,
		patrols,
		scores
	};
}

import { and, asc, desc, eq, gt, inArray, isNull, max } from 'drizzle-orm';
import postgres from 'postgres';
import { maxPoints, rank, stationCodes, type RankedPatrol } from '@scouttavling/domain';
import { DATABASE_URL } from '$app/env/private';
import { db, schema, type CompRow } from './db/index.ts';
import { itemDef } from './scores.ts';

/*
 * Live module: results computation (cached per competition, keyed by the
 * change_log cursor) and the realtime hub behind the SSE endpoints.
 */

type ItemRow = typeof schema.scoreItem.$inferSelect;
type StationRow = typeof schema.station.$inferSelect;

// ---------------------------------------------------------------------------
// Results (pure part, unit-tested)
// ---------------------------------------------------------------------------

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
					id: st.id, name: st.name, sort: st.sort, max: defs.reduce((n, d) => n + maxPoints(d), 0),
					styleMax: defs.reduce((n, d) => n + (d.styleEnabled ? d.styleMax : 0), 0)
				};
			})
			.filter((c) => c.max > 0 || c.styleMax > 0);
		const ranked = rank(
			patrols.map((p) => ({ id: p.id, number: p.number, scores: relevant(p.id).map((s) => ({ itemId: s.itemId, points: s.points, stylePoints: s.stylePoints })) })),
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
				patrolId: r.id, number: r.number, name: p.name, troop: p.troop, place: r.place, total: r.total,
				scorePoints: r.scorePoints, stylePoints: r.stylePoints, tied: r.tied, decidedBy: r.decidedBy,
				tieNote: tieNote(ranked, i), stationsDone: done.size, stationsTotal: stations.length, perStation
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
			number: r.number, name: r.name, troop: r.troop, place: r.place, total: r.total, scorePoints: r.scorePoints,
			stylePoints: r.stylePoints, tied: r.tied, tieNote: r.tieNote, stationsDone: r.stationsDone, stationsTotal: r.stationsTotal,
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

// ---------------------------------------------------------------------------
// Results (DB + cache)
// ---------------------------------------------------------------------------

interface CacheEntry {
	seq: number;
	at: number;
	data: TrackResults[];
}
const g = globalThis as unknown as { __liveResultsCache?: Map<string, CacheEntry>; __liveHub?: Hub };
const resultsCache = (g.__liveResultsCache ??= new Map());
/** Competitions whose results are kept in memory (each up to ~1 MB with points per station). */
const RESULTS_CACHE_MAX = 50;

/** Latest change_log seq for a competition (0 when nothing has been logged). */
export async function latestSeq(competitionId: string): Promise<number> {
	const [row] = await db.select({ seq: max(schema.changeLog.seq) }).from(schema.changeLog).where(eq(schema.changeLog.competitionId, competitionId));
	return Number(row?.seq ?? 0);
}

/**
 * Cached results. Recomputed when the change_log cursor moved, but at most
 * every `maxStaleMs` (10 s for public pages, 0 for organiser pages). Entries
 * older than a minute are refreshed anyway (covers writes outside change_log).
 */
export async function getResults(comp: Pick<CompRow, 'id' | 'styleEnabled'> & { status?: string }, maxStaleMs = 0): Promise<{ seq: number; tracks: TrackResults[] }> {
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

/**
 * Open public streams, per client address and in total. A stream costs a connection and work after
 * every change, so one client cannot hold thousands open (the admin stream needs a login).
 */
const streams = { total: 0, byClient: new Map<string, number>() };
// perClient is high on purpose: mobile operators put many users behind one IPv4 address (CGNAT),
// and a whole camp may share one Wi-Fi address. The total cap protects the server.
export const STREAM_LIMITS = { perClient: 200, total: 4000 };
/** Reserves a slot for a public stream; null when over a limit. Call the returned release on close. */
export function acquireStream(client: string): (() => void) | null {
	const mine = streams.byClient.get(client) ?? 0;
	if (mine >= STREAM_LIMITS.perClient || streams.total >= STREAM_LIMITS.total) return null;
	streams.byClient.set(client, mine + 1);
	streams.total++;
	let released = false;
	return () => {
		if (released) return;
		released = true;
		streams.total--;
		const n = (streams.byClient.get(client) ?? 1) - 1;
		if (n <= 0) streams.byClient.delete(client);
		else streams.byClient.set(client, n);
	};
}

export async function loadResultsInput(comp: Pick<CompRow, 'id' | 'styleEnabled'>): Promise<ResultsInput> {
	const [tracks, stations, links, items, patrols, scores] = await Promise.all([
		db.select().from(schema.track).where(eq(schema.track.competitionId, comp.id)),
		db.select().from(schema.station).where(eq(schema.station.competitionId, comp.id)),
		db
			.select({ stationId: schema.stationTrack.stationId, trackId: schema.stationTrack.trackId })
			.from(schema.stationTrack)
			.innerJoin(schema.station, eq(schema.station.id, schema.stationTrack.stationId))
			.where(eq(schema.station.competitionId, comp.id)),
		db
			.select({ item: schema.scoreItem })
			.from(schema.scoreItem)
			.innerJoin(schema.station, eq(schema.station.id, schema.scoreItem.stationId))
			.where(eq(schema.station.competitionId, comp.id)),
		db
			.select({ id: schema.patrol.id, number: schema.patrol.number, name: schema.patrol.name, troop: schema.patrol.troop, trackId: schema.patrol.trackId, status: schema.patrol.status })
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
		stations: stations.map((s) => ({ id: s.id, name: s.name, sort: s.sort, allTracks: s.allTracks, trackIds: links.filter((l) => l.stationId === s.id).map((l) => l.trackId) })),
		items: items.map((r) => r.item),
		patrols,
		scores
	};
}

// ---------------------------------------------------------------------------
// Shared competition structure helpers
// ---------------------------------------------------------------------------

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

/** Stations in order with paper codes, track links and items. */
export async function loadStations(competitionId: string): Promise<StationInfo[]> {
	const [stations, days, links, items] = await Promise.all([
		db.select().from(schema.station).where(eq(schema.station.competitionId, competitionId)).orderBy(asc(schema.station.sort)),
		db.select().from(schema.day).where(eq(schema.day.competitionId, competitionId)),
		db
			.select({ stationId: schema.stationTrack.stationId, trackId: schema.stationTrack.trackId })
			.from(schema.stationTrack)
			.innerJoin(schema.station, eq(schema.station.id, schema.stationTrack.stationId))
			.where(eq(schema.station.competitionId, competitionId)),
		db
			.select({ item: schema.scoreItem })
			.from(schema.scoreItem)
			.innerJoin(schema.station, eq(schema.station.id, schema.scoreItem.stationId))
			.where(eq(schema.station.competitionId, competitionId))
			.orderBy(asc(schema.scoreItem.sort))
	]);
	const codes = stationCodes(
		stations.map((s: StationRow) => ({ id: s.id, dayId: s.dayId, order: s.sort, name: s.name, customCode: s.customCode, role: s.role })),
		days.map((d) => ({ id: d.id, prefix: d.prefix }))
	);
	const lastDay = [...days].sort((a, b) => a.sort - b.sort || a.date.localeCompare(b.date)).at(-1);
	return stations.map((s) => {
		const its = items.filter((r) => r.item.stationId === s.id).map((r) => r.item);
		const finish = s.role === 'finish' || its.some((i) => i.mode === 'AUTO_ON_SCAN');
		return {
			id: s.id, code: codes.get(s.id) ?? '?', dayId: s.dayId, name: s.name, sort: s.sort, allTracks: s.allTracks,
			trackIds: links.filter((l) => l.stationId === s.id).map((l) => l.trackId), startable: s.startable, role: s.role,
			finishSets: (finish ? (!lastDay || s.dayId === lastDay.id ? 'finished' : 'camp') : null) as StationInfo['finishSets'],
			checkpoint: its.length > 0 && its.every((i) => i.mode === 'CHECKIN' || i.mode === 'AUTO_ON_SCAN'),
			contactPhone: s.contactPhone, items: its
		};
	});
}

export const stationAppliesTo = (s: Pick<StationInfo, 'allTracks' | 'trackIds'>, trackId: string | null) =>
	s.allTracks || (trackId !== null && s.trackIds.includes(trackId));

/** First name only — enough for audit lines and keeps screens short. */
export const firstName = (name: string | null | undefined) => (name ?? '').split(' ')[0] || 'okänd';

// ---------------------------------------------------------------------------
// Dashboard (Ledningscentralen)
// ---------------------------------------------------------------------------

const ONLINE_MS = 10 * 60_000;
const OFFLINE_ALARM_MS = 20 * 60_000;
const UNSEEN_ALARM_MS = 45 * 60_000;

export interface Alarm {
	key: string;
	kind: 'unseen' | 'offline' | 'conflict';
	title: string;
	detail: string;
	href: string | null;
}

/** Acknowledged alarm keys per competition (in memory; keys embed the triggering timestamp). */
const acks: Map<string, Set<string>> = ((globalThis as unknown as { __liveAcks?: Map<string, Set<string>> }).__liveAcks ??= new Map());

export function acknowledgeAlarm(competitionId: string, key: string) {
	const set = acks.get(competitionId) ?? new Set<string>();
	set.add(key);
	acks.set(competitionId, set);
}

const minutesSince = (d: Date, now: number) => Math.floor((now - d.getTime()) / 60_000);

/**
 * "Not seen for 45 min": only patrols out on the course (active). Anmäld, I läger
 * (done for the day, overnight in camp), I mål and Återbud never alarm.
 */
export function unseenAlarms(
	patrols: { id: string; number: number; name: string; status: string }[],
	lastByPatrol: Map<string, Date>,
	now: number,
	slug: string
): Alarm[] {
	const out: Alarm[] = [];
	for (const p of patrols.filter((p) => p.status === 'active').sort((a, b) => a.number - b.number)) {
		const last = lastByPatrol.get(p.id);
		if (!last || now - last.getTime() < UNSEEN_ALARM_MS) continue;
		out.push({
			key: `unseen:${p.id}:${last.getTime()}`, kind: 'unseen', title: `${p.number} ${p.name} inte sedd på ${formatDuration(minutesSince(last, now))}`,
			detail: `Senast rapporterad ${formatTime(last)}`, href: `/admin/${slug}/patrol/${p.number}`
		});
	}
	return out;
}

export async function loadDashboard(comp: CompRow) {
	const now = Date.now();
	const [stations, patrols, scores, devices, statusEvents, conflicts, feed] = await Promise.all([
		loadStations(comp.id),
		db
			.select({ id: schema.patrol.id, number: schema.patrol.number, name: schema.patrol.name, status: schema.patrol.status, trackId: schema.patrol.trackId })
			.from(schema.patrol)
			.where(eq(schema.patrol.competitionId, comp.id)),
		db
			.select({ patrolId: schema.score.patrolId, itemId: schema.score.itemId, updatedAt: schema.score.updatedAt })
			.from(schema.score)
			.where(and(eq(schema.score.competitionId, comp.id), eq(schema.score.state, 'active'))),
		db.select().from(schema.device).where(and(eq(schema.device.competitionId, comp.id), isNull(schema.device.revokedAt))),
		db
			.select({ patrolId: schema.statusEvent.patrolId, at: max(schema.statusEvent.at) })
			.from(schema.statusEvent)
			.innerJoin(schema.patrol, eq(schema.patrol.id, schema.statusEvent.patrolId))
			.where(eq(schema.patrol.competitionId, comp.id))
			.groupBy(schema.statusEvent.patrolId),
		db
			.select({ id: schema.scoreConflict.id, createdAt: schema.scoreConflict.createdAt })
			.from(schema.scoreConflict)
			.where(and(eq(schema.scoreConflict.competitionId, comp.id), eq(schema.scoreConflict.status, 'open')))
			.orderBy(desc(schema.scoreConflict.createdAt)),
		loadFeed(comp.id, 12)
	]);

	const kpi = {
		active: patrols.filter((p) => p.status === 'active').length,
		camp: patrols.filter((p) => p.status === 'camp').length,
		finished: patrols.filter((p) => p.status === 'finished').length,
		registered: patrols.filter((p) => p.status === 'registered').length,
		resigned: patrols.filter((p) => p.status === 'resigned').length,
		reports: scores.length,
		devicesOnline: devices.filter((d) => d.lastSeenAt && now - d.lastSeenAt.getTime() < ONLINE_MS).length,
		devicesTotal: devices.length
	};

	const stationOfItem = new Map<string, string>();
	for (const st of stations) for (const it of st.items) stationOfItem.set(it.id, st.id);
	const doneBy = new Map<string, Set<string>>();
	for (const s of scores) {
		const st = stationOfItem.get(s.itemId);
		if (!st) continue;
		doneBy.set(st, (doneBy.get(st) ?? new Set()).add(s.patrolId));
	}
	const tiles = stations.map((st) => {
		const expected = patrols.filter((p) => p.status !== 'resigned' && stationAppliesTo(st, p.trackId)).length;
		const done = doneBy.get(st.id)?.size ?? 0;
		const devs = devices.filter((d) => d.stationIds.includes(st.id));
		const last = devs.reduce<Date | null>((acc, d) => (d.lastSeenAt && (!acc || d.lastSeenAt > acc) ? d.lastSeenAt : acc), null);
		const offMs = last ? now - last.getTime() : null;
		const state: 'online' | 'stale' | 'offline' | 'none' =
			devs.length === 0 ? 'none' : offMs === null ? 'offline' : offMs < ONLINE_MS ? 'online' : offMs < OFFLINE_ALARM_MS ? 'stale' : 'offline';
		return {
			id: st.id, code: st.code, name: st.name, checkpoint: st.checkpoint, finishSets: st.finishSets, expected, done, devices: devs.length, state,
			lastSeenAt: last, offlineMinutes: last && state !== 'online' ? minutesSince(last, now) : null
		};
	});

	// ---- alarms ----
	const ack = acks.get(comp.id) ?? new Set<string>();
	const alarms: Alarm[] = [];
	const lastByPatrol = new Map<string, Date>();
	const bump = (pid: string, at: Date | null) => {
		if (!at) return;
		const cur = lastByPatrol.get(pid);
		if (!cur || at > cur) lastByPatrol.set(pid, at);
	};
	for (const s of scores) bump(s.patrolId, s.updatedAt);
	for (const e of statusEvents) bump(e.patrolId, e.at ? new Date(e.at) : null);
	alarms.push(...unseenAlarms(patrols, lastByPatrol, now, comp.slug));
	for (const t of tiles.filter((t) => t.state === 'offline')) {
		alarms.push({
			key: `offline:${t.id}:${t.lastSeenAt?.getTime() ?? 0}`, kind: 'offline', title: `${t.code} ${t.name} offline`,
			detail: t.lastSeenAt ? `Ingen kontakt sedan ${formatTime(t.lastSeenAt)} (${formatDuration(t.offlineMinutes ?? 0)})` : 'Enheten har aldrig synkat',
			href: null
		});
	}
	if (conflicts.length > 0) {
		alarms.push({
			key: `conflict:${conflicts[0].id}:${conflicts.length}`, kind: 'conflict',
			title: conflicts.length === 1 ? '1 öppen poängkonflikt' : `${conflicts.length} öppna poängkonflikter`,
			detail: 'Två rapporter skiljer sig åt och behöver ett beslut', href: `/admin/${comp.slug}/conflicts`
		});
	}

	return { kpi, tiles, alarms: alarms.filter((a) => !ack.has(a.key)), acknowledged: alarms.filter((a) => ack.has(a.key)).length, feed, seq: await latestSeq(comp.id) };
}

/** Latest score reports (revisions), newest first. */
export async function loadFeed(competitionId: string, limit: number) {
	const stations = await loadStations(competitionId);
	const codeOf = new Map(stations.flatMap((s) => s.items.map((i) => [i.id, { code: s.code, station: s.name, item: i.name, multi: s.items.length > 1 }] as const)));
	const rows = await db
		.select({
			id: schema.scoreRevision.id, at: schema.scoreRevision.at, version: schema.scoreRevision.version, points: schema.scoreRevision.points,
			stylePoints: schema.scoreRevision.stylePoints, state: schema.scoreRevision.state, origin: schema.scoreRevision.origin,
			itemId: schema.score.itemId, patrolNumber: schema.patrol.number, patrolName: schema.patrol.name,
			deviceName: schema.device.displayName, userName: schema.appUser.name
		})
		.from(schema.scoreRevision)
		.innerJoin(schema.score, eq(schema.score.id, schema.scoreRevision.scoreId))
		.innerJoin(schema.patrol, eq(schema.patrol.id, schema.score.patrolId))
		.leftJoin(schema.device, eq(schema.device.id, schema.scoreRevision.deviceId))
		.leftJoin(schema.appUser, eq(schema.appUser.id, schema.scoreRevision.userId))
		.where(eq(schema.score.competitionId, competitionId))
		.orderBy(desc(schema.scoreRevision.at), desc(schema.scoreRevision.version))
		.limit(limit);
	return rows.map((r) => {
		const c = codeOf.get(r.itemId);
		return {
			id: r.id, at: r.at, time: formatTime(r.at), code: c?.code ?? '?', what: c ? (c.multi ? `${c.station} · ${c.item}` : c.station) : '',
			patrol: `${r.patrolNumber} ${r.patrolName}`, patrolNumber: r.patrolNumber, points: r.points, stylePoints: r.stylePoints,
			state: r.state, edited: r.version > 1, origin: r.origin, by: r.deviceName ?? (r.userName ? firstName(r.userName) : r.origin === 'paper' ? 'papper' : 'okänd')
		};
	});
}

// ---------------------------------------------------------------------------
// Formatting (fixed time zone so SSR and hydration agree)
// ---------------------------------------------------------------------------

const TIME = new Intl.DateTimeFormat('sv-SE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Stockholm' });
export const formatTime = (d: Date) => TIME.format(d);
export const formatDuration = (min: number) => (min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`);

// ---------------------------------------------------------------------------
// Realtime hub: ONE LISTEN connection per process, fan-out per competition,
// plus a 3 s poll while anyone is subscribed. The cursor is the only truth.
// ---------------------------------------------------------------------------

export interface ChangeRow {
	seq: number;
	kind: string;
	entityId: string | null;
	at: Date;
}

export interface Subscriber {
	cursor: number;
	deliver(rows: ChangeRow[]): void;
}

class Hub {
	subs = new Map<string, Set<Subscriber>>();
	private listener: postgres.Sql | null = null;
	private poll: ReturnType<typeof setInterval> | null = null;
	private pumping = new Map<string, Promise<void>>();
	private again = new Set<string>();

	subscribe(competitionId: string, sub: Subscriber): () => void {
		const set = this.subs.get(competitionId) ?? new Set();
		set.add(sub);
		this.subs.set(competitionId, set);
		this.ensureRunning();
		void this.pump(competitionId);
		return () => {
			set.delete(sub);
			if (set.size === 0) this.subs.delete(competitionId);
			if (this.subs.size === 0) this.stopPoll();
		};
	}

	private ensureRunning() {
		if (!this.listener) {
			this.listener = postgres(DATABASE_URL, { max: 1, idle_timeout: 0, onnotice: () => {} });
			this.listener
				.listen(
					'changes',
					(payload) => {
						try {
							const { c } = JSON.parse(payload) as { c: string };
							if (this.subs.has(c)) void this.pump(c);
						} catch {
							/* malformed hint: the poll covers it */
						}
					},
					// (Re)connected: catch up everyone from their cursor.
					() => this.pumpAll()
				)
				.catch((e) => console.error('[live] LISTEN failed, relying on poll', e));
		}
		if (!this.poll) this.poll = setInterval(() => this.pumpAll(), 3000);
	}

	/** On shutdown: stop polling and drop the LISTEN connection so the process can exit. */
	async close() {
		this.stopPoll();
		const l = this.listener;
		this.listener = null;
		await l?.end({ timeout: 5 });
	}

	private stopPoll() {
		if (this.poll) clearInterval(this.poll);
		this.poll = null;
	}

	private pumpAll() {
		for (const c of this.subs.keys()) void this.pump(c);
	}

	/** Reads change_log after the lowest cursor once and hands each subscriber its tail. Serialised per competition. */
	pump(competitionId: string): Promise<void> {
		const running = this.pumping.get(competitionId);
		if (running) {
			this.again.add(competitionId);
			return running;
		}
		const p = (async () => {
			try {
				do {
					this.again.delete(competitionId);
					const set = this.subs.get(competitionId);
					if (!set || set.size === 0) return;
					const from = Math.min(...[...set].map((s) => s.cursor));
					const rows = await db
						.select({ seq: schema.changeLog.seq, kind: schema.changeLog.kind, entityId: schema.changeLog.entityId, at: schema.changeLog.at })
						.from(schema.changeLog)
						.where(and(eq(schema.changeLog.competitionId, competitionId), gt(schema.changeLog.seq, from)))
						.orderBy(asc(schema.changeLog.seq))
						.limit(500);
					for (const s of set) {
						const tail = rows.filter((r) => r.seq > s.cursor);
						if (tail.length) {
							s.cursor = tail[tail.length - 1].seq;
							try {
								s.deliver(tail);
							} catch {
								/* closed stream; its cleanup unsubscribes */
							}
						}
					}
					if (rows.length === 500) this.again.add(competitionId);
				} while (this.again.has(competitionId));
			} catch (e) {
				console.error('[live] pump failed', e);
			} finally {
				this.pumping.delete(competitionId);
			}
		})();
		this.pumping.set(competitionId, p);
		return p;
	}
}

export const hub: Hub = (g.__liveHub ??= new Hub());

// ---------------------------------------------------------------------------
// SSE helper
// ---------------------------------------------------------------------------

const HEARTBEAT_MS = 20_000;
const MAX_STREAM_MS = 55 * 60_000;

/** Cursor from Last-Event-ID (reconnect) or ?since=, else "from now". */
export async function cursorFrom(request: Request, url: URL, competitionId: string): Promise<number> {
	const raw = request.headers.get('last-event-id') ?? url.searchParams.get('since');
	const n = raw !== null ? Number(raw) : NaN;
	return Number.isFinite(n) && n >= 0 ? n : latestSeq(competitionId);
}

/**
 * Builds a text/event-stream response. `onRows` turns change rows into SSE
 * frames (return '' to skip). The stream ends itself after ~55 min; the
 * client's EventSource resumes with Last-Event-ID.
 */
export function sseResponse(
	request: Request,
	competitionId: string,
	cursor: number,
	onRows: (rows: ChangeRow[], send: (frame: string) => void) => void | Promise<void>,
	onOpen?: (send: (frame: string) => void) => void,
	onClose?: () => void
): Response {
	const enc = new TextEncoder();
	let cleanup = () => {};
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			let closed = false;
			const send = (frame: string) => {
				if (closed || !frame) return;
				try {
					controller.enqueue(enc.encode(frame));
				} catch {
					cleanup();
				}
			};
			send(`retry: 3000\n: cursor ${cursor}\n\n`);
			onOpen?.(send);
			const unsubscribe = hub.subscribe(competitionId, {
				cursor,
				deliver: (rows) => {
					void Promise.resolve(onRows(rows, send)).catch((e) => console.error('[live] sse', e));
				}
			});
			const beat = setInterval(() => send(`: hb ${Date.now()}\n\n`), HEARTBEAT_MS);
			const end = setTimeout(() => cleanup(), MAX_STREAM_MS);
			cleanup = () => {
				if (closed) return;
				closed = true;
				onClose?.();
				clearInterval(beat);
				clearTimeout(end);
				unsubscribe();
				try {
					controller.close();
				} catch {
					/* already closed */
				}
			};
			request.signal.addEventListener('abort', () => cleanup());
		},
		cancel() {
			cleanup();
		}
	});
	return new Response(stream, {
		headers: {
			'content-type': 'text/event-stream; charset=utf-8',
			'cache-control': 'no-cache, no-transform',
			'x-accel-buffering': 'no'
		}
	});
}

export const frame = (event: string, id: number | null, data: unknown) =>
	`${id !== null ? `id: ${id}\n` : ''}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

// ---------------------------------------------------------------------------
// Messages: audience → devices
// ---------------------------------------------------------------------------

export function deviceInAudience(d: { role: string; stationIds: string[] }, audience: string[]) {
	if (audience.includes('all')) return true;
	if (audience.includes('startfinish') && d.role === 'startfinish') return true;
	return d.stationIds.some((s) => audience.includes(s));
}

export async function devicesFor(competitionId: string) {
	return db.select().from(schema.device).where(and(eq(schema.device.competitionId, competitionId), isNull(schema.device.revokedAt)));
}

export async function readsFor(messageIds: string[]) {
	if (messageIds.length === 0) return [];
	return db.select().from(schema.messageRead).where(inArray(schema.messageRead.messageId, messageIds));
}


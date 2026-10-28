import { and, asc, eq, inArray } from 'drizzle-orm';
import { histogram, maxPoints, perDate, stationTimes, summarize, type Bucket, type Summary } from '@scouttavling/domain';
import { db, schema, type CompRow } from './db/index.ts';
import { itemDef } from './scores.ts';
import { loadStations, showStationResults, stationAppliesTo } from './live.ts';

/*
 * "Statistik": what the organiser's page and the public statistics page show. Pure maths lives in
 * @scouttavling/domain (stats.ts); this file loads rows and splits public from internal parts.
 * Public: participation always; points per station and times follow showStationResults()
 * (always once closed, during the competition only when the organiser turned it on).
 * Internal only: registration dates and payments.
 */


export interface Participation {
	/** Every patrol, also those who withdrew. */
	registered: number;
	/** Reported at a station or set "På banan" at some point. */
	started: number;
	finished: number;
	resigned: number;
}

export interface StationStat {
	code: string;
	name: string;
	/** Highest points without style. */
	max: number;
	/** Points without style per patrol that was reported here. */
	points: Summary | null;
	/** Mean style points (null when style is off here). */
	styleMean: number | null;
	/** Mean as a share of max, 0–100. */
	pctOfMax: number | null;
	buckets: Bucket[];
}

export interface ScopeTimes {
	legs: { from: string; to: string; fromName: string; toName: string; minutes: Summary }[];
	course: { day: string | null; minutes: Summary }[];
	/** Patrols with at least one timed (phone) report; paper and HQ entries have no time. */
	timedPatrols: number;
}

export interface StatsScope {
	/** null = all classes. */
	trackId: string | null;
	name: string;
	participation: Participation;
	stations: StationStat[];
	/** Null when not public yet (see showStationResults). */
	times: ScopeTimes | null;
}

export interface Stats {
	scopes: StatsScope[];
	stationsShown: boolean;
}

export interface InternalStats extends Stats {
	registrations: { date: string; count: number; total: number }[];
	payments: {
		fee: number | null;
		/** Every patrol marked paid (also one that withdrew after paying). */
		paid: number;
		/** Patrols still in the competition that have not paid. */
		unpaid: number;
		received: number | null;
		outstanding: number | null;
		byDate: { date: string; count: number; total: number }[];
	};
	window: { opensOn: string | null; closesOn: string | null };
}

export async function loadStats(comp: CompRow, opts: { internal: true }): Promise<InternalStats>;
export async function loadStats(comp: CompRow, opts?: { internal?: false }): Promise<Stats>;
export async function loadStats(comp: CompRow, opts: { internal?: boolean } = {}): Promise<Stats | InternalStats> {
	const showStations = opts.internal || showStationResults(comp);
	const [tracks, stations, days, patrols, started, scores] = await Promise.all([
		db.select().from(schema.track).where(eq(schema.track.competitionId, comp.id)).orderBy(asc(schema.track.sort)),
		loadStations(comp.id),
		db.select().from(schema.day).where(eq(schema.day.competitionId, comp.id)).orderBy(asc(schema.day.sort), asc(schema.day.date)),
		db
			.select({ id: schema.patrol.id, trackId: schema.patrol.trackId, status: schema.patrol.status, createdAt: schema.patrol.createdAt, paid: schema.patrol.paid, paidAt: schema.patrol.paidAt })
			.from(schema.patrol)
			.where(eq(schema.patrol.competitionId, comp.id)),
		db
			.selectDistinct({ patrolId: schema.statusEvent.patrolId })
			.from(schema.statusEvent)
			.innerJoin(schema.patrol, eq(schema.patrol.id, schema.statusEvent.patrolId))
			.where(and(eq(schema.patrol.competitionId, comp.id), inArray(schema.statusEvent.status, ['active', 'camp', 'finished']))),
		db
			.select({ patrolId: schema.score.patrolId, itemId: schema.score.itemId, points: schema.score.points, stylePoints: schema.score.stylePoints, scoredAt: schema.score.scoredAt })
			.from(schema.score)
			.where(and(eq(schema.score.competitionId, comp.id), eq(schema.score.state, 'active')))
	]);

	const stationOfItem = new Map(stations.flatMap((s) => s.items.map((it) => [it.id, s.id] as const)));
	const hasStarted = new Set([...started.map((s) => s.patrolId), ...scores.map((s) => s.patrolId)]);
	const participation = (list: typeof patrols): Participation => ({
		registered: list.length,
		started: list.filter((p) => hasStarted.has(p.id) || ['active', 'camp', 'finished'].includes(p.status)).length,
		finished: list.filter((p) => p.status === 'finished').length,
		resigned: list.filter((p) => p.status === 'resigned').length
	});

	// Points per patrol and station (sum over the station's items), withdrawn patrols left out like in the results.
	const inPlay = new Map(patrols.filter((p) => p.status !== 'resigned').map((p) => [p.id, p]));
	const perStation = new Map<string, Map<string, { points: number; style: number }>>();
	for (const s of scores) {
		const st = stationOfItem.get(s.itemId);
		if (!st || !inPlay.has(s.patrolId)) continue;
		const m = perStation.get(st) ?? new Map();
		const cur = m.get(s.patrolId) ?? { points: 0, style: 0 };
		m.set(s.patrolId, { points: cur.points + s.points, style: cur.style + s.stylePoints });
		perStation.set(st, m);
	}
	const stationStats = (trackId: string | null): StationStat[] =>
		stations
			.filter((s) => trackId === null || stationAppliesTo(s, trackId))
			.map((s) => {
				const defs = s.items.map((it) => itemDef(it, comp));
				const max = defs.reduce((n, d) => n + maxPoints(d), 0);
				const styleOn = defs.some((d) => d.styleEnabled);
				const rows = [...(perStation.get(s.id) ?? new Map<string, { points: number; style: number }>())]
					.filter(([pid]) => trackId === null || inPlay.get(pid)?.trackId === trackId)
					.map(([, v]) => v);
				const points = summarize(rows.map((r) => r.points));
				return {
					code: s.code, name: s.name, max, points,
					styleMean: styleOn && rows.length ? Math.round((rows.reduce((n, r) => n + r.style, 0) / rows.length) * 10) / 10 : null,
					// From the exact mean: points.mean is already rounded to one decimal.
					pctOfMax: points && max ? Math.round((rows.reduce((n, r) => n + r.points, 0) / rows.length / max) * 100) : null,
					buckets: histogram(rows.map((r) => r.points), max)
				};
			})
			.filter((s) => s.max > 0);

	const byId = new Map(stations.map((s) => [s.id, s]));
	const dayName = new Map(days.map((d) => [d.id, d.name]));
	const allVisits = scores
		.filter((s) => s.scoredAt && inPlay.has(s.patrolId) && stationOfItem.has(s.itemId))
		.map((s) => {
			const st = byId.get(stationOfItem.get(s.itemId)!)!;
			return { patrolId: s.patrolId, stationId: st.id, dayId: st.dayId, at: s.scoredAt! };
		});
	const scopeTimes = (trackId: string | null): ScopeTimes => {
		const visits = trackId === null ? allVisits : allVisits.filter((v) => inPlay.get(v.patrolId)?.trackId === trackId);
		const t = stationTimes(visits);
		return {
			legs: t.legs
				.map((l) => ({ from: byId.get(l.from)!.code, to: byId.get(l.to)!.code, fromName: byId.get(l.from)!.name, toName: byId.get(l.to)!.name, minutes: l.minutes, sort: byId.get(l.from)!.sort }))
				.sort((a, b) => b.minutes.n - a.minutes.n || a.sort - b.sort)
				.map(({ sort: _sort, ...l }) => l),
			course: t.course
				.map((c) => ({ day: c.dayId ? (dayName.get(c.dayId) ?? null) : null, minutes: c.minutes, sort: days.findIndex((d) => d.id === c.dayId) }))
				.sort((a, b) => a.sort - b.sort)
				.map(({ sort: _sort, ...c }) => c),
			timedPatrols: new Set(visits.map((v) => v.patrolId)).size
		};
	};

	const scope = (trackId: string | null, name: string, list: typeof patrols): StatsScope => ({
		trackId, name, participation: participation(list),
		stations: showStations ? stationStats(trackId) : [],
		times: showStations ? scopeTimes(trackId) : null
	});
	const scopes: StatsScope[] = [scope(null, 'Alla klasser', patrols), ...tracks.map((t) => scope(t.id, t.name, patrols.filter((p) => p.trackId === t.id)))];

	const base: Stats = { scopes, stationsShown: showStations };
	if (!opts.internal) return base;

	const paid = patrols.filter((p) => p.paid);
	const unpaid = patrols.filter((p) => !p.paid && p.status !== 'resigned');
	const fee = comp.feePerPatrol;
	return {
		...base,
		registrations: perDate(patrols.map((p) => p.createdAt)),
		payments: {
			fee,
			paid: paid.length,
			unpaid: unpaid.length,
			received: fee === null ? null : paid.length * fee,
			outstanding: fee === null ? null : unpaid.length * fee,
			byDate: perDate(paid.filter((p) => p.paidAt).map((p) => p.paidAt!))
		},
		window: { opensOn: comp.registrationOpensOn, closesOn: comp.registrationClosesOn }
	};
}


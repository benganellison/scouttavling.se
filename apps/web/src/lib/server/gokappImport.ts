/**
 * Import an old gokapp year into the archive (docs/architecture/02 §9, 05 §5). Used by the
 * `gokapp:import` CLI; no SvelteKit imports, so it runs from the production image.
 *
 * Privacy (04 §8): only what an archived edition keeps is ever READ from gokapp: station
 * definitions, classes, patrol number/name/kår/class/status and the scores. Members, contacts,
 * notes, start/end strings, external ids, payments, users and messages are never selected
 * (READS below is the complete list; a unit test checks it). The edition is created already
 * archived (`anonymised_at` set), so it is read-only and public in the series archive.
 */
import { randomBytes } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import { and, eq } from 'drizzle-orm';
import type postgres from 'postgres';
import {
	evaluate,
	gokappComparator,
	guessDate,
	InvalidScoreError,
	itemFromStation,
	rank,
	statusFromGokapp,
	type GokappStation,
	type GokappStatus,
	type ScoreItemDef
} from '@scouttavling/domain';
import * as schema from './db/schema.ts';

/** Every query the importer runs against gokapp. Nothing else is read. */
export const READS = {
	config: 'SELECT name FROM config ORDER BY id LIMIT 1',
	tracks: 'SELECT id, name FROM track ORDER BY id',
	stations:
		'SELECT id, stationnumber, stationname, alltracks, minscore, maxscore, minstylescore, maxstylescore, waypoint, usedistinctscores, distinctscores FROM station ORDER BY stationnumber, id',
	stationTracks: 'SELECT station_id, tracks_id FROM station_track',
	patrols: 'SELECT patrolid, patrolname, troop, fk_track, status FROM patrol ORDER BY patrolid',
	scores: 'SELECT patrol_id, station_id, score_point, style_point, visited_waypoint, last_saved FROM score'
} as const;

/** Columns that hold personal data in gokapp. READS must never mention them. */
export const NEVER_READ = ['members', 'leadercontact', 'contactmail', 'leadercontactphone', 'note', 'externalid', 'starttime', 'endtime', 'date_registered', 'paid', 'stationcontact', 'stationphone', 'user_id', 'users', 'usermessage', 'message_read', 'password'];

export interface GokappData {
	configName: string | null;
	tracks: { id: number; name: string | null }[];
	stations: GokappStation[];
	stationTracks: { station_id: number; tracks_id: number }[];
	patrols: { patrolid: number; patrolname: string | null; troop: string | null; fk_track: number | null; status: GokappStatus | null }[];
	scores: { patrol_id: number; station_id: number; score_point: number; style_point: number; visited_waypoint: boolean | null; last_saved: Date | null }[];
}

/** Minimal query interface (mysql2/promise connection or pool). */
export interface MysqlLike {
	query(sql: string): Promise<[unknown, unknown]>;
}

const bool = (v: unknown) => (v === null || v === undefined ? null : Buffer.isBuffer(v) ? v[0] === 1 : Boolean(Number(v)));

export async function readGokapp(conn: MysqlLike): Promise<GokappData> {
	const q = async <T>(sql: string) => (await conn.query(sql))[0] as T[];
	const [config, tracks, stations, stationTracks, patrols, scores] = await Promise.all([
		q<{ name: string | null }>(READS.config),
		q<{ id: number; name: string | null }>(READS.tracks),
		q<Record<string, unknown>>(READS.stations),
		q<{ station_id: number; tracks_id: number }>(READS.stationTracks),
		q<GokappData['patrols'][number]>(READS.patrols),
		q<Record<string, unknown>>(READS.scores)
	]);
	return {
		configName: config[0]?.name ?? null,
		tracks,
		// MySQL BIT(1) columns arrive as Buffers.
		stations: stations.map((s) => ({
			id: Number(s.id), stationnumber: Number(s.stationnumber), stationname: (s.stationname as string | null) ?? null,
			alltracks: bool(s.alltracks) ?? true, minscore: Number(s.minscore ?? 0), maxscore: Number(s.maxscore ?? 0),
			minstylescore: Number(s.minstylescore ?? 0), maxstylescore: Number(s.maxstylescore ?? 0),
			waypoint: bool(s.waypoint), usedistinctscores: bool(s.usedistinctscores), distinctscores: (s.distinctscores as string | null) ?? null
		})),
		stationTracks,
		patrols,
		scores: scores.map((s) => ({
			patrol_id: Number(s.patrol_id), station_id: Number(s.station_id), score_point: Number(s.score_point ?? 0), style_point: Number(s.style_point ?? 0),
			visited_waypoint: bool(s.visited_waypoint), last_saved: (s.last_saved as Date | null) ?? null
		}))
	};
}

export interface ImportOptions {
	/** Series slug. Created when it does not exist and `seriesName` is given. */
	series: string;
	seriesName?: string;
	year: number;
	/** Competition day (YYYY-MM-DD); default: the day most scores were saved. */
	date?: string;
	name?: string;
	slug?: string;
	/** Member number of the edition's owner (must have logged in once). */
	ownerMemberNo: string;
	/** Use gokapp's last save time as the visit time (for times between stations). */
	withTimes: boolean;
	/** "cli:<os user>" for the audit log. */
	operator: string;
}

export interface ImportPlan {
	name: string;
	slug: string;
	date: string | null;
	dateGuessed: boolean;
	classes: { name: string; patrols: number; podium: { place: number; number: number; name: string; total: number }[] }[];
	stations: number;
	patrols: number;
	scores: number;
	timedScores: number;
	/** Scores outside today's rules for their station (kept as they were). */
	offRule: { patrol: number; station: string; points: number; style: number; why: string }[];
	/** Places where our ranking orders patrols differently from gokapp (besides shared places for exact ties). */
	rankingDiffs: string[];
	skipped: string[];
}

const slugify = (s: string) =>
	s
		.toLowerCase()
		.replace(/[åä]/g, 'a')
		.replace(/ö/g, 'o')
		.replace(/[éè]/g, 'e')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');

interface Built {
	items: Map<number, ScoreItemDef>;
	trackOf: Map<number, number[]>;
	scores: { patrol: number; station: number; points: number; style: number; raw: { value: number; style: number | null }; at: Date | null }[];
}

/** Everything that does not need a database: mapping, validation, ranking parity, the summary. */
export function plan(data: GokappData, opts: Pick<ImportOptions, 'series' | 'year' | 'date' | 'name' | 'slug' | 'withTimes'> & { seriesName: string }): { plan: ImportPlan; built: Built } {
	const skipped: string[] = [];
	const items = new Map<number, ScoreItemDef>();
	for (const s of data.stations) {
		const shape = itemFromStation(s);
		items.set(s.id, { id: String(s.id), name: s.stationname || `Kontroll ${s.stationnumber}`, ...shape, distinctValues: shape.distinctValues ?? undefined });
	}
	const trackOf = new Map<number, number[]>();
	for (const l of data.stationTracks) trackOf.set(l.station_id, [...(trackOf.get(l.station_id) ?? []), l.tracks_id]);

	const patrolNos = new Set(data.patrols.map((p) => p.patrolid));
	const offRule: ImportPlan['offRule'] = [];
	const scores: Built['scores'] = [];
	// One score per patrol and station: if an old database has duplicates, the last saved wins.
	const latest = new Map<string, GokappData['scores'][number]>();
	for (const s of data.scores) {
		const k = `${s.patrol_id}|${s.station_id}`;
		const prev = latest.get(k);
		if (prev) skipped.push(`dubblett: patrull ${s.patrol_id}, station-id ${s.station_id} (den senast sparade används)`);
		if (!prev || (s.last_saved?.getTime() ?? 0) >= (prev.last_saved?.getTime() ?? 0)) latest.set(k, s);
	}
	for (const s of latest.values()) {
		const item = items.get(s.station_id);
		if (!item || !patrolNos.has(s.patrol_id)) {
			skipped.push(`poäng för patrull ${s.patrol_id} på station-id ${s.station_id} saknar patrull eller kontroll`);
			continue;
		}
		if (item.mode === 'CHECKIN' && !s.visited_waypoint) continue; // never visited: no row in gokapp's sense
		const raw = { value: item.mode === 'CHECKIN' ? 1 : s.score_point, style: item.styleEnabled ? s.style_point : null };
		let points = item.mode === 'CHECKIN' ? 0 : s.score_point;
		let style = item.styleEnabled ? s.style_point : 0;
		try {
			const v = evaluate(item, raw);
			points = v.points;
			style = v.stylePoints;
		} catch (e) {
			if (!(e instanceof InvalidScoreError)) throw e;
			offRule.push({ patrol: s.patrol_id, station: item.name, points, style, why: e.message });
		}
		scores.push({ patrol: s.patrol_id, station: s.station_id, points, style, raw, at: opts.withTimes ? s.last_saved : null });
	}

	// Ranking: ours against gokapp's comparator, per class.
	const oracleStations = new Map(data.stations.map((s) => [String(s.id), { max: s.maxscore, waypoint: !!s.waypoint }]));
	const gokapp = gokappComparator(scores.map((s) => ({ patrolId: String(s.patrol), stationId: String(s.station), points: s.points, style: s.style })), oracleStations);
	const rankingDiffs: string[] = [];
	const classes: ImportPlan['classes'] = [];
	for (const t of data.tracks) {
		const pats = data.patrols.filter((p) => p.fk_track === t.id && p.status !== 'RESIGNED');
		const ranked = rank(
			pats.map((p) => ({
				id: String(p.patrolid), number: p.patrolid,
				scores: scores.filter((s) => s.patrol === p.patrolid).map((s) => ({ itemId: String(s.station), points: s.points, stylePoints: s.style }))
			})),
			[...items.entries()].filter(([sid]) => { const st = data.stations.find((x) => x.id === sid)!; return st.alltracks || (trackOf.get(sid) ?? []).includes(t.id); }).map(([, it]) => it)
		);
		const place = new Map(ranked.map((r) => [r.id, r.place]));
		const order = pats.map((p) => String(p.patrolid)).sort(gokapp);
		for (let i = 1; i < order.length; i++) {
			const [a, b] = [order[i - 1], order[i]];
			const ok = gokapp(a, b) === 0 ? place.get(a) === place.get(b) : place.get(a)! < place.get(b)!;
			if (!ok) rankingDiffs.push(`${t.name ?? t.id}: ${a} före ${b} i gokapp, plats ${place.get(a)} och ${place.get(b)} här`);
		}
		const byNo = new Map(data.patrols.map((p) => [String(p.patrolid), p]));
		classes.push({
			name: t.name || `Klass ${t.id}`, patrols: data.patrols.filter((p) => p.fk_track === t.id).length,
			podium: ranked.filter((r) => r.place <= 3).map((r) => ({ place: r.place, number: r.number, name: byNo.get(r.id)?.patrolname ?? '', total: r.total }))
		});
	}
	const noClass = data.patrols.filter((p) => p.fk_track === null || !data.tracks.some((t) => t.id === p.fk_track)).length;
	if (noClass) skipped.push(`${noClass} patruller utan klass importeras utan klass (syns inte i resultaten)`);

	const guessed = guessDate(data.scores.map((s) => s.last_saved));
	const date = opts.date ?? guessed;
	const name = opts.name ?? `${opts.seriesName} ${opts.year}`;
	return {
		plan: {
			name, slug: opts.slug ?? `${opts.series}-${opts.year}`, date, dateGuessed: !opts.date,
			classes, stations: data.stations.length, patrols: data.patrols.length, scores: scores.length,
			timedScores: scores.filter((s) => s.at).length, offRule, rankingDiffs, skipped
		},
		built: { items, trackOf, scores }
	};
}

/** Writes the archived edition in one transaction. Throws (nothing written) on any conflict. */
export async function writeImport(sqlClient: postgres.Sql, data: GokappData, opts: ImportOptions) {
	const db = drizzle(sqlClient, { schema });
	return db.transaction(async (tx) => {
		const [owner] = await tx.select().from(schema.appUser).where(eq(schema.appUser.memberNo, opts.ownerMemberNo)).limit(1);
		if (!owner) throw new Error(`Ingen användare med medlemsnummer ${opts.ownerMemberNo}. Personen måste ha loggat in en gång.`);

		let [series] = await tx.select().from(schema.series).where(eq(schema.series.slug, opts.series)).limit(1);
		if (!series) {
			if (!opts.seriesName) throw new Error(`Serien "${opts.series}" finns inte. Ange --series-name för att skapa den.`);
			if (slugify(opts.series) !== opts.series) throw new Error(`Serieadressen får bara ha a–z, 0–9 och bindestreck (t.ex. ${slugify(opts.seriesName)}).`);
			const [clash] = await tx.select({ id: schema.competition.id }).from(schema.competition).where(eq(schema.competition.slug, opts.series)).limit(1);
			if (clash) throw new Error(`Adressen ${opts.series} används redan av en tävling.`);
			[series] = await tx.insert(schema.series).values({ slug: opts.series, name: opts.seriesName, createdBy: owner.id }).returning();
			await tx.insert(schema.seriesMember).values({ seriesId: series.id, userId: owner.id, role: 'owner' });
		}
		const { plan: p, built } = plan(data, { ...opts, seriesName: series.name });
		if (!p.date || !/^\d{4}-\d{2}-\d{2}$/.test(p.date)) throw new Error('Inget datum: ange --date ÅÅÅÅ-MM-DD.');
		const [slugTaken] = await tx.select({ id: schema.competition.id }).from(schema.competition).where(eq(schema.competition.slug, p.slug)).limit(1);
		const [seriesSlug] = await tx.select({ id: schema.series.id }).from(schema.series).where(eq(schema.series.slug, p.slug)).limit(1);
		if (slugTaken || seriesSlug) throw new Error(`Adressen ${p.slug} är upptagen. Välj en annan med --slug.`);
		const [sameYear] = await tx
			.select({ slug: schema.competition.slug })
			.from(schema.competition)
			.where(and(eq(schema.competition.seriesId, series.id), eq(schema.competition.editionYear, opts.year)))
			.limit(1);
		if (sameYear) throw new Error(`Serien har redan ett år ${opts.year} (${sameYear.slug}).`);

		const styleEnabled = data.stations.some((s) => s.maxstylescore > 0 && !s.waypoint);
		const [comp] = await tx
			.insert(schema.competition)
			.values({
				slug: p.slug, name: p.name, ownerGroupNo: series.ownerGroupNo, ownerGroupName: series.ownerGroupName,
				startDate: p.date, endDate: p.date, styleEnabled, publicResults: true, status: 'closed', registrationOpen: false,
				patrolCodeKey: randomBytes(24).toString('base64url'), createdBy: owner.id, seriesId: series.id, editionYear: opts.year,
				archivePublic: true, anonymisedAt: new Date()
			})
			.returning();
		await tx.insert(schema.competitionMember).values({ competitionId: comp.id, userId: owner.id, role: 'owner' });

		const trackIds = new Map<number, string>();
		for (const [i, t] of data.tracks.entries()) {
			const [row] = await tx.insert(schema.track).values({ competitionId: comp.id, name: t.name || `Klass ${t.id}`, sort: i + 1 }).returning();
			trackIds.set(t.id, row.id);
		}
		const itemIds = new Map<number, string>();
		for (const [i, s] of data.stations.entries()) {
			const it = built.items.get(s.id)!;
			const [st] = await tx
				.insert(schema.station)
				.values({ competitionId: comp.id, sort: i + 1, name: it.name, allTracks: s.alltracks })
				.returning();
			if (!s.alltracks) {
				const links = (built.trackOf.get(s.id) ?? []).map((t) => trackIds.get(t)).filter((x): x is string => !!x);
				if (links.length) await tx.insert(schema.stationTrack).values(links.map((trackId) => ({ stationId: st.id, trackId })));
			}
			const [row] = await tx
				.insert(schema.scoreItem)
				.values({
					stationId: st.id, sort: 1, name: it.name, mode: it.mode, min: it.min, max: it.max, distinctValues: it.distinctValues ?? null,
					styleEnabled: it.styleEnabled, styleMin: it.styleMin, styleMax: it.styleMax, countsForTiebreak: it.countsForTiebreak
				})
				.returning();
			itemIds.set(s.id, row.id);
		}
		const patrolIds = new Map<number, string>();
		for (const pt of data.patrols) {
			const [row] = await tx
				.insert(schema.patrol)
				.values({
					competitionId: comp.id, number: pt.patrolid, name: pt.patrolname || `Patrull ${pt.patrolid}`, troop: pt.troop ?? '',
					trackId: pt.fk_track !== null ? (trackIds.get(pt.fk_track) ?? null) : null, status: statusFromGokapp(pt.status)
				})
				.returning();
			patrolIds.set(pt.patrolid, row.id);
		}
		for (const s of built.scores) {
			const at = s.at ?? new Date(`${p.date}T12:00:00Z`);
			const [sc] = await tx
				.insert(schema.score)
				.values({
					competitionId: comp.id, patrolId: patrolIds.get(s.patrol)!, itemId: itemIds.get(s.station)!, points: s.points, stylePoints: s.style,
					raw: s.raw, origin: 'admin', scoredAt: s.at, updatedAt: at
				})
				.returning({ id: schema.score.id });
			await tx.insert(schema.scoreRevision).values({ scoreId: sc.id, version: 1, points: s.points, stylePoints: s.style, state: 'active', origin: 'admin', reason: 'Importerad från gokapp', at });
		}
		await tx.insert(schema.auditLog).values({
			actorUserId: null, actorKind: 'cli', action: 'competition.import_gokapp', targetType: 'competition', targetId: comp.id,
			competitionId: comp.id, seriesId: series.id, reason: null,
			details: { by: opts.operator, patrols: p.patrols, scores: p.scores, timed: p.timedScores }
		});
		return { slug: comp.slug, series: series.slug, plan: p };
	});
}

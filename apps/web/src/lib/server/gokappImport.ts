/**
 * Import an old gokapp year into the archive (docs/architecture/02 §9, 05 §5). Used by the
 * `gokapp:import` CLI; no SvelteKit imports, so it runs from the production image.
 *
 * Privacy (04 §8): only what an archived edition keeps is ever READ from gokapp: station
 * definitions, classes, patrol number/name/kår/class/status and the scores. Members, contacts,
 * notes, start/end strings, external ids, payments, users and messages are never selected
 * (FIELDS below is the complete list, for every gokapp version; a unit test checks it). The edition is created already
 * archived (`anonymised_at` set), so it is read-only and public in the series archive.
 */
import { randomBytes } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import { and, eq } from 'drizzle-orm';
import type postgres from 'postgres';
import {
	evaluate,
	gokappComparator,
	competitionDays,
	daysBetween,
	fromWallClock,
	guessDate,
	swedishDate,
	InvalidScoreError,
	itemFromStation,
	rank,
	statusFromGokapp,
	type GokappStation,
	type GokappStatus,
	type ScoreItemDef
} from '@scouttavling/domain';
import * as schema from './db/schema.ts';
import { isReservedSlug } from '../routing/slugs.ts';

/**
 * What the importer may read, per table: field → the column names it has had across gokapp
 * versions (2023: trackid/trackname, fk_patrol, scorepoint, lastSaved …; later: id/name,
 * patrol_id, score_point, last_saved …). Nothing outside these lists is ever selected.
 * `optional` fields fall back to gokapp's old behaviour when the column does not exist yet.
 */
export const FIELDS = {
	config: { name: { cols: ['name'], optional: true } },
	track: { id: { cols: ['id', 'trackid'] }, name: { cols: ['name', 'trackname'] } },
	station: {
		id: { cols: ['id', 'stationid'] },
		stationnumber: { cols: ['stationnumber'] },
		stationname: { cols: ['stationname'] },
		alltracks: { cols: ['alltracks'], optional: true },
		minscore: { cols: ['minscore'] },
		maxscore: { cols: ['maxscore'] },
		minstylescore: { cols: ['minstylescore'] },
		maxstylescore: { cols: ['maxstylescore'] },
		waypoint: { cols: ['waypoint'] },
		usedistinctscores: { cols: ['usedistinctscores'], optional: true },
		distinctscores: { cols: ['distinctscores'], optional: true }
	},
	station_track: { station_id: { cols: ['station_id', 'stations_id', 'fk_station'] }, tracks_id: { cols: ['tracks_id', 'track_id', 'fk_track'] } },
	patrol: {
		patrolid: { cols: ['patrolid'] },
		patrolname: { cols: ['patrolname'] },
		troop: { cols: ['troop'] },
		fk_track: { cols: ['fk_track', 'track_id'] },
		status: { cols: ['status'] }
	},
	score: {
		patrol_id: { cols: ['patrol_id', 'fk_patrol'] },
		station_id: { cols: ['station_id', 'fk_station'] },
		score_point: { cols: ['score_point', 'scorepoint'] },
		style_point: { cols: ['style_point', 'stylepoint'] },
		visited_waypoint: { cols: ['visited_waypoint', 'visitedwaypoint'] },
		last_saved: { cols: ['last_saved', 'lastsaved'], optional: true }
	}
} as const satisfies Record<string, Record<string, { cols: readonly string[]; optional?: boolean }>>;

/** Columns that hold personal data in gokapp (any version). No FIELDS list may contain them. */
export const NEVER_READ = ['members', 'leadercontact', 'contactmail', 'leadercontactphone', 'note', 'externalid', 'starttime', 'endtime', 'date_registered', 'paid', 'stationcontact', 'stationphone', 'stationuser', 'user_id', 'users', 'usermessage', 'message_read', 'password', 'username'];

/** The only query that is not a data read: column names of the current database (structure). */
export const COLUMNS_QUERY = 'SELECT table_name AS t, column_name AS c FROM information_schema.columns WHERE table_schema = DATABASE()';

type Table = keyof typeof FIELDS;
const ORDER: Partial<Record<Table, string>> = { track: 'id', station: 'stationnumber, id', patrol: 'patrolid' };

/** SELECTs for the tables that exist, aliasing whatever each version calls a field. */
export function buildReads(columns: { t: string; c: string }[]): Partial<Record<Table, string>> {
	const have = new Map<string, Map<string, string>>();
	for (const { t, c } of columns) {
		const m = have.get(t.toLowerCase()) ?? new Map<string, string>();
		m.set(c.toLowerCase(), c);
		have.set(t.toLowerCase(), m);
	}
	const reads: Partial<Record<Table, string>> = {};
	for (const [table, fields] of Object.entries(FIELDS) as [Table, Record<string, { cols: readonly string[]; optional?: boolean }>][]) {
		const cols = have.get(table);
		if (!cols) {
			if (table === 'station_track' || table === 'config') continue; // older gokapp: every station applies to every class
			throw new Error(`gokapp-tabellen "${table}" saknas. Är det rätt databas?`);
		}
		const parts: string[] = [];
		for (const [field, { cols: names, optional }] of Object.entries(fields)) {
			const found = names.map((n) => cols.get(n)).find(Boolean);
			if (found) parts.push(`\`${found}\` AS \`${field}\``);
			else if (!optional) throw new Error(`Kolumnen ${table}.${field} hittades inte (letade efter ${names.join(', ')}).`);
		}
		reads[table] = `SELECT ${parts.join(', ')} FROM \`${table}\`${ORDER[table] ? ` ORDER BY ${ORDER[table]}` : ''}${table === 'config' ? ' LIMIT 1' : ''}`;
	}
	return reads;
}

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
	const q = async <T>(sql: string | undefined) => (sql ? ((await conn.query(sql))[0] as T[]) : []);
	const reads = buildReads(await q<{ t: string; c: string }>(COLUMNS_QUERY));
	const [config, tracks, stations, stationTracks, patrols, scores] = await Promise.all([
		q<{ name: string | null }>(reads.config),
		q<Record<string, unknown>>(reads.track),
		q<Record<string, unknown>>(reads.station),
		q<Record<string, unknown>>(reads.station_track),
		q<Record<string, unknown>>(reads.patrol),
		q<Record<string, unknown>>(reads.score)
	]);
	return {
		configName: config[0]?.name ?? null,
		tracks: tracks.map((t) => ({ id: Number(t.id), name: (t.name as string | null) ?? null })),
		// MySQL BIT(1) columns arrive as Buffers.
		stations: stations.map((s) => ({
			id: Number(s.id), stationnumber: Number(s.stationnumber), stationname: (s.stationname as string | null) ?? null,
			alltracks: bool(s.alltracks) ?? true, minscore: Number(s.minscore ?? 0), maxscore: Number(s.maxscore ?? 0),
			minstylescore: Number(s.minstylescore ?? 0), maxstylescore: Number(s.maxstylescore ?? 0),
			waypoint: bool(s.waypoint), usedistinctscores: bool(s.usedistinctscores), distinctscores: (s.distinctscores as string | null) ?? null
		})),
		stationTracks: stationTracks.map((l) => ({ station_id: Number(l.station_id), tracks_id: Number(l.tracks_id) })),
		patrols: patrols.map((p) => ({
			patrolid: Number(p.patrolid), patrolname: (p.patrolname as string | null) ?? null, troop: (p.troop as string | null) ?? null,
			fk_track: p.fk_track === null || p.fk_track === undefined ? null : Number(p.fk_track), status: (p.status as GokappStatus | null) ?? null
		})),
		scores: scores.map((s) => ({
			patrol_id: Number(s.patrol_id), station_id: Number(s.station_id), score_point: Number(s.score_point ?? 0), style_point: Number(s.style_point ?? 0),
			visited_waypoint: bool(s.visited_waypoint), last_saved: savedAt(s.last_saved)
		}))
	};
}

/** gokapp's LocalDateTime is Swedish wall-clock time; connect with `dateStrings: true` to get it unshifted. */
function savedAt(v: unknown): Date | null {
	if (v === null || v === undefined) return null;
	if (v instanceof Date) return v;
	return fromWallClock(String(v));
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
	/** First day (YYYY-MM-DD). */
	date: string | null;
	dateGuessed: boolean;
	/** All days for a multi-day competition (first to last), else just `date`. */
	days: string[];
	/** Station name → its day, for a multi-day competition. */
	stationDays: Record<string, string>;
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
	/** gokapp station id → YYYY-MM-DD (multi-day only). */
	stationDay: Map<number, string>;
}

const built_name = (st: GokappStation) => st.stationname || `Kontroll ${st.stationnumber}`;

/**
 * gokapp organisers often put the paper code in the name ("F1 Eldstaden", "L2 Knopar"): it becomes
 * the station's own code and the name keeps the rest. "Start"/"Mål" anywhere in the name gives the
 * day's start/finish role (codes FS/FM …).
 */
export function stationNaming(name: string): { name: string; code: string | null; role: 'start' | 'finish' | null } {
	const m = /^([A-ZÅÄÖ]{1,2}\d{1,2})\s+(.+)$/.exec(name.trim());
	const rest = m ? m[2].trim() : name.trim();
	const role = /(^|[^a-zåäö])start([^a-zåäö]|$)/i.test(rest) ? 'start' : /(^|[^a-zåäö])mål([^a-zåäö]|$)/i.test(rest) ? 'finish' : null;
	return { name: rest, code: m ? m[1] : null, role };
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

	// Days: --date forces one day; otherwise every date that holds a real share of the score saves.
	const saved = data.scores.map((s) => s.last_saved);
	const found = competitionDays(saved);
	const date = opts.date ?? found[0] ?? guessDate(saved);
	const days = opts.date || found.length < 2 ? (date ? [date] : []) : daysBetween(found[0], found.at(-1)!).map((d) => d.date);
	// A station belongs to the day most of its scores were saved on (gokapp had no days).
	const stationDay = new Map<number, string>();
	if (days.length > 1) {
		for (const st of data.stations) {
			const counts = new Map<string, number>();
			for (const sc of data.scores) if (sc.station_id === st.id && sc.last_saved) counts.set(swedishDate(sc.last_saved), (counts.get(swedishDate(sc.last_saved)) ?? 0) + 1);
			const best = [...counts].filter(([d]) => days.includes(d)).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
			stationDay.set(st.id, best ?? days[0]);
		}
	}
	const name = opts.name ?? `${opts.seriesName} ${opts.year}`;
	return {
		plan: {
			name, slug: opts.slug ?? `${opts.series}-${opts.year}`, date, dateGuessed: !opts.date, days,
			stationDays: Object.fromEntries(data.stations.filter((st) => stationDay.has(st.id)).map((st) => [built_name(st), stationDay.get(st.id)!])),
			classes, stations: data.stations.length, patrols: data.patrols.length, scores: scores.length,
			timedScores: scores.filter((s) => s.at).length, offRule, rankingDiffs, skipped
		},
		built: { items, trackOf, scores, stationDay }
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
			if (isReservedSlug(opts.series)) throw new Error(`Adressen ${opts.series} är reserverad. Välj en annan serieadress.`);
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
		if (slugTaken || seriesSlug || isReservedSlug(p.slug)) throw new Error(`Adressen ${p.slug} är upptagen eller reserverad. Välj en annan med --slug.`);
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
				startDate: p.days[0], endDate: p.days.at(-1)!, multiDay: p.days.length > 1, styleEnabled, publicResults: true, status: 'closed', registrationOpen: false,
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
		const dayIds = new Map<string, string>();
		if (p.days.length > 1) {
			for (const [i, d] of daysBetween(p.days[0], p.days.at(-1)!).entries()) {
				const [row] = await tx.insert(schema.day).values({ competitionId: comp.id, date: d.date, name: d.name, prefix: d.prefix, sort: i + 1 }).returning();
				dayIds.set(d.date, row.id);
			}
		}
		const itemIds = new Map<number, string>();
		for (const [i, s] of data.stations.entries()) {
			const it = built.items.get(s.id)!;
			const [st] = await tx
				.insert(schema.station)
				.values({
					competitionId: comp.id, sort: i + 1, ...(({ name, code, role }) => ({ name, customCode: code, role }))(stationNaming(it.name)),
					allTracks: s.alltracks, dayId: dayIds.get(built.stationDay.get(s.id) ?? '') ?? null
				})
				.returning();
			if (!s.alltracks) {
				const links = (built.trackOf.get(s.id) ?? []).map((t) => trackIds.get(t)).filter((x): x is string => !!x);
				if (links.length) await tx.insert(schema.stationTrack).values(links.map((trackId) => ({ stationId: st.id, trackId })));
			}
			const [row] = await tx
				.insert(schema.scoreItem)
				.values({
					stationId: st.id, sort: 1, name: stationNaming(it.name).name, mode: it.mode, min: it.min, max: it.max, distinctValues: it.distinctValues ?? null,
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

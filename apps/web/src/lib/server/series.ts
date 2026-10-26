import { error, type RequestEvent } from '@sveltejs/kit';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from './db/index.ts';
import { randomToken, requireUser, type CompetitionRole } from './auth.ts';
import { recordChange } from './changes.ts';
import { copyAssets } from './assetStore.ts';
import { loadTrackColors } from './assets.ts';
import { getResults } from './live.ts';
import { activeInvites, rotateInvite } from '../../routes/admin/[slug]/invites/inviteCrypto.server.ts';
import { addDays, editionShiftDays, shiftDate } from '#lib/series/dates.ts';
import { slugify } from '#lib/ui/admin/format.ts';
import { seriesRole } from './ownership.ts';

/**
 * Competition series and yearly editions (docs/architecture/05-series-and-archive.md).
 *
 * Permissions, kept simple: a user organises a series when they are owner or organiser of ANY of
 * its editions. There is no separate series membership table.
 */

export type SeriesRow = typeof schema.series.$inferSelect;
export type CompRow = typeof schema.competition.$inferSelect;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const YEAR = /\b(19|20)\d{2}\b/g;

/** "GökOpen 2027" → "GökOpen". */
export function stripYear(name: string): string {
	return name.replace(YEAR, '').replace(/\s+/g, ' ').trim() || name.trim();
}

/** The year in a name ("GökOpen 2027" → 2027), else null. */
export function yearIn(name: string): number | null {
	const m = /\b((?:19|20)\d{2})\b/.exec(name);
	return m ? Number(m[1]) : null;
}

/** A free slug that is neither a series nor a competition slug. */
async function freeSlug(q: typeof db | Tx, base: string, suffix: string): Promise<string> {
	const root = slugify(base) || 'serie';
	for (let i = 1; i < 100; i++) {
		const cand = i === 1 ? root : `${root}${suffix}${i > 2 ? `-${i}` : ''}`;
		const [a] = await q.select({ id: schema.series.id }).from(schema.series).where(eq(schema.series.slug, cand)).limit(1);
		const [b] = await q.select({ id: schema.competition.id }).from(schema.competition).where(eq(schema.competition.slug, cand)).limit(1);
		if (!a && !b) return cand;
	}
	return `${root}-${randomToken(3).toLowerCase()}`;
}

export async function seriesBySlug(slug: string): Promise<SeriesRow | null> {
	const [s] = await db.select().from(schema.series).where(eq(schema.series.slug, slug)).limit(1);
	return s ?? null;
}

/** Editions of a series, newest first. */
export async function editionsOf(seriesId: string): Promise<CompRow[]> {
	return db
		.select()
		.from(schema.competition)
		.where(eq(schema.competition.seriesId, seriesId))
		.orderBy(desc(schema.competition.editionYear), desc(schema.competition.startDate));
}

/**
 * Loads a series and checks the user is owner/organiser of one of its editions, or a member of the
 * series itself (series_member, managed in "Ägare och arrangörer"). `seriesRole` is the latter.
 */
export async function requireSeries(event: RequestEvent, slug: string, roles: CompetitionRole[] = ['owner', 'organiser']) {
	const user = requireUser(event);
	const s = await seriesBySlug(slug);
	if (!s) error(404, 'Serien finns inte');
	const [m] = await db
		.select({ role: schema.competitionMember.role })
		.from(schema.competitionMember)
		.innerJoin(schema.competition, eq(schema.competition.id, schema.competitionMember.competitionId))
		.where(and(eq(schema.competition.seriesId, s.id), eq(schema.competitionMember.userId, user.id), inArray(schema.competitionMember.role, roles)))
		.limit(1);
	const own = await seriesRole(s.id, user.id);
	if (!m && !own) error(403, 'Du har inte behörighet till den här serien');
	return { user, series: s, seriesRole: own };
}

/**
 * The source edition for "Skapa <serie> <år+1>": the user must be owner/organiser of it. The source
 * is only read, so an archived (read-only) edition is a valid source; requireCompetition would
 * refuse its POST with 409.
 */
export async function requireNextEditionSource(event: RequestEvent, slug: string) {
	const user = requireUser(event);
	const [comp] = await db.select().from(schema.competition).where(eq(schema.competition.slug, slug)).limit(1);
	if (!comp) error(404, 'Tävlingen finns inte');
	if (!(await organisesEdition(user.id, comp.id))) error(403, 'Du har inte behörighet till den här tävlingen');
	return { user, comp };
}

/** The user is owner or organiser of this edition. */
export async function organisesEdition(userId: string, competitionId: string): Promise<boolean> {
	const [m] = await db
		.select({ role: schema.competitionMember.role })
		.from(schema.competitionMember)
		.where(and(eq(schema.competitionMember.competitionId, competitionId), eq(schema.competitionMember.userId, userId), inArray(schema.competitionMember.role, ['owner', 'organiser'])))
		.limit(1);
	return !!m;
}

/** Series the user organises (owner/organiser of any edition), by name. */
export async function organisedSeries(userId: string): Promise<SeriesRow[]> {
	const ids = db
		.selectDistinct({ id: schema.competition.seriesId })
		.from(schema.competition)
		.innerJoin(schema.competitionMember, eq(schema.competitionMember.competitionId, schema.competition.id))
		.where(and(eq(schema.competitionMember.userId, userId), inArray(schema.competitionMember.role, ['owner', 'organiser'])));
	return db.select().from(schema.series).where(inArray(schema.series.id, ids)).orderBy(asc(schema.series.name));
}

/** True when a series or a competition already uses `slug` (both live under /t/<slug>). */
export async function slugTaken(slug: string): Promise<boolean> {
	const [a] = await db.select({ id: schema.series.id }).from(schema.series).where(eq(schema.series.slug, slug)).limit(1);
	if (a) return true;
	const [b] = await db.select({ id: schema.competition.id }).from(schema.competition).where(eq(schema.competition.slug, slug)).limit(1);
	return !!b;
}

/** Patrol counts per competition id. */
export async function patrolCounts(ids: string[]): Promise<Map<string, number>> {
	if (!ids.length) return new Map();
	const rows = await db
		.select({ id: schema.patrol.competitionId, n: sql<number>`count(*)::int` })
		.from(schema.patrol)
		.where(and(inArray(schema.patrol.competitionId, ids), sql`${schema.patrol.status} <> 'resigned'`))
		.groupBy(schema.patrol.competitionId);
	return new Map(rows.map((r) => [r.id, r.n]));
}

/**
 * Makes sure a competition belongs to a series, creating one from its year-stripped name when it is
 * a one-off. A new series takes over the competition's branding (copied; the edition keeps its own).
 */
export async function ensureSeries(tx: Tx, comp: CompRow, userId: string): Promise<SeriesRow> {
	if (comp.seriesId) {
		const [s] = await tx.select().from(schema.series).where(eq(schema.series.id, comp.seriesId)).limit(1);
		if (s) return s;
	}
	const name = stripYear(comp.name);
	const tracks = await tx.select().from(schema.track).where(eq(schema.track.competitionId, comp.id));
	const [s] = await tx
		.insert(schema.series)
		.values({
			slug: await freeSlug(tx, name, '-serie'), name, ownerGroupNo: comp.ownerGroupNo, ownerGroupName: comp.ownerGroupName,
			accentColor: comp.accentColor, coverFit: comp.coverFit,
			classColors: Object.fromEntries(tracks.filter((t) => t.color).map((t) => [t.name, t.color!])), createdBy: userId
		})
		.returning();
	await copyAssets(tx, { competitionId: comp.id }, { seriesId: s.id });
	await tx
		.update(schema.competition)
		.set({ seriesId: s.id, editionYear: comp.editionYear ?? yearIn(comp.name) ?? Number(comp.startDate.slice(0, 4)) })
		.where(eq(schema.competition.id, comp.id));
	return s;
}

// ---------------------------------------------------------------- next edition

export interface NextPlan {
	seriesName: string;
	year: number;
	name: string;
	slug: string;
	shift: number;
	multiDay: boolean;
	/** One row per day (multi-day) or the single date. */
	days: { sort: number; name: string; from: string; date: string }[];
	registrationOpensOn: string | null;
	registrationClosesOn: string | null;
	counts: { stations: number; items: number; tracks: number; invites: number };
	/** An edition of that year already exists. */
	existing: { slug: string; name: string } | null;
}

export const editionYearOf = (c: Pick<CompRow, 'editionYear' | 'name' | 'startDate'>) => c.editionYear ?? yearIn(c.name) ?? Number(c.startDate.slice(0, 4));

/** What "Skapa <serie> <år+1>" would create from `source` (nothing is written). */
export async function planNextEdition(source: CompRow): Promise<NextPlan> {
	const series = source.seriesId ? (await db.select().from(schema.series).where(eq(schema.series.id, source.seriesId)).limit(1))[0] ?? null : null;
	const seriesName = series?.name ?? stripYear(source.name);
	const year = editionYearOf(source) + 1;
	const shift = editionShiftDays(source.startDate, 1);
	const [days, [{ stations }], [{ items }], [{ tracks }], invites] = await Promise.all([
		db.select().from(schema.day).where(eq(schema.day.competitionId, source.id)).orderBy(asc(schema.day.sort)),
		db.select({ stations: sql<number>`count(*)::int` }).from(schema.station).where(eq(schema.station.competitionId, source.id)),
		db
			.select({ items: sql<number>`count(*)::int` })
			.from(schema.scoreItem)
			.innerJoin(schema.station, eq(schema.station.id, schema.scoreItem.stationId))
			.where(eq(schema.station.competitionId, source.id)),
		db.select({ tracks: sql<number>`count(*)::int` }).from(schema.track).where(eq(schema.track.competitionId, source.id)),
		activeInvites(source.id)
	]);
	let existing: NextPlan['existing'] = null;
	if (series) {
		const [e] = await db
			.select({ slug: schema.competition.slug, name: schema.competition.name })
			.from(schema.competition)
			.where(and(eq(schema.competition.seriesId, series.id), eq(schema.competition.editionYear, year)))
			.limit(1);
		existing = e ?? null;
	}
	const root = slugify(`${series?.slug ?? seriesName}-${year}`);
	let slug = root;
	for (let i = 2; i < 50; i++) {
		const [t] = await db.select({ id: schema.competition.id }).from(schema.competition).where(eq(schema.competition.slug, slug)).limit(1);
		const [u] = await db.select({ id: schema.series.id }).from(schema.series).where(eq(schema.series.slug, slug)).limit(1);
		if (!t && !u) break;
		slug = `${root}-${i}`;
	}
	return {
		seriesName, year, name: `${seriesName} ${year}`, slug, shift, multiDay: source.multiDay,
		days: source.multiDay
			? days.map((d) => ({ sort: d.sort, name: d.name, from: d.date, date: addDays(d.date, shift) }))
			: [{ sort: 1, name: '', from: source.startDate, date: addDays(source.startDate, shift) }],
		registrationOpensOn: shiftDate(source.registrationOpensOn, shift),
		registrationClosesOn: shiftDate(source.registrationClosesOn, shift),
		counts: { stations, items, tracks, invites: invites.size },
		existing
	};
}

export interface NextInput {
	name: string;
	slug: string;
	/** Dates in day order (one for a single-day competition). */
	dates: string[];
	registrationOpensOn: string | null;
	registrationClosesOn: string | null;
}

/**
 * Creates the next edition from `source`. Copies days, classes, stations (roles, class limits) and
 * their items, score settings, registration settings (registration closed) and the invite structure
 * with NEW secrets. Never copies patrols, members, scores, devices, messages or contacts
 * (station contacts, HQ phone). Branding is not copied: the new edition inherits the series.
 */
export async function createNextEdition(source: CompRow, input: NextInput, userId: string): Promise<CompRow> {
	return db.transaction(async (tx) => {
		const series = await ensureSeries(tx, source, userId);
		const year = editionYearOf(source) + 1;
		const dates = [...input.dates];
		const [comp] = await tx
			.insert(schema.competition)
			.values({
				slug: input.slug, name: input.name, ownerGroupNo: source.ownerGroupNo, ownerGroupName: source.ownerGroupName,
				multiDay: source.multiDay, startDate: dates[0], endDate: dates.at(-1)!, location: source.location,
				styleEnabled: source.styleEnabled, publicResults: source.publicResults,
				registrationOpen: false, registrationOpensOn: input.registrationOpensOn, registrationClosesOn: input.registrationClosesOn,
				maxPatrols: source.maxPatrols, infoText: source.infoText, confirmationText: source.confirmationText,
				followEnabled: source.followEnabled, followShowScores: source.followShowScores,
				status: 'draft', patrolCodeKey: randomToken(24), createdBy: userId,
				seriesId: series.id, editionYear: year, archivePublic: true
			})
			.returning();

		// The organising team carries over (owners/organisers); day-of roles do not.
		const team = await tx
			.select()
			.from(schema.competitionMember)
			.where(and(eq(schema.competitionMember.competitionId, source.id), inArray(schema.competitionMember.role, ['owner', 'organiser'])));
		const rows = new Map(team.map((m) => [`${m.userId}:${m.role}`, { competitionId: comp.id, userId: m.userId, role: m.role }]));
		rows.set(`${userId}:owner`, { competitionId: comp.id, userId, role: 'owner' });
		if (team.some((m) => m.userId === userId && m.role === 'organiser')) rows.delete(`${userId}:organiser`);
		await tx.insert(schema.competitionMember).values([...rows.values()]);

		const srcDays = await tx.select().from(schema.day).where(eq(schema.day.competitionId, source.id)).orderBy(asc(schema.day.sort));
		const dayMap = new Map<string, string>();
		for (const [i, d] of srcDays.entries()) {
			const [nd] = await tx
				.insert(schema.day)
				.values({ competitionId: comp.id, date: dates[i] ?? addDays(d.date, 365), name: d.name, prefix: d.prefix, sort: d.sort })
				.returning({ id: schema.day.id });
			dayMap.set(d.id, nd.id);
		}

		const srcTracks = await tx.select().from(schema.track).where(eq(schema.track.competitionId, source.id)).orderBy(asc(schema.track.sort));
		const trackMap = new Map<string, string>();
		for (const t of srcTracks) {
			const [nt] = await tx.insert(schema.track).values({ competitionId: comp.id, name: t.name, sort: t.sort, color: t.color }).returning({ id: schema.track.id });
			trackMap.set(t.id, nt.id);
		}

		const srcStations = await tx.select().from(schema.station).where(eq(schema.station.competitionId, source.id)).orderBy(asc(schema.station.sort));
		const stationMap = new Map<string, string>();
		for (const s of srcStations) {
			const [ns] = await tx
				.insert(schema.station)
				.values({
					competitionId: comp.id, dayId: s.dayId ? (dayMap.get(s.dayId) ?? null) : null, sort: s.sort, name: s.name, customCode: s.customCode,
					allTracks: s.allTracks, role: s.role, startable: s.startable
					// contactName / contactPhone: personal, never copied.
				})
				.returning({ id: schema.station.id });
			stationMap.set(s.id, ns.id);
		}
		if (srcStations.length) {
			const links = await tx.select().from(schema.stationTrack).where(inArray(schema.stationTrack.stationId, srcStations.map((s) => s.id)));
			const vals = links.flatMap((l) => (stationMap.has(l.stationId) && trackMap.has(l.trackId) ? [{ stationId: stationMap.get(l.stationId)!, trackId: trackMap.get(l.trackId)! }] : []));
			if (vals.length) await tx.insert(schema.stationTrack).values(vals);
			const items = await tx.select().from(schema.scoreItem).where(inArray(schema.scoreItem.stationId, srcStations.map((s) => s.id)));
			if (items.length) {
				await tx.insert(schema.scoreItem).values(
					items.map(({ id: _id, stationId, ...rest }) => ({ ...rest, stationId: stationMap.get(stationId)! }))
				);
			}
		}

		// Invite structure: one fresh invite (new secret) per target that had an active one.
		const invites = await activeInvites(source.id);
		for (const inv of invites.values()) {
			const target = inv.stationId ? stationMap.get(inv.stationId) : null;
			if (inv.stationId && !target) continue;
			await rotateInvite(tx, comp, target ?? null);
		}

		await recordChange(tx, comp.id, 'competition', comp.id);
		return comp;
	});
}

// ---------------------------------------------------------------- public archive

export interface ArchiveWinner {
	track: string;
	color: string | null;
	patrols: { number: number; name: string; troop: string }[];
}

export interface ArchiveEdition {
	slug: string;
	name: string;
	year: number;
	startDate: string;
	endDate: string;
	location: string | null;
	patrols: number;
	/** /r/<slug> exists (results are public). */
	results: boolean;
	winners: ArchiveWinner[];
}

/**
 * The public series page data: the current/upcoming edition and "Tidigare år". Only closed
 * editions with archive_public are listed; winners only when that edition's results are public.
 * No personal data: patrol number, name and kår.
 */
export async function seriesArchive(series: SeriesRow) {
	const all = await editionsOf(series.id);
	const counts = await patrolCounts(all.map((c) => c.id));
	const current = all.find((c) => c.status !== 'closed' && c.status !== 'draft') ?? null;
	const past = all.filter((c) => c.status === 'closed' && c.archivePublic);
	const archive: ArchiveEdition[] = [];
	for (const c of past) {
		let winners: ArchiveWinner[] = [];
		if (c.publicResults) {
			const [{ tracks }, colors] = await Promise.all([getResults(c, 60_000), loadTrackColors(c.id)]);
			winners = tracks
				.map((t) => ({
					track: t.name,
					color: colors[t.trackId] ?? null,
					patrols: t.rows.filter((r) => r.place === 1 && r.total > 0).map((r) => ({ number: r.number, name: r.name, troop: r.troop }))
				}))
				.filter((w) => w.patrols.length);
		}
		archive.push({
			slug: c.slug, name: c.name, year: editionYearOf(c), startDate: c.startDate, endDate: c.endDate, location: c.location,
			patrols: counts.get(c.id) ?? 0, results: c.publicResults, winners
		});
	}
	return { current, currentPatrols: current ? (counts.get(current.id) ?? 0) : 0, archive };
}

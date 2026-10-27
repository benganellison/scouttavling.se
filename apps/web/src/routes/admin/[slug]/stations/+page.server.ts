import { fail, redirect } from '@sveltejs/kit';
import { and, asc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import * as v from 'valibot';
import { stationCodes, type ItemMode } from '@scouttavling/domain';
import { db, schema } from '#lib/server/db/index.ts';
import { requireCompetition } from '#lib/server/auth.ts';
import { recordChange } from '#lib/server/changes.ts';

const EDIT_ROLES = ['owner', 'organiser'] as const;

export async function load(event) {
	const { comp } = await requireCompetition(event, event.params.slug);
	const cid = comp.id;
	const stations = await db.select().from(schema.station).where(eq(schema.station.competitionId, cid)).orderBy(asc(schema.station.sort));
	const ids = stations.map((s) => s.id);
	const [items, links, invited, scoreCounts] = ids.length
		? await Promise.all([
				db.select().from(schema.scoreItem).where(inArray(schema.scoreItem.stationId, ids)).orderBy(asc(schema.scoreItem.sort)),
				db.select().from(schema.stationTrack).where(inArray(schema.stationTrack.stationId, ids)),
				db
					.selectDistinct({ stationId: schema.invite.stationId })
					.from(schema.invite)
					.where(and(eq(schema.invite.competitionId, cid), isNotNull(schema.invite.stationId))),
				db
					.select({ itemId: schema.score.itemId, n: sql<number>`count(*)::int` })
					.from(schema.score)
					.where(and(eq(schema.score.competitionId, cid), eq(schema.score.state, 'active')))
					.groupBy(schema.score.itemId)
			])
		: [[], [], [], []];
	const invitedSet = new Set(invited.map((i) => i.stationId));
	const scoresBy = new Map(scoreCounts.map((r) => [r.itemId, r.n]));
	return {
		stations: stations.map((s) => ({
			id: s.id,
			name: s.name,
			sort: s.sort,
			dayId: s.dayId,
			customCode: s.customCode,
			role: s.role,
			allTracks: s.allTracks,
			startable: s.startable,
			trackIds: links.filter((l) => l.stationId === s.id).map((l) => l.trackId),
			invited: invitedSet.has(s.id),
			items: items
				.filter((i) => i.stationId === s.id)
				.map((i) => ({
					id: i.id,
					name: i.name,
					mode: i.mode,
					min: i.min,
					max: i.max,
					distinctValues: i.distinctValues ?? [],
					countMultiplier: i.countMultiplier ?? 1,
					styleEnabled: i.styleEnabled,
					styleMin: i.styleMin,
					styleMax: i.styleMax,
					countsForTiebreak: i.countsForTiebreak,
					scores: scoresBy.get(i.id) ?? 0
				}))
		}))
	};
}

// ---------- validation ----------

const Int = v.pipe(v.number(), v.integer());
const ItemIn = v.object({
	id: v.optional(v.nullable(v.string())),
	name: v.string(),
	mode: v.picklist(['RANGE', 'DISTINCT', 'COUNT', 'CHECKIN', 'AUTO_ON_SCAN']),
	min: Int,
	max: Int,
	distinctValues: v.array(v.object({ value: Int, label: v.optional(v.string()) })),
	countMultiplier: Int,
	styleEnabled: v.boolean(),
	styleMin: Int,
	styleMax: Int,
	countsForTiebreak: v.boolean()
});
const StationIn = v.object({
	id: v.string(),
	name: v.string(),
	customCode: v.string(),
	dayId: v.nullable(v.string()),
	/** "Roll": the day's start / finish, null = ordinary station. Absent = keep the stored role. */
	role: v.optional(v.nullable(v.picklist(['start', 'finish']))),
	allTracks: v.boolean(),
	trackIds: v.array(v.string()),
	startable: v.boolean(),
	items: v.array(ItemIn)
});
type StationInput = v.InferOutput<typeof StationIn>;

type Errors = Record<string, string>;

/** Pure checks of an edited station; returns field-keyed Swedish messages. */
function validate(s: StationInput, ctx: { dayIds: string[]; trackIds: string[]; multiDay: boolean }): Errors {
	const e: Errors = {};
	const name = s.name.trim();
	if (!name) e.name = 'Kontrollen behöver ett namn.';
	else if (name.length > 60) e.name = 'Högst 60 tecken.';
	const code = s.customCode.trim().toUpperCase();
	if (code && !/^[A-ZÅÄÖ0-9]{1,6}$/.test(code)) e.customCode = 'Koden får bara ha bokstäver och siffror (högst 6).';
	if (ctx.multiDay && (!s.dayId || !ctx.dayIds.includes(s.dayId))) e.dayId = 'Välj vilken dag kontrollen är.';
	if (!s.allTracks) {
		if (s.trackIds.length === 0) e.tracks = 'Välj minst en klass, eller "Alla klasser".';
		else if (s.trackIds.some((t) => !ctx.trackIds.includes(t))) e.tracks = 'Okänd klass.';
	}
	if (s.items.length === 0) e.items = 'En kontroll behöver minst en del.';
	if (s.items.length > 12) e.items = 'Högst 12 delar per kontroll.';
	s.items.forEach((it, i) => {
		const k = `items.${i}`;
		if (!it.name.trim()) e[`${k}.name`] = 'Delen behöver ett namn.';
		else if (it.name.trim().length > 60) e[`${k}.name`] = 'Högst 60 tecken.';
		if (it.mode === 'RANGE' || it.mode === 'COUNT') {
			if (it.min < 0 || it.max > 1000) e[`${k}.range`] = 'Värdena måste ligga mellan 0 och 1000.';
			else if (it.min >= it.max) e[`${k}.range`] = 'Högsta måste vara större än lägsta.';
			else if (it.max - it.min > 100) e[`${k}.range`] = 'Högst 100 steg mellan lägsta och högsta.';
		}
		if (it.mode === 'COUNT' && (it.countMultiplier < 1 || it.countMultiplier > 100)) e[`${k}.mult`] = 'Multiplikatorn måste vara 1–100.';
		if (it.mode === 'DISTINCT') {
			const vals = it.distinctValues.map((d) => d.value);
			if (vals.length === 0) e[`${k}.distinct`] = 'Lägg till minst ett värde.';
			else if (new Set(vals).size !== vals.length) e[`${k}.distinct`] = 'Samma värde finns två gånger.';
			else if (vals.some((x) => x < 0 || x > 1000)) e[`${k}.distinct`] = 'Värdena måste ligga mellan 0 och 1000.';
			else if (it.distinctValues.some((d) => (d.label ?? '').length > 40)) e[`${k}.distinct`] = 'En etikett får vara högst 40 tecken.';
		}
		const scorable = it.mode === 'RANGE' || it.mode === 'DISTINCT' || it.mode === 'COUNT';
		if (scorable && it.styleEnabled) {
			if (it.styleMin < 0 || it.styleMax > 20) e[`${k}.style`] = 'Stilpoäng måste ligga mellan 0 och 20.';
			else if (it.styleMin >= it.styleMax) e[`${k}.style`] = 'Högsta stilpoäng måste vara större än lägsta.';
		}
	});
	return e;
}

class ScoresArrived extends Error {}

function normaliseItem(it: StationInput['items'][number], sort: number, stationId: string) {
	const scorable = it.mode === 'RANGE' || it.mode === 'DISTINCT' || it.mode === 'COUNT';
	const values = [...it.distinctValues]
		.map((d) => ({ value: d.value, ...(d.label?.trim() ? { label: d.label.trim() } : {}) }))
		.sort((a, b) => a.value - b.value);
	return {
		stationId,
		sort,
		name: it.name.trim(),
		mode: it.mode as ItemMode,
		min: scorable && it.mode !== 'DISTINCT' ? it.min : it.mode === 'DISTINCT' ? Math.min(...values.map((d) => d.value)) : 0,
		max: scorable && it.mode !== 'DISTINCT' ? it.max : it.mode === 'DISTINCT' ? Math.max(...values.map((d) => d.value)) : 0,
		distinctValues: it.mode === 'DISTINCT' ? values : null,
		countMultiplier: it.mode === 'COUNT' ? it.countMultiplier : null,
		styleEnabled: scorable && it.styleEnabled,
		styleMin: it.styleMin,
		styleMax: it.styleMax,
		countsForTiebreak: scorable && it.countsForTiebreak
	};
}

async function context(compId: string) {
	const [days, tracks, stations] = await Promise.all([
		db.select().from(schema.day).where(eq(schema.day.competitionId, compId)).orderBy(asc(schema.day.sort)),
		db.select({ id: schema.track.id }).from(schema.track).where(eq(schema.track.competitionId, compId)),
		db.select().from(schema.station).where(eq(schema.station.competitionId, compId)).orderBy(asc(schema.station.sort))
	]);
	return { days, tracks, stations };
}

/** Station ids in display order (grouped by day for multi-day competitions). */
function displayOrder(stations: (typeof schema.station.$inferSelect)[], days: (typeof schema.day.$inferSelect)[]) {
	if (days.length <= 1) return [...stations].sort((a, b) => a.sort - b.sort);
	const dayIdx = new Map(days.map((d, i) => [d.id, i]));
	return [...stations].sort((a, b) => (dayIdx.get(a.dayId ?? '') ?? 99) - (dayIdx.get(b.dayId ?? '') ?? 99) || a.sort - b.sort);
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
async function renumber(tx: Tx, ordered: { id: string; sort: number }[]) {
	for (const [i, s] of ordered.entries()) {
		if (s.sort !== i + 1) await tx.update(schema.station).set({ sort: i + 1 }).where(eq(schema.station.id, s.id));
	}
}

export const actions = {
	save: async (event) => {
		const { comp } = await requireCompetition(event, event.params.slug, [...EDIT_ROLES]);
		const f = await event.request.formData();
		let input: StationInput;
		try {
			input = v.parse(StationIn, JSON.parse(String(f.get('payload') ?? '')));
		} catch {
			return fail(400, { stationId: null, errors: { form: 'Formuläret kunde inte läsas. Ladda om sidan och försök igen.' } as Errors });
		}
		const ctx = await context(comp.id);
		const current = ctx.stations.find((s) => s.id === input.id);
		if (!current) return fail(404, { stationId: input.id, errors: { form: 'Kontrollen finns inte längre.' } as Errors });
		const errors = validate(input, { dayIds: ctx.days.map((d) => d.id), trackIds: ctx.tracks.map((t) => t.id), multiDay: comp.multiDay });

		// Paper codes must stay unique.
		const code = input.customCode.trim().toUpperCase();
		if (!errors.customCode) {
			const codes = stationCodes(
				ctx.stations.map((s) =>
					s.id === input.id
						? { id: s.id, dayId: comp.multiDay ? input.dayId : null, order: s.sort, name: input.name, customCode: code || null, role: input.role === undefined ? s.role : input.role }
						: { id: s.id, dayId: s.dayId, order: s.sort, name: s.name, customCode: s.customCode }
				),
				ctx.days.map((d) => ({ id: d.id, prefix: d.prefix }))
			);
			const mine = codes.get(input.id);
			const clash = ctx.stations.find((s) => s.id !== input.id && codes.get(s.id) === mine);
			if (clash) errors.customCode = `Koden ${mine} används redan av ${clash.name}.`;
		}

		// Never silently delete registered scores.
		const existingItems = await db.select({ id: schema.scoreItem.id, name: schema.scoreItem.name }).from(schema.scoreItem).where(eq(schema.scoreItem.stationId, input.id));
		const keep = new Set(input.items.map((i) => i.id).filter(Boolean));
		const removed = existingItems.filter((i) => !keep.has(i.id));
		if (removed.length) {
			const [{ n }] = await db
				.select({ n: sql<number>`count(*)::int` })
				.from(schema.score)
				.where(inArray(schema.score.itemId, removed.map((r) => r.id)));
			if (n > 0) errors.items = `${removed.map((r) => r.name).join(', ')} har registrerade poäng och kan inte tas bort.`;
		}
		if (input.items.some((i) => i.id && !existingItems.some((e) => e.id === i.id))) errors.form = 'En del hör inte till den här kontrollen. Ladda om sidan.';

		// Stored points were evaluated under the item's rules when they were saved. Changes that would make
		// them wrong (or invalid) are refused while the item has scores; name, labels, style and a wider
		// range are fine.
		const scored = input.items.filter((i) => i.id);
		if (scored.length) {
			const withScores = new Set(
				(await db.selectDistinct({ id: schema.score.itemId }).from(schema.score).where(inArray(schema.score.itemId, scored.map((i) => i.id!)))).map((r) => r.id)
			);
			const before = await db.select().from(schema.scoreItem).where(inArray(schema.scoreItem.id, [...withScores]));
			const locked: string[] = [];
			for (const [i, it] of input.items.entries()) {
				const old = before.find((b) => b.id === it.id);
				if (!old) continue;
				const next = normaliseItem(it, i + 1, input.id);
				const values = (x: { distinctValues: { value: number }[] | null }) => (x.distinctValues ?? []).map((d) => d.value).join(',');
				if (next.mode !== old.mode || (next.countMultiplier ?? null) !== (old.countMultiplier ?? null) || values(next) !== values(old) || next.min > old.min || next.max < old.max) {
					locked.push(old.name);
				}
			}
			if (locked.length) {
				errors.items = `${locked.join(', ')} har redan poäng: sättet att räkna (typ, värden, multiplikator eller ett snävare intervall) kan inte ändras nu. Namn, stil och ett större intervall går bra.`;
			}
		}

		if (Object.keys(errors).length) return fail(400, { stationId: input.id, errors });

		try {
			await db.transaction(async (tx) => {
				const dayChanged = comp.multiDay && current.dayId !== input.dayId;
				await tx
					.update(schema.station)
					.set({
						name: input.name.trim(),
						customCode: code || null,
						dayId: comp.multiDay ? input.dayId : null,
						...(input.role !== undefined ? { role: input.role } : {}),
						allTracks: input.allTracks,
						startable: input.startable
					})
					.where(eq(schema.station.id, input.id));
				await tx.delete(schema.stationTrack).where(eq(schema.stationTrack.stationId, input.id));
				if (!input.allTracks && input.trackIds.length) {
					await tx.insert(schema.stationTrack).values([...new Set(input.trackIds)].map((trackId) => ({ stationId: input.id, trackId })));
				}
				if (removed.length) {
					// Checked again inside the transaction (items locked): a phone may have reported meanwhile,
					// and deleting the item would delete that score with it.
					const ids = removed.map((r) => r.id);
					await tx.select({ id: schema.scoreItem.id }).from(schema.scoreItem).where(inArray(schema.scoreItem.id, ids)).for('update');
					const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(schema.score).where(inArray(schema.score.itemId, ids));
					if (n > 0) throw new ScoresArrived();
					await tx.delete(schema.scoreItem).where(inArray(schema.scoreItem.id, ids));
				}
				for (const [i, it] of input.items.entries()) {
					const row = normaliseItem(it, i + 1, input.id);
					if (it.id) await tx.update(schema.scoreItem).set(row).where(eq(schema.scoreItem.id, it.id));
					else await tx.insert(schema.scoreItem).values(row);
				}
				if (dayChanged) {
					// Moving to another day: place it last on that day, before its finish station.
					const stations = await tx.select().from(schema.station).where(eq(schema.station.competitionId, comp.id));
					const ordered = displayOrder(stations, ctx.days).filter((s) => s.id !== input.id);
					const moved = stations.find((s) => s.id === input.id)!;
					const sameDay = ordered.filter((s) => s.dayId === input.dayId);
					const mal = moved.role === 'finish' ? undefined : sameDay.find((s) => s.role === 'finish');
					const anchor = mal ?? sameDay.at(-1);
					const at = anchor ? ordered.indexOf(anchor) + (mal ? 0 : 1) : ordered.length;
					ordered.splice(at, 0, moved);
					await renumber(tx, ordered);
				}
				await recordChange(tx, comp.id, 'station', input.id);
			});
		} catch (e) {
			if (e instanceof ScoresArrived) return fail(409, { stationId: input.id, errors: { items: 'En del fick precis poäng och kan inte tas bort. Ladda om sidan.' } });
			throw e;
		}
		return { saved: input.id, at: Date.now() };
	},

	create: async (event) => {
		const { comp } = await requireCompetition(event, event.params.slug, [...EDIT_ROLES]);
		const f = await event.request.formData();
		const ctx = await context(comp.id);
		const wanted = String(f.get('dayId') ?? '');
		const dayId = comp.multiDay ? (ctx.days.find((d) => d.id === wanted)?.id ?? ctx.days[0]?.id ?? null) : null;
		const name = 'Ny kontroll';
		const id = await db.transaction(async (tx) => {
			const [st] = await tx
				.insert(schema.station)
				.values({ competitionId: comp.id, dayId, sort: ctx.stations.length + 1, name })
				.returning();
			await tx.insert(schema.scoreItem).values({ stationId: st.id, sort: 1, name, mode: 'RANGE', min: 0, max: 20, styleEnabled: true, countsForTiebreak: true });
			// Multi-day: insert before that day's finish station.
			const ordered = displayOrder(ctx.stations, ctx.days);
			const mal = ordered.find((s) => s.dayId === dayId && s.role === 'finish');
			const sameDay = ordered.filter((s) => s.dayId === dayId);
			const at = mal ? ordered.indexOf(mal) : sameDay.length ? ordered.indexOf(sameDay.at(-1)!) + 1 : ordered.length;
			ordered.splice(at, 0, st);
			await renumber(tx, ordered);
			await recordChange(tx, comp.id, 'station', st.id);
			return st.id;
		});
		redirect(303, `/admin/${comp.slug}/stations?s=${id}`);
	},

	delete: async (event) => {
		const { comp } = await requireCompetition(event, event.params.slug, [...EDIT_ROLES]);
		const f = await event.request.formData();
		const id = String(f.get('id') ?? '');
		const [st] = await db.select().from(schema.station).where(and(eq(schema.station.id, id), eq(schema.station.competitionId, comp.id))).limit(1);
		if (!st) return fail(404, { stationId: id, errors: { form: 'Kontrollen finns inte.' } as Errors });
		const [{ n }] = await db
			.select({ n: sql<number>`count(*)::int` })
			.from(schema.score)
			.innerJoin(schema.scoreItem, eq(schema.scoreItem.id, schema.score.itemId))
			.where(eq(schema.scoreItem.stationId, id));
		if (n > 0) return fail(400, { stationId: id, errors: { form: `${st.name} har ${n} registrerade poäng och kan inte tas bort.` } as Errors });
		await db.transaction(async (tx) => {
			await tx.delete(schema.station).where(eq(schema.station.id, id));
			const ctx = await tx.select().from(schema.station).where(eq(schema.station.competitionId, comp.id));
			const days = await tx.select().from(schema.day).where(eq(schema.day.competitionId, comp.id)).orderBy(asc(schema.day.sort));
			await renumber(tx, displayOrder(ctx, days));
			await recordChange(tx, comp.id, 'station', id);
		});
		redirect(303, `/admin/${comp.slug}/stations`);
	},

	move: async (event) => {
		const { comp } = await requireCompetition(event, event.params.slug, [...EDIT_ROLES]);
		const f = await event.request.formData();
		const id = String(f.get('id') ?? '');
		const dir = String(f.get('dir') ?? '') === 'up' ? -1 : 1;
		const ctx = await context(comp.id);
		const ordered = displayOrder(ctx.stations, ctx.days);
		const i = ordered.findIndex((s) => s.id === id);
		const j = i + dir;
		if (i < 0 || j < 0 || j >= ordered.length || (comp.multiDay && ordered[j].dayId !== ordered[i].dayId)) return { moved: false };
		[ordered[i], ordered[j]] = [ordered[j], ordered[i]];
		await db.transaction(async (tx) => {
			await renumber(tx, ordered);
			await recordChange(tx, comp.id, 'station', id);
		});
		return { moved: true };
	}
};

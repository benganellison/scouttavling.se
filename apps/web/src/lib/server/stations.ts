/**
 * Writing stations (the organiser's "Kontroller" page): save, create, delete and move, with the
 * paper-code uniqueness check and the score locks. The rules are pure in packages/domain
 * (stations.ts); this module loads the facts and writes in one transaction.
 */
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import {
	CHECKPOINT_ITEM,
	codeInput,
	DEFAULT_ITEM,
	displayOrder,
	normaliseItem,
	scoringChangeLocked,
	stationCodes,
	validateStation,
	type FieldErrors,
	type StationEdit
} from '@scouttavling/domain';
import { db, schema, type CompRow, type Tx } from './db/index.ts';
import { recordChange } from './changes.ts';
import { stationsOf, tracksOf } from './queries.ts';

export { CHECKPOINT_ITEM, DEFAULT_ITEM };

async function context(compId: string) {
	const [days, tracks, stations] = await Promise.all([
		db.select().from(schema.day).where(eq(schema.day.competitionId, compId)).orderBy(asc(schema.day.sort)),
		tracksOf(compId),
		stationsOf(compId)
	]);
	return { days, tracks, stations };
}

/** Gives every station its position (1, 2, …) in the given order. */
async function renumber(tx: Tx, ordered: { id: string; sort: number }[]) {
	for (const [i, s] of ordered.entries()) {
		if (s.sort !== i + 1)
			await tx
				.update(schema.station)
				.set({ sort: i + 1 })
				.where(eq(schema.station.id, s.id));
	}
}

class ScoresArrived extends Error {}

export type SaveResult = { ok: true } | { ok: false; status: 400 | 404 | 409; errors: FieldErrors };

export async function saveStation(comp: Pick<CompRow, 'id' | 'multiDay'>, input: StationEdit): Promise<SaveResult> {
	const ctx = await context(comp.id);
	const current = ctx.stations.find((s) => s.id === input.id);
	if (!current) return { ok: false, status: 404, errors: { form: 'Kontrollen finns inte längre.' } };
	const errors = validateStation(input, { dayIds: ctx.days.map((d) => d.id), trackIds: ctx.tracks.map((t) => t.id), multiDay: comp.multiDay });

	// Paper codes must stay unique.
	const code = input.customCode.trim().toUpperCase();
	if (!errors.customCode) {
		const codes = stationCodes(
			ctx.stations.map((s) =>
				s.id === input.id
					? codeInput({
							...s,
							dayId: comp.multiDay ? input.dayId : null,
							name: input.name,
							customCode: code || null,
							role: input.role === undefined ? s.role : input.role
						})
					: codeInput(s)
			),
			ctx.days
		);
		const mine = codes.get(input.id);
		const clash = ctx.stations.find((s) => s.id !== input.id && codes.get(s.id) === mine);
		if (clash) errors.customCode = `Koden ${mine} används redan av ${clash.name}.`;
	}

	// Never silently delete registered scores.
	const existingItems = await db.select().from(schema.scoreItem).where(eq(schema.scoreItem.stationId, input.id));
	const keep = new Set(input.items.map((i) => i.id).filter(Boolean));
	const removed = existingItems.filter((i) => !keep.has(i.id));
	const scoreCount = async (ids: string[]) =>
		ids.length
			? (
					await db
						.select({ id: schema.score.itemId, n: sql<number>`count(*)::int` })
						.from(schema.score)
						.where(inArray(schema.score.itemId, ids))
						.groupBy(schema.score.itemId)
				).reduce((m, r) => m.set(r.id, r.n), new Map<string, number>())
			: new Map<string, number>();
	const removedScores = await scoreCount(removed.map((r) => r.id));
	if (removedScores.size) errors.items = `${removed.map((r) => r.name).join(', ')} har registrerade poäng och kan inte tas bort.`;
	if (input.items.some((i) => i.id && !existingItems.some((e) => e.id === i.id))) errors.form = 'En del hör inte till den här kontrollen. Ladda om sidan.';

	// Items with scores keep their way of counting (scoringChangeLocked).
	const withScores = await scoreCount(input.items.flatMap((i) => (i.id ? [i.id] : [])));
	const locked = input.items.flatMap((it) => {
		const old = existingItems.find((b) => b.id === it.id);
		return old && withScores.has(old.id) && scoringChangeLocked(old, normaliseItem(it)) ? [old.name] : [];
	});
	if (locked.length) {
		errors.items = `${locked.join(', ')} har redan poäng: sättet att räkna (typ, värden, multiplikator eller ett snävare intervall) kan inte ändras nu. Namn, stil och ett större intervall går bra.`;
	}
	if (Object.keys(errors).length) return { ok: false, status: 400, errors };

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
				const [{ n }] = await tx
					.select({ n: sql<number>`count(*)::int` })
					.from(schema.score)
					.where(inArray(schema.score.itemId, ids));
				if (n > 0) throw new ScoresArrived();
				await tx.delete(schema.scoreItem).where(inArray(schema.scoreItem.id, ids));
			}
			for (const [i, it] of input.items.entries()) {
				const row = { ...normaliseItem(it), stationId: input.id, sort: i + 1 };
				if (it.id) await tx.update(schema.scoreItem).set(row).where(eq(schema.scoreItem.id, it.id));
				else await tx.insert(schema.scoreItem).values(row);
			}
			if (dayChanged) {
				// Moving to another day: place it last on that day, before its finish station.
				const stations = await stationsOf(comp.id, tx);
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
		if (e instanceof ScoresArrived) return { ok: false, status: 409, errors: { items: 'En del fick precis poäng och kan inte tas bort. Ladda om sidan.' } };
		throw e;
	}
	return { ok: true };
}

/** A new station ("Ny kontroll", 0–20 with style) on the given day, before that day's finish. */
export async function createStation(comp: Pick<CompRow, 'id' | 'multiDay'>, wantedDayId: string): Promise<string> {
	const ctx = await context(comp.id);
	const dayId = comp.multiDay ? (ctx.days.find((d) => d.id === wantedDayId)?.id ?? ctx.days[0]?.id ?? null) : null;
	const name = 'Ny kontroll';
	return db.transaction(async (tx) => {
		const [st] = await tx
			.insert(schema.station)
			.values({ competitionId: comp.id, dayId, sort: ctx.stations.length + 1, name })
			.returning();
		await tx.insert(schema.scoreItem).values({ stationId: st.id, sort: 1, name, ...DEFAULT_ITEM });
		const ordered = displayOrder(ctx.stations, ctx.days);
		const mal = ordered.find((s) => s.dayId === dayId && s.role === 'finish');
		const sameDay = ordered.filter((s) => s.dayId === dayId);
		const at = mal ? ordered.indexOf(mal) : sameDay.length ? ordered.indexOf(sameDay.at(-1)!) + 1 : ordered.length;
		ordered.splice(at, 0, st);
		await renumber(tx, ordered);
		await recordChange(tx, comp.id, 'station', st.id);
		return st.id;
	});
}

/** Deletes a station without scores. Returns an error message, or null when deleted. */
export async function deleteStation(comp: Pick<CompRow, 'id'>, id: string): Promise<{ status: 400 | 404; message: string } | null> {
	const [st] = await db
		.select()
		.from(schema.station)
		.where(and(eq(schema.station.id, id), eq(schema.station.competitionId, comp.id)))
		.limit(1);
	if (!st) return { status: 404, message: 'Kontrollen finns inte.' };
	const [{ n }] = await db
		.select({ n: sql<number>`count(*)::int` })
		.from(schema.score)
		.innerJoin(schema.scoreItem, eq(schema.scoreItem.id, schema.score.itemId))
		.where(eq(schema.scoreItem.stationId, id));
	if (n > 0) return { status: 400, message: `${st.name} har ${n} registrerade poäng och kan inte tas bort.` };
	await db.transaction(async (tx) => {
		await tx.delete(schema.station).where(eq(schema.station.id, id));
		const stations = await stationsOf(comp.id, tx);
		const days = await tx.select().from(schema.day).where(eq(schema.day.competitionId, comp.id)).orderBy(asc(schema.day.sort));
		await renumber(tx, displayOrder(stations, days));
		await recordChange(tx, comp.id, 'station', id);
	});
	return null;
}

/** One step up or down within its day. false when it cannot move that way. */
export async function moveStation(comp: Pick<CompRow, 'id' | 'multiDay'>, id: string, dir: -1 | 1): Promise<boolean> {
	const ctx = await context(comp.id);
	const ordered = displayOrder(ctx.stations, ctx.days);
	const i = ordered.findIndex((s) => s.id === id);
	const j = i + dir;
	if (i < 0 || j < 0 || j >= ordered.length || (comp.multiDay && ordered[j].dayId !== ordered[i].dayId)) return false;
	[ordered[i], ordered[j]] = [ordered[j], ordered[i]];
	await db.transaction(async (tx) => {
		await renumber(tx, ordered);
		await recordChange(tx, comp.id, 'station', id);
	});
	return true;
}

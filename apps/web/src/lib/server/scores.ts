import { and, asc, desc, eq, ne, sql } from 'drizzle-orm';
import { evaluate, InvalidScoreError, nextPatrolStatus, type ScoreItemDef } from '@scouttavling/domain';
import { db, schema } from './db';
import { recordChange } from './changes';

/**
 * THE score write path — used by field devices (sync commands), HQ edits and
 * paper entry alike, so conflicts are detected the same way everywhere.
 * Rules (02 §5): optimistic versioning, identical values auto-merge, no
 * last-write-wins; competing writes become score_conflict rows for HQ.
 */

type ItemRow = typeof schema.scoreItem.$inferSelect;
type CompRow = typeof schema.competition.$inferSelect;

/** DB row → domain definition. Style needs both the competition and the item switch on. */
export function itemDef(item: ItemRow, comp: Pick<CompRow, 'styleEnabled'>): ScoreItemDef {
	return {
		id: item.id,
		name: item.name,
		mode: item.mode,
		min: item.min,
		max: item.max,
		distinctValues: item.distinctValues ?? undefined,
		countMultiplier: item.countMultiplier ?? undefined,
		styleEnabled: comp.styleEnabled && item.styleEnabled,
		styleMin: item.styleMin,
		styleMax: item.styleMax,
		countsForTiebreak: item.countsForTiebreak
	};
}

export interface WriteScore {
	competitionId: string;
	patrolId: string;
	itemId: string;
	raw: { value: number; style: number | null };
	/** Version the writer last saw; null = "I believe there is no score yet". */
	baseVersion: number | null;
	origin: 'device' | 'admin' | 'paper';
	deviceId?: string | null;
	userId?: string | null;
	commandId?: string | null;
	reason?: string | null;
	note?: string | null;
	/** HQ resolving a conflict may overwrite deliberately. */
	force?: boolean;
	/** When it happened (device clock, capped at now); used for status events. Default: now. */
	at?: Date | null;
}

export type WriteResult =
	| { result: 'accepted'; version: number; points: number; stylePoints: number }
	| { result: 'duplicate'; version: number }
	| { result: 'conflict'; server: { points: number; stylePoints: number; version: number; state: string } }
	| { result: 'rejected'; reason: string };

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Patrol status follows the scores (rules in @scouttavling/domain nextPatrolStatus):
 * first score → "På banan"; a finish-role station or an AUTO_ON_SCAN item → "I läger"
 * on earlier days, "I mål" on the last day (or when there are no days); a score from
 * a later day brings a camp patrol back on the course. Lives here so phone, HQ
 * correction and paper entry behave the same. Resigned/finished are never touched.
 */
async function applyStatusRules(tx: Tx, w: WriteScore, item: ItemRow) {
	const [p] = await tx.select({ id: schema.patrol.id, status: schema.patrol.status }).from(schema.patrol).where(eq(schema.patrol.id, w.patrolId)).for('update').limit(1);
	if (!p || p.status === 'resigned' || p.status === 'finished') return;
	const [st] = await tx.select({ dayId: schema.station.dayId, role: schema.station.role }).from(schema.station).where(eq(schema.station.id, item.stationId)).limit(1);
	const days = await tx
		.select({ id: schema.day.id })
		.from(schema.day)
		.where(eq(schema.day.competitionId, w.competitionId))
		.orderBy(asc(schema.day.sort), asc(schema.day.date));
	const dayIndex = (id: string | null | undefined) => {
		const i = id ? days.findIndex((d) => d.id === id) : -1;
		return i < 0 ? null : i;
	};

	// The patrol's other active scores: where it has been, and on which days.
	const others = await tx
		.select({ dayId: schema.station.dayId, role: schema.station.role, mode: schema.scoreItem.mode })
		.from(schema.score)
		.innerJoin(schema.scoreItem, eq(schema.scoreItem.id, schema.score.itemId))
		.innerJoin(schema.station, eq(schema.station.id, schema.scoreItem.stationId))
		.where(and(eq(schema.score.patrolId, p.id), eq(schema.score.state, 'active'), ne(schema.score.itemId, item.id)))
		.orderBy(desc(schema.score.updatedAt));
	let latestDay: number | null = null;
	for (const o of others) {
		const d = dayIndex(o.dayId);
		if (d !== null && (latestDay === null || d > latestDay)) latestDay = d;
	}
	let campDay: number | null = null;
	if (p.status === 'camp') {
		// The day of the finish station that put the patrol in camp (its latest other finish score)…
		const fin = others.find((o) => o.role === 'finish' || o.mode === 'AUTO_ON_SCAN');
		if (fin) campDay = dayIndex(fin.dayId);
		// …or, when camp was set by hand, the latest day it was seen.
		else for (const o of others) {
			const d = dayIndex(o.dayId);
			if (d !== null && (campDay === null || d > campDay)) campDay = d;
		}
	}

	const next = nextPatrolStatus({
		current: p.status,
		finishTrigger: st?.role === 'finish' || item.mode === 'AUTO_ON_SCAN',
		stationDay: dayIndex(st?.dayId),
		dayCount: days.length,
		campDay,
		latestDay
	});
	if (!next) return;
	const at = w.at ?? new Date();
	const ev = (status: typeof next, when = at) => ({ patrolId: p.id, status, deviceId: w.deviceId ?? null, userId: w.userId ?? null, at: when });
	await tx.update(schema.patrol).set({ status: next }).where(eq(schema.patrol.id, p.id));
	// Straight from Anmäld to I läger / I mål: record the start too (follow page "Startade").
	if (p.status === 'registered' && next !== 'active') await tx.insert(schema.statusEvent).values(ev('active', new Date(at.getTime() - 1)));
	await tx.insert(schema.statusEvent).values(ev(next));
	await recordChange(tx, w.competitionId, 'patrol', p.id);
}

/** When the patrol was at the station: only a phone at the station knows (paper/HQ are typed in later). */
const visitTime = (w: WriteScore) => (w.origin === 'device' ? (w.at ?? new Date()) : null);

/**
 * Lock order for every score write: the patrol row first, then the score, then change_seq (in
 * recordChange). Patrol edits, the start & finish desk and imports also take the patrol first,
 * so the two can never deadlock.
 */
async function lockPatrol(tx: Tx, patrolId: string) {
	await tx.select({ id: schema.patrol.id }).from(schema.patrol).where(eq(schema.patrol.id, patrolId)).for('update').limit(1);
}

/** Runs in its own transaction, or as a savepoint inside the caller's (`outer`, e.g. one sync command). */
/**
 * Undoing the report that sent a patrol to "I läger"/"I mål" (a wrong patrol scanned at Mål) takes
 * it back: to "På banan" when it has other reports, else "Anmäld". Another finish report that still
 * stands keeps the status. Resigned patrols are never touched.
 */
async function statusAfterVoid(tx: Tx, w: Pick<WriteScore, 'competitionId' | 'patrolId' | 'deviceId' | 'userId'>, itemId: string) {
	const [p] = await tx.select({ id: schema.patrol.id, status: schema.patrol.status }).from(schema.patrol).where(eq(schema.patrol.id, w.patrolId)).limit(1);
	if (!p || (p.status !== 'camp' && p.status !== 'finished')) return;
	const [voided] = await tx
		.select({ role: schema.station.role, mode: schema.scoreItem.mode })
		.from(schema.scoreItem)
		.innerJoin(schema.station, eq(schema.station.id, schema.scoreItem.stationId))
		.where(eq(schema.scoreItem.id, itemId))
		.limit(1);
	if (!voided || (voided.role !== 'finish' && voided.mode !== 'AUTO_ON_SCAN')) return;
	const remaining = await tx
		.select({ role: schema.station.role, mode: schema.scoreItem.mode })
		.from(schema.score)
		.innerJoin(schema.scoreItem, eq(schema.scoreItem.id, schema.score.itemId))
		.innerJoin(schema.station, eq(schema.station.id, schema.scoreItem.stationId))
		.where(and(eq(schema.score.patrolId, p.id), eq(schema.score.state, 'active')));
	if (remaining.some((r) => r.role === 'finish' || r.mode === 'AUTO_ON_SCAN')) return;
	const next = remaining.length ? 'active' : 'registered';
	await tx.update(schema.patrol).set({ status: next }).where(eq(schema.patrol.id, p.id));
	await tx.insert(schema.statusEvent).values({ patrolId: p.id, status: next, deviceId: w.deviceId ?? null, userId: w.userId ?? null });
	await recordChange(tx, w.competitionId, 'patrol', p.id);
}

export async function writeScore(w: WriteScore, outer?: Tx): Promise<WriteResult> {
	const run = async (tx: Tx): Promise<WriteResult> => {
		await lockPatrol(tx, w.patrolId);
		const [item] = await tx.select().from(schema.scoreItem).where(eq(schema.scoreItem.id, w.itemId)).limit(1);
		const [comp] = await tx.select().from(schema.competition).where(eq(schema.competition.id, w.competitionId)).limit(1);
		if (!item || !comp) return { result: 'rejected', reason: 'Okänd kontroll' } as const;
		// Every caller (phones, HQ, paper, conflict resolution) gets the same guarantee: the patrol and
		// the item both belong to this competition, so no write can reach another competition's data.
		const [owner] = await tx
			.select({ station: schema.station.competitionId, patrol: schema.patrol.competitionId })
			.from(schema.station)
			.innerJoin(schema.patrol, eq(schema.patrol.id, w.patrolId))
			.where(eq(schema.station.id, item.stationId))
			.limit(1);
		if (!owner || owner.station !== w.competitionId || owner.patrol !== w.competitionId) return { result: 'rejected', reason: 'Okänd kontroll' } as const;
		let value: { points: number; stylePoints: number };
		try {
			value = evaluate(itemDef(item, comp), w.raw);
		} catch (e) {
			if (e instanceof InvalidScoreError) return { result: 'rejected', reason: e.message } as const;
			throw e;
		}
		const current = () =>
			tx
				.select()
				.from(schema.score)
				.where(and(eq(schema.score.patrolId, w.patrolId), eq(schema.score.itemId, w.itemId)))
				.for('update')
				.limit(1)
				.then((r) => r[0]);
		let existing = await current();

		const revision = async (scoreId: string, version: number, state: 'active' | 'void') =>
			tx.insert(schema.scoreRevision).values({
				scoreId, version, points: value.points, stylePoints: value.stylePoints, state, origin: w.origin,
				deviceId: w.deviceId ?? null, userId: w.userId ?? null, commandId: w.commandId ?? null, reason: w.reason ?? null
			});

		if (!existing) {
			// Two first reports at once: FOR UPDATE above locked nothing (no row yet). ON CONFLICT lets the
			// second one wait for the first and then continue as an ordinary version check (→ conflict).
			const [row] = await tx
				.insert(schema.score)
				.values({
					competitionId: w.competitionId, patrolId: w.patrolId, itemId: w.itemId, points: value.points, stylePoints: value.stylePoints,
					raw: w.raw, origin: w.origin, deviceId: w.deviceId ?? null, userId: w.userId ?? null, note: w.note ?? null,
					scoredAt: visitTime(w)
				})
				.onConflictDoNothing({ target: [schema.score.patrolId, schema.score.itemId] })
				.returning();
			if (row) {
				await revision(row.id, 1, 'active');
				await recordChange(tx, w.competitionId, 'score', row.id);
				await applyStatusRules(tx, w, item);
				return { result: 'accepted', version: 1, ...value } as const;
			}
			existing = await current();
			if (!existing) throw new Error('score row vanished during write');
		}

		const same = existing.state === 'active' && existing.points === value.points && existing.stylePoints === value.stylePoints;
		if (same) return { result: 'duplicate', version: existing.version } as const;

		const stale = w.baseVersion !== existing.version && !(existing.state === 'void' && w.baseVersion === null);
		if (stale && !w.force) {
			await tx.insert(schema.scoreConflict).values({
				competitionId: w.competitionId, patrolId: w.patrolId, itemId: w.itemId, commandId: w.commandId ?? null,
				existing: { points: existing.points, stylePoints: existing.stylePoints, version: existing.version, state: existing.state, origin: existing.origin },
				incoming: { ...value, raw: w.raw, origin: w.origin, deviceId: w.deviceId ?? null, userId: w.userId ?? null, baseVersion: w.baseVersion }
			});
			await recordChange(tx, w.competitionId, 'conflict', existing.id);
			return { result: 'conflict', server: { points: existing.points, stylePoints: existing.stylePoints, version: existing.version, state: existing.state } } as const;
		}

		const version = existing.version + 1;
		await tx
			.update(schema.score)
			.set({
				points: value.points, stylePoints: value.stylePoints, raw: w.raw, state: 'active', version, origin: w.origin,
				deviceId: w.deviceId ?? null, userId: w.userId ?? null, note: w.note ?? existing.note, updatedAt: sql`now()`,
				// The first device report sets the visit time; later corrections never move it. A report made
				// again after an undo is a new visit.
				scoredAt: existing.state === 'void' ? visitTime(w) : (existing.scoredAt ?? visitTime(w))
			})
			.where(eq(schema.score.id, existing.id));
		await revision(existing.id, version, 'active');
		await recordChange(tx, w.competitionId, 'score', existing.id);
		await applyStatusRules(tx, w, item);
		return { result: 'accepted', version, ...value } as const;
	};
	return outer ? outer.transaction(run) : db.transaction(run);
}

/** Undo after sending = a compensating void (02 §4, contract C8). */
export async function voidScore(w: Omit<WriteScore, 'raw'>, outer?: Tx): Promise<WriteResult> {
	const run = async (tx: Tx): Promise<WriteResult> => {
		await lockPatrol(tx, w.patrolId);
		const existing = (
			await tx
				.select()
				.from(schema.score)
				.where(and(eq(schema.score.patrolId, w.patrolId), eq(schema.score.itemId, w.itemId), eq(schema.score.competitionId, w.competitionId)))
				.for('update')
				.limit(1)
		)[0];
		if (!existing || existing.state === 'void') return { result: 'duplicate', version: existing?.version ?? 0 } as const;
		if (w.baseVersion !== existing.version && !w.force) {
			// Someone changed the score after this undo was made: HQ decides, like for any stale write.
			await tx.insert(schema.scoreConflict).values({
				competitionId: w.competitionId, patrolId: w.patrolId, itemId: w.itemId, commandId: w.commandId ?? null,
				existing: { points: existing.points, stylePoints: existing.stylePoints, version: existing.version, state: existing.state, origin: existing.origin },
				incoming: { type: 'VoidScore', origin: w.origin, deviceId: w.deviceId ?? null, userId: w.userId ?? null, baseVersion: w.baseVersion }
			});
			await recordChange(tx, w.competitionId, 'conflict', existing.id);
			return { result: 'conflict', server: { points: existing.points, stylePoints: existing.stylePoints, version: existing.version, state: existing.state } } as const;
		}
		const version = existing.version + 1;
		await tx.update(schema.score).set({ state: 'void', version, updatedAt: sql`now()` }).where(eq(schema.score.id, existing.id));
		await tx.insert(schema.scoreRevision).values({
			scoreId: existing.id, version, points: existing.points, stylePoints: existing.stylePoints, state: 'void', origin: w.origin,
			deviceId: w.deviceId ?? null, userId: w.userId ?? null, commandId: w.commandId ?? null, reason: w.reason ?? 'Ångrad'
		});
		await recordChange(tx, w.competitionId, 'score', existing.id);
		await statusAfterVoid(tx, w, existing.itemId);
		return { result: 'accepted', version, points: 0, stylePoints: 0 } as const;
	};
	return outer ? outer.transaction(run) : db.transaction(run);
}

import { and, eq, sql } from 'drizzle-orm';
import { evaluate, InvalidScoreError, type ScoreItemDef } from '@scouttavling/domain';
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
}

export type WriteResult =
	| { result: 'accepted'; version: number; points: number; stylePoints: number }
	| { result: 'duplicate'; version: number }
	| { result: 'conflict'; server: { points: number; stylePoints: number; version: number; state: string } }
	| { result: 'rejected'; reason: string };

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * A registered patrol that gets its first score is evidently out on the course:
 * mark it "På banan" (active) so HQ, the desk and the follow page agree, even if
 * nobody registered the start. Finished and resigned patrols are never touched.
 */
async function markOnCourse(tx: Tx, w: WriteScore) {
	const [p] = await tx
		.update(schema.patrol)
		.set({ status: 'active' })
		.where(and(eq(schema.patrol.id, w.patrolId), eq(schema.patrol.status, 'registered')))
		.returning({ id: schema.patrol.id });
	if (!p) return;
	await tx.insert(schema.statusEvent).values({ patrolId: p.id, status: 'active', deviceId: w.deviceId ?? null, userId: w.userId ?? null });
	await recordChange(tx, w.competitionId, 'patrol', p.id);
}

export async function writeScore(w: WriteScore): Promise<WriteResult> {
	return db.transaction(async (tx) => {
		const [item] = await tx.select().from(schema.scoreItem).where(eq(schema.scoreItem.id, w.itemId)).limit(1);
		const [comp] = await tx.select().from(schema.competition).where(eq(schema.competition.id, w.competitionId)).limit(1);
		if (!item || !comp) return { result: 'rejected', reason: 'Okänd kontroll' } as const;
		let value: { points: number; stylePoints: number };
		try {
			value = evaluate(itemDef(item, comp), w.raw);
		} catch (e) {
			if (e instanceof InvalidScoreError) return { result: 'rejected', reason: e.message } as const;
			throw e;
		}
		const existing = (
			await tx
				.select()
				.from(schema.score)
				.where(and(eq(schema.score.patrolId, w.patrolId), eq(schema.score.itemId, w.itemId)))
				.for('update')
				.limit(1)
		)[0];

		const revision = async (scoreId: string, version: number, state: 'active' | 'void') =>
			tx.insert(schema.scoreRevision).values({
				scoreId, version, points: value.points, stylePoints: value.stylePoints, state, origin: w.origin,
				deviceId: w.deviceId ?? null, userId: w.userId ?? null, commandId: w.commandId ?? null, reason: w.reason ?? null
			});

		if (!existing) {
			const [row] = await tx
				.insert(schema.score)
				.values({
					competitionId: w.competitionId, patrolId: w.patrolId, itemId: w.itemId, points: value.points, stylePoints: value.stylePoints,
					raw: w.raw, origin: w.origin, deviceId: w.deviceId ?? null, userId: w.userId ?? null, note: w.note ?? null
				})
				.returning();
			await revision(row.id, 1, 'active');
			await recordChange(tx, w.competitionId, 'score', row.id);
			await markOnCourse(tx, w);
			return { result: 'accepted', version: 1, ...value } as const;
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
				deviceId: w.deviceId ?? null, userId: w.userId ?? null, note: w.note ?? existing.note, updatedAt: sql`now()`
			})
			.where(eq(schema.score.id, existing.id));
		await revision(existing.id, version, 'active');
		await recordChange(tx, w.competitionId, 'score', existing.id);
		await markOnCourse(tx, w);
		return { result: 'accepted', version, ...value } as const;
	});
}

/** Undo after sending = a compensating void (02 §4, contract C8). */
export async function voidScore(w: Omit<WriteScore, 'raw'>): Promise<WriteResult> {
	return db.transaction(async (tx) => {
		const existing = (
			await tx
				.select()
				.from(schema.score)
				.where(and(eq(schema.score.patrolId, w.patrolId), eq(schema.score.itemId, w.itemId)))
				.for('update')
				.limit(1)
		)[0];
		if (!existing || existing.state === 'void') return { result: 'duplicate', version: existing?.version ?? 0 } as const;
		if (w.baseVersion !== existing.version && !w.force) {
			return { result: 'conflict', server: { points: existing.points, stylePoints: existing.stylePoints, version: existing.version, state: existing.state } } as const;
		}
		const version = existing.version + 1;
		await tx.update(schema.score).set({ state: 'void', version, updatedAt: sql`now()` }).where(eq(schema.score.id, existing.id));
		await tx.insert(schema.scoreRevision).values({
			scoreId: existing.id, version, points: existing.points, stylePoints: existing.stylePoints, state: 'void', origin: w.origin,
			deviceId: w.deviceId ?? null, userId: w.userId ?? null, commandId: w.commandId ?? null, reason: w.reason ?? 'Ångrad'
		});
		await recordChange(tx, w.competitionId, 'score', existing.id);
		return { result: 'accepted', version, points: 0, stylePoints: 0 } as const;
	});
}

/**
 * Resolving a score conflict (HQ's "Konflikter"): the choice and the conflict's status change in ONE
 * transaction, with the conflict row locked, so a crash cannot leave a written score with the
 * conflict still open, and two people resolving at once cannot both apply their choice.
 */
import { and, eq } from 'drizzle-orm';
import { db, schema } from './db/index.ts';
import { recordChange } from './changes.ts';
import { voidScore, writeScore } from './scores.ts';

export type ResolveResult = { ok: true; message: string } | { ok: false; status: 400 | 404; message: string };

export async function resolveConflict(competitionId: string, id: string, choice: 'keep' | 'useNew', userId: string): Promise<ResolveResult> {
	return db.transaction(async (tx) => {
		const [c] = await tx
			.select()
			.from(schema.scoreConflict)
			.where(and(eq(schema.scoreConflict.id, id), eq(schema.scoreConflict.competitionId, competitionId), eq(schema.scoreConflict.status, 'open')))
			.for('update')
			.limit(1);
		if (!c) return { ok: false, status: 404, message: 'Konflikten är redan löst' } as const;
		let message = 'Befintlig poäng behölls.';
		if (choice === 'useNew') {
			const inc = c.incoming;
			const base = { competitionId, patrolId: c.patrolId, itemId: c.itemId, baseVersion: null, origin: 'admin' as const, userId, deviceId: null, force: true };
			if (inc.type === 'VoidScore') {
				// A quarantined undo ("Ångra" on the phone) carries no points: using it means removing the score.
				await voidScore({ ...base, reason: 'Konflikt löst: ångringen från kontrollen används' }, tx);
				message = 'Poängen är borttagen, som funktionären ångrade.';
			} else {
				const raw = inc.raw ?? { value: inc.points ?? 0, style: inc.stylePoints ?? null };
				const res = await writeScore({ ...base, raw, reason: 'Konflikt löst: ny rapport används' }, tx);
				if (res.result === 'rejected') return { ok: false, status: 400, message: `Kunde inte spara: ${res.reason}` } as const;
				message = 'Den nya poängen används.';
			}
		}
		await tx.update(schema.scoreConflict).set({ status: 'resolved' }).where(eq(schema.scoreConflict.id, id));
		await recordChange(tx, competitionId, 'conflict', id);
		return { ok: true, message } as const;
	});
}

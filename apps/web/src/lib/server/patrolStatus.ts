/**
 * The one way to change a patrol's status (the rules for WHEN are in packages/domain patrolStatus.ts):
 * the patrol row, its status_event history (follow page, timeline) and the change feed. Called with
 * the patrol row already locked (lock order: patrol first, see scores.ts).
 */
import type { PatrolStatusValue } from '@scouttavling/domain';
import { eq } from 'drizzle-orm';
import { schema, type Tx } from './db/index.ts';
import { recordChange } from './changes.ts';

export async function setPatrolStatus(
	tx: Tx,
	a: {
		competitionId: string;
		patrolId: string;
		from: PatrolStatusValue;
		to: PatrolStatusValue;
		deviceId?: string | null;
		userId?: string | null;
		/** When it happened (a phone's visit time); default now. */
		at?: Date;
		/** false when the caller records one change for a larger write itself. */
		feed?: boolean;
	}
) {
	const at = a.at ?? new Date();
	const ev = (status: PatrolStatusValue, when: Date) => ({ patrolId: a.patrolId, status, deviceId: a.deviceId ?? null, userId: a.userId ?? null, at: when });
	await tx.update(schema.patrol).set({ status: a.to }).where(eq(schema.patrol.id, a.patrolId));
	// Straight from Anmäld to I läger / I mål: record the start too (follow page "Startade").
	if (a.from === 'registered' && (a.to === 'camp' || a.to === 'finished')) await tx.insert(schema.statusEvent).values(ev('active', new Date(at.getTime() - 1)));
	await tx.insert(schema.statusEvent).values(ev(a.to, at));
	if (a.feed !== false) await recordChange(tx, a.competitionId, 'patrol', a.patrolId);
}

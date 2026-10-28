import { sql } from 'drizzle-orm';
import { schema, type Queryable } from './db/index.ts';

export type ChangeKind = 'score' | 'patrol' | 'station' | 'competition' | 'message' | 'conflict' | 'device';

/**
 * Appends to the per-competition change feed and wakes SSE listeners on every
 * instance (pg_notify is only a hint; consumers resume from change_log.seq).
 * Call inside the same transaction as the write.
 */
export async function recordChange(tx: Queryable, competitionId: string, kind: ChangeKind, entityId: string | null = null) {
	const [row] = await tx.insert(schema.changeLog).values({ competitionId, kind, entityId }).returning({ seq: schema.changeLog.seq });
	await tx.execute(sql`select pg_notify('changes', ${JSON.stringify({ c: competitionId, k: kind, s: row.seq })})`);
	return row.seq;
}

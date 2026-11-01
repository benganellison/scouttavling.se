/* Messages from HQ: which phones a message reaches, and who has read it. */
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db, schema } from './db/index.ts';

export function deviceInAudience(d: { role: string; stationIds: string[] }, audience: string[]) {
	if (audience.includes('all')) return true;
	if (audience.includes('startfinish') && d.role === 'startfinish') return true;
	return d.stationIds.some((s) => audience.includes(s));
}

export async function devicesFor(competitionId: string) {
	return db
		.select()
		.from(schema.device)
		.where(and(eq(schema.device.competitionId, competitionId), isNull(schema.device.revokedAt)));
}

export async function readsFor(messageIds: string[]) {
	if (messageIds.length === 0) return [];
	return db.select().from(schema.messageRead).where(inArray(schema.messageRead.messageId, messageIds));
}

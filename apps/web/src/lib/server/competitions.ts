/**
 * Creating a competition, shared by "Ny tävling", "Skapa nästa år" and the gokapp import CLI. Kit-free
 * (no $app imports; db/index.ts only for types), so the CLI can use it with its own connection.
 */
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import * as schema from './db/schema.ts';
import type { Queryable } from './db/index.ts';
import { isReservedSlug } from '../routing/slugs.ts';

/**
 * A slug is taken when a series or competition has it (they share /t/<slug> and the short address
 * /<slug>), or when it is reserved for a route (#lib/routing/slugs.ts).
 */
export async function slugTaken(q: Queryable, slug: string): Promise<boolean> {
	if (isReservedSlug(slug)) return true;
	const [a] = await q.select({ id: schema.series.id }).from(schema.series).where(eq(schema.series.slug, slug)).limit(1);
	if (a) return true;
	const [b] = await q.select({ id: schema.competition.id }).from(schema.competition).where(eq(schema.competition.slug, slug)).limit(1);
	return !!b;
}

/** The secret behind patrol QR check codes (#lib/domain patrolCode). Never shown. */
export const newPatrolCodeKey = () => randomBytes(24).toString('base64url');

/** Inserts the competition with its own patrol-code key and makes `ownerUserId` its owner. */
export async function insertCompetition(
	q: Queryable,
	values: Omit<typeof schema.competition.$inferInsert, 'patrolCodeKey' | 'createdBy'>,
	ownerUserId: string
) {
	const [comp] = await q
		.insert(schema.competition)
		.values({ ...values, patrolCodeKey: newPatrolCodeKey(), createdBy: ownerUserId })
		.returning();
	await q.insert(schema.competitionMember).values({ competitionId: comp.id, userId: ownerUserId, role: 'owner' });
	return comp;
}

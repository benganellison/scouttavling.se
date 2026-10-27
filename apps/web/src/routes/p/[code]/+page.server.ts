import { error } from '@sveltejs/kit';
import { eq, and } from 'drizzle-orm';
import { passLimiter } from '#lib/server/limits.ts';
import { refuseIfSuspended } from '#lib/server/suspended.ts';
import { parsePatrolCode, verifyPatrolCode } from '@scouttavling/domain';
import type { PageServerLoad } from './$types';
import { db, schema } from '#lib/server/db/index.ts';

/** Neutral landing for a patrol QR opened with a normal camera (C6): name only, no private data. */
export const load: PageServerLoad = async ({ params, setHeaders, getClientAddress }) => {
	if (!passLimiter.hit(getClientAddress())) error(429, 'För många försök. Vänta en stund och försök igen.');
	setHeaders({ 'x-robots-tag': 'noindex', 'referrer-policy': 'no-referrer' });
	const code = parsePatrolCode(params.code);
	if (!code) return { patrol: null };
	const [row] = await db
		.select({ number: schema.patrol.number, name: schema.patrol.name, comp: schema.competition.name, slug: schema.competition.slug, key: schema.competition.patrolCodeKey, suspendedAt: schema.competition.suspendedAt })
		.from(schema.patrol)
		.innerJoin(schema.competition, eq(schema.competition.id, schema.patrol.competitionId))
		.where(and(eq(schema.competition.slug, code.comp), eq(schema.patrol.number, code.nr)))
		.limit(1);
	if (!row || !(await verifyPatrolCode(row.key, code))) return { patrol: null };
	refuseIfSuspended(row);
	return { patrol: { number: row.number, name: row.name, competition: row.comp, slug: row.slug } };
};

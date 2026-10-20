import { eq, and } from 'drizzle-orm';
import { parsePatrolCode, verifyPatrolCode } from '@scouttavling/domain';
import type { PageServerLoad } from './$types';
import { db, schema } from '#lib/server/db/index.ts';

/** Neutral landing for a patrol QR opened with a normal camera (C6): name only, no private data. */
export const load: PageServerLoad = async ({ params, setHeaders }) => {
	setHeaders({ 'x-robots-tag': 'noindex', 'referrer-policy': 'no-referrer' });
	const code = parsePatrolCode(params.code);
	if (!code) return { patrol: null };
	const [row] = await db
		.select({ number: schema.patrol.number, name: schema.patrol.name, comp: schema.competition.name, slug: schema.competition.slug, key: schema.competition.patrolCodeKey })
		.from(schema.patrol)
		.innerJoin(schema.competition, eq(schema.competition.id, schema.patrol.competitionId))
		.where(and(eq(schema.competition.slug, code.comp), eq(schema.patrol.number, code.nr)))
		.limit(1);
	if (!row || !(await verifyPatrolCode(row.key, code))) return { patrol: null };
	return { patrol: { number: row.number, name: row.name, competition: row.comp, slug: row.slug } };
};

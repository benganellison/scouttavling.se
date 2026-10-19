import { desc, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '#lib/server/db/index.ts';
import { requireUser } from '#lib/server/auth.ts';

export async function load(event) {
	const user = requireUser(event);
	const rows = await db
		.selectDistinct({ c: schema.competition })
		.from(schema.competition)
		.innerJoin(schema.competitionMember, eq(schema.competitionMember.competitionId, schema.competition.id))
		.where(eq(schema.competitionMember.userId, user.id))
		.orderBy(desc(schema.competition.startDate));
	const ids = rows.map((r) => r.c.id);
	const counts = ids.length
		? await db
				.select({ id: schema.patrol.competitionId, n: sql<number>`count(*)::int` })
				.from(schema.patrol)
				.where(inArray(schema.patrol.competitionId, ids))
				.groupBy(schema.patrol.competitionId)
		: [];
	const byId = new Map(counts.map((c) => [c.id, c.n]));
	return {
		user: { name: user.name },
		competitions: rows.map(({ c }) => ({
			slug: c.slug,
			name: c.name,
			startDate: c.startDate,
			endDate: c.endDate,
			multiDay: c.multiDay,
			status: c.status,
			location: c.location,
			owner: c.ownerGroupName,
			patrols: byId.get(c.id) ?? 0
		}))
	};
}

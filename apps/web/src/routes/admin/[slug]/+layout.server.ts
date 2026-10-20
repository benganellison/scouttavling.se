import { asc, eq } from 'drizzle-orm';
import { db, schema } from '#lib/server/db/index.ts';
import { requireCompetition } from '#lib/server/auth.ts';

/**
 * Admin shell data, shared by every page under /admin/[slug]:
 * `competition`, `days`, `tracks`, `roles` and `user`.
 */
export async function load(event) {
	const { user, comp, roles } = await requireCompetition(event, event.params.slug);
	const [days, tracks] = await Promise.all([
		db.select().from(schema.day).where(eq(schema.day.competitionId, comp.id)).orderBy(asc(schema.day.sort)),
		db.select().from(schema.track).where(eq(schema.track.competitionId, comp.id)).orderBy(asc(schema.track.sort))
	]);
	return { competition: comp, days, tracks, roles, user: { id: user.id, name: user.name, memberNo: user.memberNo } };
}

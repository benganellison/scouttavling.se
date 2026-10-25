import { desc, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '#lib/server/db/index.ts';
import { requireUser } from '#lib/server/auth.ts';

export async function load(event) {
	const user = requireUser(event);
	const rows = await db
		.selectDistinct({ c: schema.competition, s: { slug: schema.series.slug, name: schema.series.name } })
		.from(schema.competition)
		.innerJoin(schema.competitionMember, eq(schema.competitionMember.competitionId, schema.competition.id))
		.leftJoin(schema.series, eq(schema.series.id, schema.competition.seriesId))
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
	const competitions = rows.map(({ c, s }) => ({
		series: s?.slug ? { slug: s.slug, name: s.name } : null,
		year: c.editionYear,
		anonymised: !!c.anonymisedAt,
		slug: c.slug,
		name: c.name,
		startDate: c.startDate,
		endDate: c.endDate,
		multiDay: c.multiDay,
		status: c.status,
		location: c.location,
		owner: c.ownerGroupName,
		patrols: byId.get(c.id) ?? 0
	}));
	// Editions grouped under their series (newest series first, by their newest edition); one-offs last.
	const groups: { series: { slug: string; name: string } | null; competitions: typeof competitions }[] = [];
	for (const c of competitions) {
		const g = groups.find((x) => (c.series ? x.series?.slug === c.series.slug : x.series === null));
		if (g) g.competitions.push(c);
		else groups.push({ series: c.series, competitions: [c] });
	}
	groups.sort((a, b) => (a.series === null ? 1 : b.series === null ? -1 : 0));
	return { user: { name: user.name }, competitions, groups };
}

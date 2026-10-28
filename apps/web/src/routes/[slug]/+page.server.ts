import { error, redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db, schema } from '#lib/server/db/index.ts';
import { isReservedSlug } from '#lib/routing/slugs.ts';

/**
 * Short address for posters and messages: scouttavling.se/<slug> → /t/<slug> (a competition or a
 * series). Static routes always win over this one, and route names are reserved slugs
 * (#lib/routing/slugs.ts). 302, not 301: a slug can be freed and reused, and browsers keep 301s.
 */
export async function load({ params, url }) {
	const slug = params.slug.toLowerCase();
	if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || isReservedSlug(slug)) error(404, 'Sidan finns inte');
	const [comp] = await db
		.select({ id: schema.competition.id, status: schema.competition.status })
		.from(schema.competition)
		.where(eq(schema.competition.slug, slug))
		.limit(1);
	const series = comp ? null : (await db.select({ id: schema.series.id }).from(schema.series).where(eq(schema.series.slug, slug)).limit(1))[0];
	// A draft is not public yet: same answer as an unknown address, so short links do not reveal it.
	if ((!comp && !series) || comp?.status === 'draft') error(404, 'Sidan finns inte');
	redirect(302, `/t/${slug}${url.search}`);
}

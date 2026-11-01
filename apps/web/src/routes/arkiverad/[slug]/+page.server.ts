import { error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db, schema } from '#lib/server/db/index.ts';
import { loadBranding, seriesOf } from '#lib/server/assets.ts';

/** Where old patrol links (/m, /folj) of an archived edition land. No personal data. */
export async function load({ params, setHeaders }) {
	const [comp] = await db.select().from(schema.competition).where(eq(schema.competition.slug, params.slug)).limit(1);
	if (!comp || !comp.anonymisedAt) error(404, 'Sidan finns inte');
	const [branding, series] = await Promise.all([loadBranding(comp), seriesOf(comp.id)]);
	setHeaders({ 'cache-control': 'public, max-age=300', 'x-robots-tag': 'noindex' });
	return {
		comp: { name: comp.name, slug: comp.slug, publicResults: comp.publicResults },
		series: series ? { slug: series.slug, name: series.name } : null,
		branding
	};
}

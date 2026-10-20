import { error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db, schema } from '#lib/server/db/index.ts';
import { getResults, publicTracks } from '#lib/server/live.ts';

/** Public, phone-first results. Only when publicResults; no personal data (patrol name + kår). */
export async function load({ params, setHeaders }) {
	const [comp] = await db.select().from(schema.competition).where(eq(schema.competition.slug, params.slug)).limit(1);
	if (!comp || !comp.publicResults) error(404, 'Resultaten är inte publicerade');
	const res = await getResults(comp, 10_000);
	setHeaders({ 'cache-control': 'public, max-age=5' });
	return { comp: { slug: comp.slug, name: comp.name, location: comp.location }, seq: res.seq, tracks: publicTracks(res.tracks) };
}

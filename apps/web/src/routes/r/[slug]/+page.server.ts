import { error } from '@sveltejs/kit';
import { refuseIfSuspended } from '#lib/server/suspended.ts';
import { eq } from 'drizzle-orm';
import { db, schema } from '#lib/server/db/index.ts';
import { getResults, publicTracks } from '#lib/server/live.ts';
import { loadBranding, loadTrackColors } from '#lib/server/assets.ts';

/** Public, phone-first results. Only when publicResults; no personal data (patrol name + kår). */
export async function load({ params, setHeaders }) {
	const [comp] = await db.select().from(schema.competition).where(eq(schema.competition.slug, params.slug)).limit(1);
	if (!comp || !comp.publicResults) error(404, 'Resultaten är inte publicerade');
	refuseIfSuspended(comp);
	const res = await getResults(comp, 10_000);
	setHeaders({ 'cache-control': 'public, max-age=5' });
	const [branding, trackColors] = await Promise.all([loadBranding(comp), loadTrackColors(comp.id)]);
	return { comp: { slug: comp.slug, name: comp.name, location: comp.location, final: comp.status === 'closed' }, seq: res.seq, tracks: publicTracks(res.tracks), branding, trackColors };
}

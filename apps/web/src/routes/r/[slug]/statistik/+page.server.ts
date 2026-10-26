import { error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { refuseIfSuspended } from '#lib/server/suspended.ts';
import { db, schema } from '#lib/server/db/index.ts';
import { loadBranding, loadTrackColors } from '#lib/server/assets.ts';
import { loadStats } from '#lib/server/stats.ts';

/**
 * Public statistics: only when the results are public. No personal data and nothing about
 * registrations or payments; points per station and times follow showStationResults().
 */
export async function load({ params, setHeaders }) {
	const [comp] = await db.select().from(schema.competition).where(eq(schema.competition.slug, params.slug)).limit(1);
	if (!comp || !comp.publicResults) error(404, 'Resultaten är inte publicerade');
	refuseIfSuspended(comp);
	const [stats, branding, trackColors] = await Promise.all([loadStats(comp), loadBranding(comp), loadTrackColors(comp.id)]);
	setHeaders({ 'cache-control': 'public, max-age=30' });
	return { comp: { slug: comp.slug, name: comp.name, final: comp.status === 'closed' }, stats, branding, trackColors };
}

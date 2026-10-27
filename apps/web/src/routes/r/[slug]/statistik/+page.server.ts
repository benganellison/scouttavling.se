import { error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { refuseIfDraft, refuseIfSuspended } from '#lib/server/suspended.ts';
import { db, schema } from '#lib/server/db/index.ts';
import { loadBranding, loadTrackColors } from '#lib/server/assets.ts';
import { loadStats } from '#lib/server/stats.ts';
import { cachedForCompetition } from '#lib/server/compCache.ts';

/**
 * Public statistics: only when the results are public. No personal data and nothing about
 * registrations or payments; points per station and times follow showStationResults().
 */
export async function load({ params, setHeaders, locals }) {
	const [comp] = await db.select().from(schema.competition).where(eq(schema.competition.slug, params.slug)).limit(1);
	if (!comp || !comp.publicResults) error(404, 'Resultaten är inte publicerade');
	refuseIfSuspended(comp);
	await refuseIfDraft(comp, locals.user?.id);
	// Many parents open it at once: computed once per change (or per 30 s under load), not per visit.
	// The key includes what decides what is public, so a settings change is never served stale.
	const key = `stats:${comp.id}:${comp.status}:${comp.stationResultsLive}:${comp.styleEnabled}`;
	const [stats, branding, trackColors] = await Promise.all([
		cachedForCompetition(key, comp.id, 30_000, () => loadStats(comp)),
		cachedForCompetition(`branding:${comp.id}`, comp.id, 30_000, () => loadBranding(comp)),
		loadTrackColors(comp.id)
	]);
	setHeaders({ 'cache-control': 'public, max-age=30' });
	return { comp: { slug: comp.slug, name: comp.name, final: comp.status === 'closed' }, stats, branding, trackColors };
}

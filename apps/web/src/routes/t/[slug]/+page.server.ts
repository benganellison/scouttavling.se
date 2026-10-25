import { error } from '@sveltejs/kit';
import { competitionBySlug, isMember, spotCount, tracksWithCounts, windowFor } from '#lib/server/registration.ts';
import { windowText } from '#lib/registration/rules.ts';
import { loadBranding, loadSeriesBranding, seriesOf } from '#lib/server/assets.ts';
import { editionYearOf, seriesArchive, seriesBySlug } from '#lib/server/series.ts';

/**
 * /t/<slug>: an edition's public page; if no edition has the slug, the series page (archive).
 * Edition slugs win, so every existing /t/<edition-slug> URL keeps working. No personal data.
 */
export async function load({ params, locals, setHeaders }) {
	const comp = await competitionBySlug(params.slug);
	if (!comp) return seriesPage(params.slug, setHeaders);
	const preview = comp.status === 'draft';
	if (preview && !(await isMember(comp.id, locals.user?.id))) error(404, 'Tävlingen finns inte');
	const [tracks, count, branding, series] = await Promise.all([tracksWithCounts(comp.id), spotCount(comp.id), loadBranding(comp), seriesOf(comp.id)]);
	const w = windowFor(comp, count);
	setHeaders({ 'cache-control': preview ? 'private, no-store' : 'public, max-age=0, must-revalidate' });
	return {
		kind: 'competition' as const,
		preview,
		comp: {
			slug: comp.slug, name: comp.name, startDate: comp.startDate, endDate: comp.endDate, multiDay: comp.multiDay, location: comp.location,
			organiser: comp.ownerGroupName, infoText: comp.infoText, publicResults: comp.publicResults, status: comp.status, maxPatrols: comp.maxPatrols
		},
		series: series ? { slug: series.slug, name: series.name } : null,
		branding,
		tracks: tracks.map((t) => ({ name: t.name, color: t.color, patrols: t.patrols })),
		patrolCount: count,
		window: { state: w.state, opensOn: w.opensOn, closesOn: w.closesOn, spotsLeft: w.spotsLeft, text: windowText(w, w.today), today: w.today }
	};
}

async function seriesPage(slug: string, setHeaders: (h: Record<string, string>) => void) {
	const series = await seriesBySlug(slug);
	if (!series) error(404, 'Tävlingen finns inte');
	const [branding, { current, currentPatrols, archive }] = await Promise.all([loadSeriesBranding(series), seriesArchive(series)]);
	let cur = null;
	if (current) {
		const w = windowFor(current, currentPatrols);
		cur = {
			slug: current.slug, name: current.name, year: editionYearOf(current), startDate: current.startDate, endDate: current.endDate,
			multiDay: current.multiDay, location: current.location, status: current.status, publicResults: current.publicResults,
			patrols: currentPatrols, maxPatrols: current.maxPatrols,
			window: { state: w.state, spotsLeft: w.spotsLeft, text: windowText(w, w.today) }
		};
	}
	setHeaders({ 'cache-control': 'public, max-age=0, must-revalidate' });
	return {
		kind: 'series' as const,
		series: { slug: series.slug, name: series.name, organiser: series.ownerGroupName },
		branding,
		current: cur,
		archive
	};
}

import { error } from '@sveltejs/kit';
import { competitionBySlug, isMember, spotCount, tracksWithCounts, windowFor } from '#lib/server/registration.ts';
import { windowText } from '#lib/registration/rules.ts';

/** Public competition page. No personal data: names of classes and counts only. */
export async function load({ params, locals, setHeaders }) {
	const comp = await competitionBySlug(params.slug);
	if (!comp) error(404, 'Tävlingen finns inte');
	const preview = comp.status === 'draft';
	if (preview && !(await isMember(comp.id, locals.user?.id))) error(404, 'Tävlingen finns inte');
	const [tracks, count] = await Promise.all([tracksWithCounts(comp.id), spotCount(comp.id)]);
	const w = windowFor(comp, count);
	setHeaders({ 'cache-control': preview ? 'private, no-store' : 'public, max-age=0, must-revalidate' });
	return {
		preview,
		comp: {
			slug: comp.slug, name: comp.name, startDate: comp.startDate, endDate: comp.endDate, multiDay: comp.multiDay, location: comp.location,
			organiser: comp.ownerGroupName, infoText: comp.infoText, publicResults: comp.publicResults, status: comp.status, maxPatrols: comp.maxPatrols
		},
		tracks: tracks.map((t) => ({ name: t.name, patrols: t.patrols })),
		patrolCount: count,
		window: { state: w.state, opensOn: w.opensOn, closesOn: w.closesOn, spotsLeft: w.spotsLeft, text: windowText(w, w.today), today: w.today }
	};
}

import { loadBranding } from '#lib/server/assets.ts';
import { refuseIfSuspended } from '#lib/server/suspended.ts';
import { error, fail } from '@sveltejs/kit';
import {
	competitionBySlug, isMember, publicOrigin, registerLimiter, registerPatrol, spotCount, tracksWithCounts, windowFor
} from '#lib/server/registration.ts';
import { readForm, validateRegistration, windowText } from '#lib/registration/rules.ts';

async function loadComp(slug: string, userId: string | undefined) {
	const comp = await competitionBySlug(slug);
	if (!comp) error(404, 'Tävlingen finns inte');
	refuseIfSuspended(comp);
	if (comp.status === 'draft' && !(await isMember(comp.id, userId))) error(404, 'Tävlingen finns inte');
	return comp;
}

export async function load({ params, locals, setHeaders }) {
	const comp = await loadComp(params.slug, locals.user?.id);
	const [tracks, count, branding] = await Promise.all([tracksWithCounts(comp.id), spotCount(comp.id), loadBranding(comp)]);
	const w = windowFor(comp, count);
	setHeaders({ 'cache-control': 'private, no-store' });
	return {
		branding,
		comp: { slug: comp.slug, name: comp.name, startDate: comp.startDate, endDate: comp.endDate, location: comp.location },
		tracks: tracks.map((t) => ({ id: t.id, name: t.name, color: t.color, patrols: t.patrols })),
		window: { state: w.state, spotsLeft: w.spotsLeft, text: windowText(w, w.today) }
	};
}

export const actions = {
	default: async ({ params, request, locals, getClientAddress, url }) => {
		const comp = await loadComp(params.slug, locals.user?.id);
		const f = await request.formData();
		const raw = readForm(f);
		// Honeypot: humans never see this field. Pretend all is fine but store nothing.
		if (String(f.get('website') ?? '').trim()) return fail(400, { values: raw, errors: { form: 'Anmälan kunde inte skickas. Försök igen.' } });
		if (!registerLimiter.hit(getClientAddress())) {
			return fail(429, { values: raw, errors: { form: 'För många anmälningar från din uppkoppling. Vänta en stund och försök igen.' } });
		}
		const tracks = await tracksWithCounts(comp.id);
		const v = validateRegistration(raw, tracks.map((t) => t.id));
		if (!v.ok) return fail(400, { values: raw, errors: v.errors });
		const res = await registerPatrol(comp.id, v.data);
		if (!res.ok) {
			const w = windowFor(comp, await spotCount(comp.id));
			return fail(409, { values: raw, errors: { form: res.reason === 'full' ? 'Tyvärr, tävlingen blev fullbokad precis innan du skickade.' : windowText(w, w.today) } });
		}
		const origin = publicOrigin(url);
		return {
			done: {
				number: res.number,
				patrolName: v.data.patrolName,
				track: tracks.find((t) => t.id === v.data.trackId)?.name ?? '',
				contactEmail: v.data.contactEmail,
				manageUrl: `${origin}/m/${res.manageToken}`,
				followUrl: `${origin}/folj/${res.followToken}`,
				followEnabled: comp.followEnabled,
				confirmationText: comp.confirmationText
			}
		};
	}
};

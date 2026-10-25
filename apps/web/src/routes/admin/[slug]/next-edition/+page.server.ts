import { fail, redirect } from '@sveltejs/kit';
import { createNextEdition, planNextEdition, requireNextEditionSource, slugTaken } from '#lib/server/series.ts';
import { slugify } from '#lib/ui/admin/format.ts';

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const RESERVED = new Set(['new', 'admin', 'api', 'login', 'auth', 'r', 'j', 'f', 'p', 'ny', 'series']);

/**
 * "Skapa <serie> <år+1>": confirm form with the shifted dates (the organiser may adjust them).
 * Reached from a closed edition's overview, the series page and "Ny tävling" → "Nytt år i en
 * befintlig serie" (which links here with the series' newest edition as the source).
 */
export async function load(event) {
	const { comp } = await requireNextEditionSource(event, event.params.slug);
	return { plan: await planNextEdition(comp) };
}

export const actions = {
	default: async (event) => {
		const { comp, user } = await requireNextEditionSource(event, event.params.slug);
		const plan = await planNextEdition(comp);
		if (plan.existing) return fail(409, { errors: { form: `${plan.existing.name} finns redan.` } as Record<string, string> });
		const f = await event.request.formData();
		const s = (k: string) => String(f.get(k) ?? '').trim();
		const errors: Record<string, string> = {};
		const name = s('name');
		const slug = slugify(s('slug')) || plan.slug;
		const dates = plan.days.map((_, i) => s(`date_${i}`));
		const opens = s('registrationOpensOn') || null;
		const closes = s('registrationClosesOn') || null;
		if (name.length < 2 || name.length > 80) errors.name = 'Namnet ska vara 2–80 tecken.';
		if (RESERVED.has(slug)) errors.slug = 'Den adressen är reserverad.';
		else if (await slugTaken(slug)) errors.slug = `Adressen ${slug} är upptagen.`;
		dates.forEach((d, i) => {
			if (!ISO.test(d)) errors[`date_${i}`] = 'Välj ett datum.';
			else if (i > 0 && ISO.test(dates[i - 1]) && d <= dates[i - 1]) errors[`date_${i}`] = 'Dagarna måste komma i ordning.';
		});
		if (opens && !ISO.test(opens)) errors.registrationOpensOn = 'Välj ett datum.';
		if (closes && !ISO.test(closes)) errors.registrationClosesOn = 'Välj ett datum.';
		if (opens && closes && ISO.test(opens) && ISO.test(closes) && closes < opens) errors.registrationClosesOn = 'Anmälan kan inte stänga innan den öppnar.';
		const values = { name, slug: s('slug'), dates, registrationOpensOn: opens ?? '', registrationClosesOn: closes ?? '' };
		if (Object.keys(errors).length) return fail(400, { errors, values });
		const created = await createNextEdition(comp, { name, slug, dates, registrationOpensOn: opens, registrationClosesOn: closes }, user.id);
		redirect(303, `/admin/${created.slug}?ny=1`);
	}
};

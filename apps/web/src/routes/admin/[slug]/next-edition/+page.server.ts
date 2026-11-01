import { fail, redirect } from '@sveltejs/kit';
import { createNextEdition, planNextEdition, requireNextEditionSource, slugTaken } from '#lib/server/series.ts';
import * as v from 'valibot';
import { checkField, formInput, isoDate, optionalIsoDate, parseForm, requiredText, type FieldErrors } from '#lib/server/forms.ts';
import { isReservedSlug, slugify } from '#lib/routing/slugs.ts';

const NextEditionSchema = v.pipe(
	v.object({
		name: requiredText(2, 80, 'Namnet ska vara 2–80 tecken.'),
		registrationOpensOn: optionalIsoDate(),
		registrationClosesOn: optionalIsoDate()
	}),
	v.forward(
		v.partialCheck(
			[['registrationOpensOn'], ['registrationClosesOn']],
			(d) => !d.registrationOpensOn || !d.registrationClosesOn || d.registrationClosesOn >= d.registrationOpensOn,
			'Anmälan kan inte stänga innan den öppnar.'
		),
		['registrationClosesOn']
	)
);

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
		const input = formInput(await event.request.formData());
		const values = {
			name: String(input.name ?? '').trim(),
			slug: String(input.slug ?? '').trim(),
			dates: plan.days.map((_, i) => String(input[`date_${i}`] ?? '').trim()),
			registrationOpensOn: String(input.registrationOpensOn ?? '').trim(),
			registrationClosesOn: String(input.registrationClosesOn ?? '').trim()
		};
		const r = parseForm(NextEditionSchema, input);
		const errors: FieldErrors = r.ok ? {} : r.errors;
		const slug = slugify(values.slug) || plan.slug;
		if (isReservedSlug(slug)) errors.slug = 'Den adressen är reserverad.';
		else if (await slugTaken(slug)) errors.slug = `Adressen ${slug} är upptagen.`;
		// One date per day of the plan (date_0, date_1, …), in order.
		values.dates.forEach((d, i) => {
			const bad = checkField(isoDate(), d);
			if (bad) errors[`date_${i}`] = bad;
			else if (i > 0 && !checkField(isoDate(), values.dates[i - 1]) && d <= values.dates[i - 1]) errors[`date_${i}`] = 'Dagarna måste komma i ordning.';
		});
		if (!r.ok || Object.keys(errors).length) return fail(400, { errors, values });
		const { name, registrationOpensOn: opens, registrationClosesOn: closes } = r.data;
		const dates = values.dates;
		const created = await createNextEdition(comp, { name, slug, dates, registrationOpensOn: opens || null, registrationClosesOn: closes || null }, user.id);
		redirect(303, `/admin/${created.slug}?ny=1`);
	}
};

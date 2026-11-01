import { fail, redirect } from '@sveltejs/kit';
import { and, eq, gt, sql } from 'drizzle-orm';
import { CHECKPOINT_ITEM, daysBetween, DEFAULT_ITEM } from '@scouttavling/domain';
import { db, schema } from '#lib/server/db/index.ts';
import { requireUser } from '#lib/server/auth.ts';
import { insertCompetition } from '#lib/server/competitions.ts';
import { recordChange } from '#lib/server/changes.ts';
import * as v from 'valibot';
import { slugify } from '#lib/routing/slugs.ts';
import { checkbox, checkField, formInput, isoDate, optionalInt, parseForm, text } from '#lib/server/forms.ts';
import { loadSeriesBranding } from '#lib/server/assets.ts';
import { editionYearOf, editionsOf, organisedSeries, organisesEdition, slugTaken } from '#lib/server/series.ts';
import { isReservedSlug } from '#lib/routing/slugs.ts';
import { editionSlug } from '#lib/series/names.ts';
import { publicHost } from '#lib/server/origin.ts';

const PRESET_TRACKS = ['Spårare', 'Upptäckare', 'Äventyrare', 'Utmanare', 'Rover'];
const MAX_PER_DAY = 5;

const NewCompetitionSchema = v.object({
	name: v.pipe(text(80, 'Namnet får vara högst 80 tecken.'), v.minLength(2, 'Skriv ett namn på minst två tecken.')),
	location: text(200),
	hqPhone: text(30, 'Telefonnumret är för långt.'),
	stations: v.pipe(
		optionalInt(/^\d{1,2}$/, 'Antal kontroller: 0–60.'),
		v.transform((n) => n ?? 0),
		v.maxValue(60, 'Antal kontroller: 0–60.')
	),
	customTrack: v.array(text(40, 'Ett klassnamn får vara högst 40 tecken.')),
	styleEnabled: checkbox,
	publicResults: checkbox,
	registrationOpen: checkbox
});
const seriesNameField = v.pipe(text(80, 'Seriens namn får vara högst 80 tecken.'), v.minLength(2, 'Skriv seriens namn, minst två tecken.'));
const dayPrefix = v.pipe(v.string(), v.regex(/^[A-ZÅÄÖ]{1,3}$/, 'Prefix: 1–3 bokstäver.'));

/** A series the user may add a year to (owner/organiser of any edition), with what the new year inherits. */
export interface SeriesOption {
	id: string;
	slug: string;
	name: string;
	/** The newest edition: the copy source for "Skapa <serie> <år+1>". */
	latest: { slug: string; name: string; year: number } | null;
	nextName: string | null;
	/** Slug of an already existing edition for that year. */
	nextExists: string | null;
	/** The user may open the newest edition's next-year form (owner/organiser of it). */
	canCopy: boolean;
	branding: { accent: string | null; eventLogo: { url: string; alt: string } | null; cover: boolean; classColors: { name: string; color: string }[] };
}

async function seriesOptions(userId: string): Promise<SeriesOption[]> {
	return Promise.all(
		(await organisedSeries(userId)).map(async (s) => {
			const [editions, b] = await Promise.all([editionsOf(s.id), loadSeriesBranding(s)]);
			const latest = editions[0] ?? null;
			const year = latest ? editionYearOf(latest) : null;
			const next = year ? editions.find((e) => editionYearOf(e) === year + 1) : undefined;
			return {
				id: s.id,
				slug: s.slug,
				name: s.name,
				latest: latest && year ? { slug: latest.slug, name: latest.name, year } : null,
				nextName: year ? `${s.name} ${year + 1}` : null,
				nextExists: next?.slug ?? null,
				canCopy: latest ? await organisesEdition(userId, latest.id) : false,
				branding: {
					accent: b.customAccent ? b.accent : null,
					eventLogo: b.eventLogo ? { url: b.eventLogo.url, alt: b.eventLogo.alt } : null,
					cover: !!b.cover,
					classColors: Object.entries(s.classColors).map(([name, color]) => ({ name, color }))
				}
			};
		})
	);
}

export async function load(event) {
	const user = requireUser(event);
	return { groups: user.groups, presets: PRESET_TRACKS, series: await seriesOptions(user.id) };
}

type Errors = Record<string, string>;

export const actions = {
	default: async (event) => {
		const user = requireUser(event);
		const f = await event.request.formData();
		const input = formInput(f, ['track', 'customTrack']);
		const str = (k: string) => String(input[k] ?? '').trim();
		// Fields that are always there: shape and length (Valibot). Conditional fields and rules that
		// need the user or the database are checked below with the same field schemas.
		const parsed = parseForm(NewCompetitionSchema, input);
		const errors: Errors = parsed.ok ? {} : parsed.errors;
		if (errors.customTrack) {
			errors.tracks = errors.customTrack;
			delete errors.customTrack;
		}

		const name = str('name');
		const slugInput = slugify(str('slug'));
		const multiDay = str('length') === 'multi';
		const startDate = multiDay ? str('startDate') : str('date');
		const endDate = multiDay ? str('endDate') : startDate;
		const location = str('location');
		const hqPhone = str('hqPhone');
		const ownerNo = str('owner');
		const styleEnabled = parsed.ok && parsed.data.styleEnabled;
		const publicResults = parsed.ok && parsed.data.publicResults;
		const registrationOpen = parsed.ok && parsed.data.registrationOpen;
		const stationCount = parsed.ok ? parsed.data.stations : 0;
		const presetTracks = (input.track as string[]).filter((t) => PRESET_TRACKS.includes(t));
		const customTracks = (input.customTrack as string[]).map((t) => t.trim()).filter(Boolean);
		const tracks = [...new Set([...presetTracks, ...customTracks])];

		// Part of a series? 'single' (one-off), 'new' (create a series with this as its first year) or
		// 'existing' (handled by the next-year flow, so the copy logic lives in one place).
		const seriesMode = (['single', 'new', 'existing'] as const).find((m) => m === str('seriesMode')) ?? 'single';
		const seriesName = seriesMode === 'new' ? str('seriesName') : '';
		const seriesSlugInput = seriesMode === 'new' ? slugify(str('seriesSlug')) : '';
		const seriesSlug = seriesSlugInput || slugify(seriesName);

		const values = {
			seriesMode,
			seriesName,
			seriesSlug: str('seriesSlug'),
			name,
			slug: str('slug'),
			length: multiDay ? 'multi' : 'one',
			date: multiDay ? '' : startDate,
			startDate,
			endDate,
			location,
			hqPhone,
			owner: ownerNo,
			styleEnabled,
			publicResults,
			registrationOpen,
			stations: parsed.ok ? stationCount : Number(str('stations')) || 0,
			tracks: presetTracks,
			customTracks
		};

		if (seriesMode === 'existing') {
			const pick = (await seriesOptions(user.id)).find((o) => o.id === str('seriesId'));
			if (!pick) return fail(400, { errors: { seriesId: 'Välj en serie.' } as Errors, values });
			if (pick.nextExists) redirect(303, `/admin/${pick.nextExists}`);
			if (!pick.latest || !pick.canCopy)
				return fail(403, { errors: { seriesId: `Du är inte arrangör för ${pick.latest?.name ?? 'seriens senaste år'}.` } as Errors, values });
			redirect(303, `/admin/${pick.latest.slug}/next-edition`);
		}

		const slug = slugInput || slugify(name);
		if (name && !slug) errors.slug = 'Adressen måste innehålla bokstäver eller siffror.';
		else if (slugInput && isReservedSlug(slug)) errors.slug = 'Den adressen är reserverad. Välj en annan.';

		if (seriesMode === 'new') {
			const badName = checkField(seriesNameField, seriesName);
			if (badName) errors.seriesName = badName;
			else if (!seriesSlug) errors.seriesSlug = 'Adressen måste innehålla bokstäver eller siffror.';
			else if (isReservedSlug(seriesSlug)) errors.seriesSlug = 'Den adressen är reserverad. Välj en annan.';
			else if (await slugTaken(seriesSlug)) errors.seriesSlug = `Adressen ${publicHost(event.url)}/${seriesSlug} är upptagen av en annan serie eller tävling.`;
			else if (slugInput && slugInput === seriesSlug) errors.slug = 'Tävlingen och serien kan inte ha samma adress.';
		}

		const startOk = !checkField(isoDate(), startDate);
		if (!startOk) errors[multiDay ? 'startDate' : 'date'] = 'Välj ett datum.';
		if (multiDay) {
			const badEnd = checkField(isoDate('Välj sista dagen.'), endDate);
			if (badEnd) errors.endDate = badEnd;
			else if (startOk && endDate <= startDate) errors.endDate = 'Sista dagen måste vara efter första dagen.';
			else if (startOk && daysBetween(startDate, endDate).at(-1)?.date !== endDate) errors.endDate = 'En tävling kan vara högst 14 dagar.';
		}

		const group = user.groups.find((g) => g.groupNo === ownerNo);
		if (!group) errors.owner = 'Välj vilken kår eller vilket distrikt som äger tävlingen.';
		if (tracks.length === 0) errors.tracks ??= 'Välj minst en klass.';

		// Days + prefixes (multi-day only).
		const days =
			multiDay && !errors.startDate && !errors.endDate ? daysBetween(startDate, endDate) : startOk ? [{ date: startDate, name: '', prefix: 'K' }] : [];
		if (multiDay) {
			const seen = new Set<string>();
			for (const d of days) {
				const p =
					String(f.get(`prefix_${d.date}`) ?? d.prefix)
						.trim()
						.toUpperCase() || d.prefix;
				const badPrefix = checkField(dayPrefix, p);
				if (badPrefix) errors[`prefix_${d.date}`] = badPrefix;
				else if (seen.has(p)) errors[`prefix_${d.date}`] = 'Prefixet används redan av en annan dag.';
				seen.add(p);
				d.prefix = p;
			}
		}

		if (Object.keys(errors).length) return fail(400, { errors, values });

		// Rate limit: 5 new competitions per user and day.
		const [{ n }] = await db
			.select({ n: sql<number>`count(*)::int` })
			.from(schema.competition)
			.where(and(eq(schema.competition.createdBy, user.id), gt(schema.competition.createdAt, sql`now() - interval '1 day'`)));
		if (n >= MAX_PER_DAY) {
			return fail(429, { errors: { form: `Du har skapat ${MAX_PER_DAY} tävlingar det senaste dygnet. Vänta en stund och försök igen.` }, values });
		}

		// Unique slug: a typed one must be free; a generated one gets -2, -3 …
		// A generated slug equal to the new series' slug becomes "<serie>-<år>" (GökOpen → gokopen-2027).
		const editionYear = Number(startDate.slice(0, 4));
		const base = !slugInput && seriesMode === 'new' ? editionSlug(slug, seriesSlug, editionYear) : slug;
		let finalSlug = base;
		for (let i = 2; ; i++) {
			// Series pages share /t/<slug>, so a series slug is taken too.
			if (!(await slugTaken(finalSlug)) && !(seriesMode === 'new' && finalSlug === seriesSlug)) break;
			if (slugInput) return fail(400, { errors: { slug: `Adressen ${publicHost(event.url)}/${slugInput} är upptagen.` }, values });
			finalSlug = `${base}-${i}`;
			if (i > 99) return fail(400, { errors: { slug: 'Välj en annan adress.' }, values });
		}

		const created = await db.transaction(async (tx) => {
			const [series] =
				seriesMode === 'new'
					? await tx
							.insert(schema.series)
							.values({ slug: seriesSlug, name: seriesName, ownerGroupNo: group!.groupNo, ownerGroupName: group!.name, createdBy: user.id })
							.returning({ id: schema.series.id })
					: [];
			const comp = await insertCompetition(
				tx,
				{
					slug: finalSlug,
					name,
					ownerGroupNo: group!.groupNo,
					ownerGroupName: group!.name,
					multiDay,
					startDate,
					endDate,
					location: location || null,
					hqPhone: hqPhone || null,
					styleEnabled,
					publicResults,
					registrationOpen,
					status: 'draft',
					editionYear,
					seriesId: series?.id ?? null
				},
				user.id
			);
			const dayRows = multiDay
				? await tx
						.insert(schema.day)
						.values(days.map((d, i) => ({ competitionId: comp.id, date: d.date, name: d.name, prefix: d.prefix, sort: i + 1 })))
						.returning()
				: [];
			await tx.insert(schema.track).values(tracks.map((t, i) => ({ competitionId: comp.id, name: t, sort: i + 1 })));

			// Station layout.
			type Def = { name: string; dayId: string | null; checkpoint: boolean; role: 'start' | 'finish' | null };
			const defs: Def[] = [];
			if (!multiDay) {
				for (let i = 1; i <= stationCount; i++) defs.push({ name: `Kontroll ${i}`, dayId: null, checkpoint: false, role: null });
			} else {
				let k = 0;
				const base = Math.floor(stationCount / dayRows.length);
				const extra = stationCount % dayRows.length;
				for (const [di, d] of dayRows.entries()) {
					defs.push({ name: `${d.name} start`, dayId: d.id, checkpoint: true, role: 'start' });
					for (let j = 0; j < base + (di < extra ? 1 : 0); j++) defs.push({ name: `Kontroll ${++k}`, dayId: d.id, checkpoint: false, role: null });
					defs.push({ name: `${d.name} mål`, dayId: d.id, checkpoint: true, role: 'finish' });
				}
			}
			if (defs.length) {
				const stations = await tx
					.insert(schema.station)
					.values(defs.map((d, i) => ({ competitionId: comp.id, dayId: d.dayId, sort: i + 1, name: d.name, role: d.role, startable: !d.checkpoint })))
					.returning();
				await tx
					.insert(schema.scoreItem)
					.values(
						stations.map((s, i) =>
							defs[i].checkpoint ? { stationId: s.id, sort: 1, name: s.name, ...CHECKPOINT_ITEM } : { stationId: s.id, sort: 1, name: s.name, ...DEFAULT_ITEM }
						)
					);
			}
			await recordChange(tx, comp.id, 'competition', comp.id);
			return comp;
		});

		redirect(303, `/admin/${created.slug}`);
	}
};

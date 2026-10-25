import { fail } from '@sveltejs/kit';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { db, schema } from '#lib/server/db/index.ts';
import { recordChange } from '#lib/server/changes.ts';
import { ASSET_KINDS, loadSeriesBranding, removeImage, uploadImage } from '#lib/server/assets.ts';
import { editionYearOf, editionsOf, patrolCounts, requireSeries } from '#lib/server/series.ts';
import { MAX_BYTES } from '#lib/server/imageValidate.ts';
import { namedTrackColor, parseHex } from '#lib/brand/colors.ts';
import type { AssetKind } from '#lib/brand/branding.ts';

type Errors = Record<string, string>;

/** Organiser view of a series: its editions, shared branding, class colours and the public archive. */
export async function load(event) {
	const { user, series } = await requireSeries(event, event.params.slug);
	const editions = await editionsOf(series.id);
	const [counts, branding, tracks] = await Promise.all([
		patrolCounts(editions.map((e) => e.id)),
		loadSeriesBranding(series),
		editions.length
			? db.select({ name: schema.track.name, sort: schema.track.sort }).from(schema.track).where(inArray(schema.track.competitionId, editions.map((e) => e.id))).orderBy(asc(schema.track.sort))
			: []
	]);
	const classNames = [...new Set([...tracks.map((t) => t.name), ...Object.keys(series.classColors)])];
	const latest = editions[0] ?? null;
	const nextYear = latest ? editionYearOf(latest) + 1 : null;
	return {
		user: { name: user.name },
		series,
		branding,
		editions: editions.map((e) => ({
			slug: e.slug, name: e.name, year: editionYearOf(e), startDate: e.startDate, endDate: e.endDate, status: e.status, location: e.location,
			patrols: counts.get(e.id) ?? 0, archivePublic: e.archivePublic, anonymised: !!e.anonymisedAt, publicResults: e.publicResults
		})),
		classes: classNames.map((name) => ({ name, color: series.classColors[name] ?? null, fallback: namedTrackColor(name) })),
		next: latest && nextYear ? { from: latest.slug, name: `${series.name} ${nextYear}` } : null
	};
}

async function notifyAll(seriesId: string) {
	const eds = await db.select({ id: schema.competition.id }).from(schema.competition).where(eq(schema.competition.seriesId, seriesId));
	return eds.map((e) => e.id);
}

export const actions = {
	appearance: async (event) => {
		const { series } = await requireSeries(event, event.params.slug);
		const f = await event.request.formData();
		const text = String(f.get('accentColor') ?? '').trim();
		const accent = parseHex(text);
		const fitRaw = String(f.get('coverFit') ?? '');
		const coverFit = fitRaw === 'contain' || fitRaw === 'cover' ? fitRaw : null;
		if (text && !accent) return fail(400, { section: 'appearance', errors: { accentColor: 'Skriv en hexkod, t.ex. #003660, eller välj en färg.' } as Errors });
		const ids = await notifyAll(series.id);
		await db.transaction(async (tx) => {
			await tx.update(schema.series).set({ accentColor: accent, coverFit }).where(eq(schema.series.id, series.id));
			for (const id of ids) await recordChange(tx, id, 'competition', id);
		});
		return { section: 'appearance', ok: true };
	},

	upload: async (event) => {
		const { series, user } = await requireSeries(event, event.params.slug);
		const f = await event.request.formData();
		const kind = String(f.get('kind') ?? '') as AssetKind;
		if (!ASSET_KINDS.includes(kind)) return fail(400, { section: 'appearance', errors: { upload: 'Okänd bildtyp.' } as Errors });
		const file = f.get('file');
		if (!(file instanceof File) || file.size === 0) return fail(400, { section: 'appearance', errors: { [kind]: 'Välj en bild först.' } as Errors });
		if (file.size > MAX_BYTES) return fail(400, { section: 'appearance', errors: { [kind]: 'Bilden är större än 2 MB. Förminska den och försök igen.' } as Errors });
		const r = await uploadImage({ seriesId: series.id }, kind, new Uint8Array(await file.arrayBuffer()), user.id, await notifyAll(series.id));
		if (!r.ok) return fail(400, { section: 'appearance', errors: { [kind]: r.reason } as Errors });
		return { section: 'appearance', ok: true, uploaded: kind };
	},

	removeImage: async (event) => {
		const { series } = await requireSeries(event, event.params.slug);
		const kind = String((await event.request.formData()).get('kind') ?? '') as AssetKind;
		if (!ASSET_KINDS.includes(kind)) return fail(400, { section: 'appearance', errors: { upload: 'Okänd bildtyp.' } as Errors });
		await removeImage({ seriesId: series.id }, kind, await notifyAll(series.id));
		return { section: 'appearance', ok: true };
	},

	/** Class colour template: class name → colour, used by editions whose class has no own colour. */
	classColors: async (event) => {
		const { series } = await requireSeries(event, event.params.slug);
		const f = await event.request.formData();
		const names = f.getAll('class').map(String);
		const out: Record<string, string> = {};
		const errors: Errors = {};
		for (const name of names) {
			const raw = String(f.get(`color_${name}`) ?? '').trim();
			if (!raw) continue;
			const hex = parseHex(raw);
			if (!hex) errors[`color_${name}`] = 'Ogiltig färg.';
			else out[name] = hex;
		}
		if (Object.keys(errors).length) return fail(400, { section: 'classes', errors });
		const ids = await notifyAll(series.id);
		await db.transaction(async (tx) => {
			await tx.update(schema.series).set({ classColors: out }).where(eq(schema.series.id, series.id));
			for (const id of ids) await recordChange(tx, id, 'competition', id);
		});
		return { section: 'classes', ok: true };
	},

	/** Show or hide one year under "Tidigare år" on the public series page. */
	archive: async (event) => {
		const { series } = await requireSeries(event, event.params.slug);
		const f = await event.request.formData();
		const slug = String(f.get('edition') ?? '');
		const show = f.get('show') === '1';
		const [e] = await db
			.update(schema.competition)
			.set({ archivePublic: show })
			.where(and(eq(schema.competition.slug, slug), eq(schema.competition.seriesId, series.id)))
			.returning({ id: schema.competition.id });
		if (!e) return fail(404, { section: 'editions', errors: { editions: 'Året finns inte i serien.' } as Errors });
		return { section: 'editions', ok: true };
	}
};

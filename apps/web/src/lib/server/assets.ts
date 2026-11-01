import { createHash } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import { db, schema } from './db/index.ts';
import { recordChange } from './changes.ts';
import { validateImage } from './imageValidate.ts';
import { deleteAsset, listAssets, saveAsset, type AssetOwner } from './assetStore.ts';
import { trackColors, type ClassColorTemplate } from '#lib/brand/colors.ts';
import { resolveBranding, type AssetKind, type AssetMeta, type Branding } from '#lib/brand/branding.ts';

export const ASSET_KINDS: AssetKind[] = ['event_logo', 'organiser_logo', 'cover'];

type SeriesRow = typeof schema.series.$inferSelect;

/** The series of an edition (null for one-off competitions). */
export async function seriesOf(competitionId: string): Promise<SeriesRow | null> {
	const [row] = await db
		.select({ s: schema.series })
		.from(schema.competition)
		.innerJoin(schema.series, eq(schema.series.id, schema.competition.seriesId))
		.where(eq(schema.competition.id, competitionId))
		.limit(1);
	return row?.s ?? null;
}

const meta = (rows: { id: string; kind: AssetKind; width: number; height: number }[]): AssetMeta[] =>
	rows.map((r) => ({ id: r.id, kind: r.kind, width: r.width, height: r.height }));

/**
 * Branding for any page that has the competition row: edition override → series → Scouterna base
 * (see resolveBranding). Every page that shows branding goes through here.
 */
export async function loadBranding(comp: {
	id: string;
	name: string;
	ownerGroupName: string | null;
	accentColor: string | null;
	coverFit: 'contain' | 'cover' | null;
}): Promise<Branding> {
	const series = await seriesOf(comp.id);
	const assets = await listAssets(series ? [{ competitionId: comp.id }, { seriesId: series.id }] : [{ competitionId: comp.id }]);
	return resolveBranding(
		{ ...comp, assets: meta(assets.filter((a) => a.competitionId === comp.id)) },
		series ? { ...series, assets: meta(assets.filter((a) => a.seriesId === series.id)) } : null
	);
}

/** Branding of a series page itself (no edition override). */
export async function loadSeriesBranding(series: SeriesRow): Promise<Branding> {
	const assets = meta(await listAssets([{ seriesId: series.id }]));
	return resolveBranding({ name: series.name, ownerGroupName: series.ownerGroupName, accentColor: null, coverFit: null, assets: [] }, { ...series, assets });
}

/**
 * Validates, strips and stores an upload for an edition or a series, replacing the previous image
 * of that kind. Callers must have checked the organiser role first. `notify` = editions whose live
 * screens should refresh (the edition itself, or every edition of the series).
 */
export async function uploadImage(
	owner: AssetOwner,
	kind: AssetKind,
	input: Uint8Array,
	userId: string | null,
	notify: string[]
): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
	const v = validateImage(input);
	if (!v.ok) return v;
	const sha256 = createHash('sha256').update(v.bytes).digest('hex');
	const id = await db.transaction(async (tx) => {
		const id = await saveAsset(tx, owner, kind, { mime: v.mime, bytes: v.bytes, width: v.width, height: v.height, sha256 }, userId);
		for (const c of notify) await recordChange(tx, c, 'competition', c);
		return id;
	});
	return { ok: true, id };
}

export async function removeImage(owner: AssetOwner, kind: AssetKind, notify: string[]) {
	await db.transaction(async (tx) => {
		await deleteAsset(tx, owner, kind);
		for (const c of notify) await recordChange(tx, c, 'competition', c);
	});
}

/** The series' class colour template for an edition ({} for one-off competitions). */
export async function classColorTemplate(competitionId: string): Promise<ClassColorTemplate> {
	return (await seriesOf(competitionId))?.classColors ?? {};
}

/** Effective class colours of a competition, by track id (own colour → series template → default). */
export async function loadTrackColors(competitionId: string): Promise<Record<string, string>> {
	const [tracks, template] = await Promise.all([
		db
			.select({ id: schema.track.id, name: schema.track.name, color: schema.track.color })
			.from(schema.track)
			.where(eq(schema.track.competitionId, competitionId))
			.orderBy(asc(schema.track.sort)),
		classColorTemplate(competitionId)
	]);
	return trackColors(tracks, template);
}

export async function trackColorFor(competitionId: string, trackId: string): Promise<string | null> {
	return (await loadTrackColors(competitionId))[trackId] ?? null;
}

import { createHash } from 'node:crypto';
import { and, asc, eq } from 'drizzle-orm';
import { db, schema } from './db/index.ts';
import { recordChange } from './changes.ts';
import { validateImage } from './imageValidate.ts';
import { trackColors } from '#lib/brand/colors.ts';
import { buildBranding, type AssetKind, type AssetMeta, type Branding } from '#lib/brand/branding.ts';

export const ASSET_KINDS: AssetKind[] = ['event_logo', 'organiser_logo', 'cover'];

/** Metadata (never bytes) of a competition's uploaded images. */
export async function assetMeta(competitionId: string): Promise<AssetMeta[]> {
	return db
		.select({ id: schema.asset.id, kind: schema.asset.kind, width: schema.asset.width, height: schema.asset.height })
		.from(schema.asset)
		.where(eq(schema.asset.competitionId, competitionId));
}

/** Branding for any page that has the competition row. */
export async function loadBranding(comp: { id: string; name: string; ownerGroupName: string | null; accentColor: string | null; coverFit: 'contain' | 'cover' | null }): Promise<Branding> {
	return buildBranding(comp, await assetMeta(comp.id));
}

/**
 * Validates, strips and stores an upload, replacing the previous image of that kind.
 * Callers must have checked the organiser role first.
 */
export async function saveAsset(competitionId: string, kind: AssetKind, input: Uint8Array, userId: string | null): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
	const v = validateImage(input);
	if (!v.ok) return v;
	const sha256 = createHash('sha256').update(v.bytes).digest('hex');
	const id = await db.transaction(async (tx) => {
		await tx.delete(schema.asset).where(and(eq(schema.asset.competitionId, competitionId), eq(schema.asset.kind, kind)));
		const [row] = await tx
			.insert(schema.asset)
			.values({ competitionId, kind, mime: v.mime, size: v.bytes.length, width: v.width, height: v.height, sha256, data: v.bytes, uploadedBy: userId })
			.returning({ id: schema.asset.id });
		await recordChange(tx, competitionId, 'competition', competitionId);
		return row.id;
	});
	return { ok: true, id };
}

export async function removeAsset(competitionId: string, kind: AssetKind) {
	await db.transaction(async (tx) => {
		await tx.delete(schema.asset).where(and(eq(schema.asset.competitionId, competitionId), eq(schema.asset.kind, kind)));
		await recordChange(tx, competitionId, 'competition', competitionId);
	});
}

/** Effective class colours of a competition, by track id. */
export async function loadTrackColors(competitionId: string): Promise<Record<string, string>> {
	const tracks = await db
		.select({ id: schema.track.id, name: schema.track.name, color: schema.track.color })
		.from(schema.track)
		.where(eq(schema.track.competitionId, competitionId))
		.orderBy(asc(schema.track.sort));
	return trackColors(tracks);
}

export async function trackColorFor(competitionId: string, trackId: string): Promise<string | null> {
	return (await loadTrackColors(competitionId))[trackId] ?? null;
}

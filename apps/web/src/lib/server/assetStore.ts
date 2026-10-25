import { and, eq, inArray, or, type SQL } from 'drizzle-orm';
import { db, schema } from './db/index.ts';
import type { AssetKind } from '#lib/brand/branding.ts';

/**
 * The ONLY module that reads or writes uploaded image bytes. Images live in Postgres (`asset.data`,
 * owner decision): at our size (a few logos and covers per edition, ≤2 MB each) that keeps backups
 * and restores in one place. Moving to object storage later means changing this file only
 * (and the /media/<id> route keeps working by calling `readAsset`). See docs/architecture/02 §7.
 */

/** An image belongs to one edition (its override) or to one series (shared branding). */
export type AssetOwner = { competitionId: string; seriesId?: never } | { seriesId: string; competitionId?: never };

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Q = typeof db | Tx;

export interface ValidImage {
	mime: 'image/png' | 'image/jpeg' | 'image/webp';
	bytes: Uint8Array;
	width: number;
	height: number;
	sha256: string;
}

export interface StoredMeta {
	id: string;
	kind: AssetKind;
	width: number;
	height: number;
	competitionId: string | null;
	seriesId: string | null;
}

const ownerWhere = (o: AssetOwner): SQL =>
	o.competitionId ? eq(schema.asset.competitionId, o.competitionId) : eq(schema.asset.seriesId, o.seriesId!);

/** Stores an already validated image, replacing the owner's previous one of that kind. Returns the new id. */
export async function saveAsset(q: Q, owner: AssetOwner, kind: AssetKind, img: ValidImage, userId: string | null): Promise<string> {
	await q.delete(schema.asset).where(and(ownerWhere(owner), eq(schema.asset.kind, kind)));
	const [row] = await q
		.insert(schema.asset)
		.values({
			competitionId: owner.competitionId ?? null,
			seriesId: owner.seriesId ?? null,
			kind, mime: img.mime, size: img.bytes.length, width: img.width, height: img.height, sha256: img.sha256, data: img.bytes, uploadedBy: userId
		})
		.returning({ id: schema.asset.id });
	return row.id;
}

/** Bytes + headers data for /media/<id>, or null. */
export async function readAsset(id: string): Promise<{ mime: string; data: Uint8Array; sha256: string; size: number } | null> {
	const [a] = await db
		.select({ mime: schema.asset.mime, data: schema.asset.data, sha256: schema.asset.sha256, size: schema.asset.size })
		.from(schema.asset)
		.where(eq(schema.asset.id, id))
		.limit(1);
	return a ?? null;
}

/** Deletes the owner's image of `kind` (all kinds when omitted). */
export async function deleteAsset(q: Q, owner: AssetOwner, kind?: AssetKind): Promise<void> {
	await q.delete(schema.asset).where(kind ? and(ownerWhere(owner), eq(schema.asset.kind, kind)) : ownerWhere(owner));
}

/** Metadata (never bytes) of the images of one or more owners. */
export async function listAssets(owners: AssetOwner[], q: Q = db): Promise<StoredMeta[]> {
	const comps = owners.flatMap((o) => (o.competitionId ? [o.competitionId] : []));
	const series = owners.flatMap((o) => (o.seriesId ? [o.seriesId] : []));
	const conds = [comps.length ? inArray(schema.asset.competitionId, comps) : null, series.length ? inArray(schema.asset.seriesId, series) : null].filter(
		(c): c is SQL => c !== null
	);
	if (!conds.length) return [];
	return q
		.select({
			id: schema.asset.id, kind: schema.asset.kind, width: schema.asset.width, height: schema.asset.height,
			competitionId: schema.asset.competitionId, seriesId: schema.asset.seriesId
		})
		.from(schema.asset)
		.where(conds.length === 1 ? conds[0] : or(...conds));
}

/** Copies every image of `from` to `to` (server side, bytes never leave the database). Existing kinds on `to` are kept. */
export async function copyAssets(q: Q, from: AssetOwner, to: AssetOwner): Promise<void> {
	const rows = await q.select().from(schema.asset).where(ownerWhere(from));
	const have = new Set((await listAssets([to], q)).map((a) => a.kind));
	for (const r of rows) {
		if (have.has(r.kind)) continue;
		await q.insert(schema.asset).values({
			competitionId: to.competitionId ?? null, seriesId: to.seriesId ?? null,
			kind: r.kind, mime: r.mime, size: r.size, width: r.width, height: r.height, sha256: r.sha256, data: r.data, uploadedBy: r.uploadedBy
		});
	}
}

/** Forgets who uploaded the owner's images (used by "Ta bort personuppgifter"). */
export async function clearUploader(q: Q, owner: AssetOwner): Promise<void> {
	await q.update(schema.asset).set({ uploadedBy: null }).where(ownerWhere(owner));
}

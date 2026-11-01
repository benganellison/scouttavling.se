import { error } from '@sveltejs/kit';
import { readAssetBytes, readAssetMeta } from '#lib/server/assetStore.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Uploaded event images. Public (logos and covers are shown on public pages); ids are random.
 * A replaced image gets a new id, so a URL's bytes never change: cache forever, ETag = sha256.
 * Only validated PNG/JPEG/WebP are ever stored; nosniff + a sandboxing CSP make sure the browser
 * never treats the bytes as anything but an image.
 */
export async function GET({ params, request }) {
	if (!UUID.test(params.id)) error(404, 'Bilden finns inte');
	const a = await readAssetMeta(params.id);
	if (!a) error(404, 'Bilden finns inte');
	const headers: Record<string, string> = {
		'content-type': a.mime,
		'cache-control': 'public, max-age=31536000, immutable',
		etag: `"${a.sha256}"`,
		'x-content-type-options': 'nosniff',
		'content-security-policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
		'content-disposition': 'inline',
		'cross-origin-resource-policy': 'same-origin'
	};
	if (request.headers.get('if-none-match') === `"${a.sha256}"`) return new Response(null, { status: 304, headers });
	const data = await readAssetBytes(params.id);
	if (!data) error(404, 'Bilden finns inte');
	headers['content-length'] = String(data.byteLength);
	return new Response(data as Uint8Array<ArrayBuffer>, { headers });
}

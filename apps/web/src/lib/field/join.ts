/** Joining a station from an invite (/j/<secret>): a new device key, the grant, stored for offline use. */
import { generateDeviceKey, type JoinResponse } from './protocol.ts';
import { storeJoin } from './app.svelte.ts';

export async function joinDevice(secret: string, displayName: string, fetch: typeof globalThis.fetch = (...a) => globalThis.fetch(...a)) {
	if (!crypto?.subtle) throw new Error('Webbläsaren saknar stöd för säker inloggning. Använd en nyare webbläsare.');
	const key = await generateDeviceKey();
	const res = await fetch('/api/v1/join', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ secret, displayName, publicJwk: key.publicJwk })
	});
	const out = (await res.json().catch(() => ({}))) as Partial<JoinResponse> & { message?: string };
	if (!res.ok) throw new Error(out.message ?? 'Det gick inte att gå med');
	const j = out as JoinResponse;
	await storeJoin({
		slug: j.slug,
		grant: j.grant,
		deviceId: j.deviceId,
		privateKey: key.privateKey,
		publicJwk: key.publicJwk,
		displayName: j.displayName,
		role: j.role,
		stations: j.stations,
		exp: j.exp
	});
	return { slug: j.slug, role: j.role };
}

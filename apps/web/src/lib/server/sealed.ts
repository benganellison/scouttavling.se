/**
 * Secrets the server must be able to show again (invite links, follow links): AES-256-GCM with a
 * random 96-bit IV, stored as base64url(iv ‖ ciphertext). The key comes from a server secret plus
 * a per-use context (#lib/server/dataKey.ts), so a database dump alone reveals nothing.
 */
import { dataKey } from './dataKey.ts';

export async function seal(patrolCodeKey: string, context: string, text: string): Promise<string> {
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const key = await dataKey(patrolCodeKey, context, ['encrypt']);
	const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text)));
	const out = new Uint8Array(iv.length + ct.length);
	out.set(iv);
	out.set(ct, iv.length);
	return Buffer.from(out).toString('base64url');
}

/** null when missing, tampered with, or sealed with another key or context. */
export async function unseal(patrolCodeKey: string, context: string, enc: string | null): Promise<string | null> {
	if (!enc) return null;
	try {
		const buf = new Uint8Array(Buffer.from(enc, 'base64url'));
		const key = await dataKey(patrolCodeKey, context, ['decrypt']);
		return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf.slice(0, 12) }, key, buf.slice(12)));
	} catch {
		return null;
	}
}

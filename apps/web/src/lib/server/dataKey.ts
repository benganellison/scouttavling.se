import { loadPem } from './field.ts';

/**
 * AES-256-GCM key for values the app must be able to show again (invite QR secrets, follow links).
 * Derived from a server secret (the grant signing key, never stored in the database), the record's
 * own key (`competition.patrol_code_key`) and a purpose label. A database dump or backup alone therefore
 * yields no working link. Rotating GRANT_SIGNING_KEY makes old ciphertexts unreadable: organisers then
 * create new codes (the links themselves keep working, they are checked against their SHA-256 hash).
 */
export async function dataKey(recordKey: string, purpose: string, usage: KeyUsage[]): Promise<CryptoKey> {
	const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`scouttavling.data-key.v2|${purpose}|${recordKey}|${await loadPem()}`));
	return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, usage);
}

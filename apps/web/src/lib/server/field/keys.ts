/** The server key that signs device grants (ES256): from GRANT_SIGNING_KEY, or a generated dev key. */
import { calculateJwkThumbprint, exportJWK, exportPKCS8, generateKeyPair, importJWK, importPKCS8, type JWK } from 'jose';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { GRANT_SIGNING_KEY } from '$app/env/private';
import { dev } from '$app/env';

export const GRANT_ISSUER = 'scouttavling.se';

interface SigningKey {
	privateKey: CryptoKey;
	publicJwk: JWK;
	kid: string;
	verifyKey: CryptoKey;
}
let keyPromise: Promise<SigningKey> | null = null;

export async function loadPem(): Promise<string> {
	if (GRANT_SIGNING_KEY) return GRANT_SIGNING_KEY.replace(/\\n/g, '\n');
	if (!dev) throw new Error('GRANT_SIGNING_KEY must be set outside development');
	// Dev only: persist a generated key so restarts keep issued grants valid (gitignored).
	const file = fileURLToPath(new URL('../../../.dev-grant-key.pem', import.meta.url));
	if (existsSync(file)) return readFileSync(file, 'utf8');
	const { privateKey } = await generateKeyPair('ES256', { extractable: true });
	const pem = await exportPKCS8(privateKey);
	writeFileSync(file, pem, { mode: 0o600 });
	return pem;
}

export function signingKey(): Promise<SigningKey> {
	keyPromise ??= (async () => {
		const privateKey = await importPKCS8(await loadPem(), 'ES256', { extractable: true });
		const full = await exportJWK(privateKey);
		const publicJwk: JWK = { kty: full.kty, crv: full.crv, x: full.x, y: full.y };
		const kid = await calculateJwkThumbprint(publicJwk);
		const verifyKey = (await importJWK(publicJwk, 'ES256')) as CryptoKey;
		return { privateKey, publicJwk: { ...publicJwk, kid, alg: 'ES256', use: 'sig' }, kid, verifyKey };
	})();
	keyPromise.catch(() => (keyPromise = null));
	return keyPromise;
}

export async function publicKeys(): Promise<JWK[]> {
	return [(await signingKey()).publicJwk];
}

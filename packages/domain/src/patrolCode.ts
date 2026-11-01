/**
 * Patrol QR payload (contract C6): https://scouttavling.se/p/ST1.<comp>.<nr>.<check>
 * A normal phone camera opens a neutral landing page; the in-app scanner parses
 * the code offline. `check` is a 4-char truncated HMAC so a mistyped or forged
 * number is caught without a server round-trip.
 */
const PREFIX = 'ST1';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export interface PatrolCode {
	comp: string;
	nr: number;
	check: string;
}

export function parsePatrolCode(text: string): PatrolCode | null {
	const raw = text.trim();
	const tail = raw.includes('/p/') ? raw.slice(raw.lastIndexOf('/p/') + 3) : raw;
	const m = /^ST1\.([a-z0-9-]{2,40})\.(\d{1,5})\.([A-Z2-9]{4})$/.exec(tail);
	if (!m) return null;
	return { comp: m[1], nr: Number(m[2]), check: m[3] };
}

export async function patrolCheck(key: string, comp: string, nr: number): Promise<string> {
	const enc = new TextEncoder();
	const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
	const sig = new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(`${PREFIX}.${comp}.${nr}`)));
	let out = '';
	for (let i = 0; i < 4; i++) out += ALPHABET[sig[i] % ALPHABET.length];
	return out;
}

export async function patrolCodeUrl(origin: string, key: string, comp: string, nr: number): Promise<string> {
	return `${origin}/p/${PREFIX}.${comp}.${nr}.${await patrolCheck(key, comp, nr)}`;
}

export async function verifyPatrolCode(key: string, code: PatrolCode): Promise<boolean> {
	return (await patrolCheck(key, code.comp, code.nr)) === code.check;
}

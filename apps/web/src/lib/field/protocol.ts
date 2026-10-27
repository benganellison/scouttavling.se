/**
 * Field sync protocol (contracts C1–C3, 04 §3.2). Pure and environment-agnostic:
 * used by the browser (signing) and the server (parsing). No I/O here.
 *
 * A command is a compact JWS (ES256, typ `st-cmd+jwt`) signed with the device's
 * non-extractable P-256 key. WebCrypto's ECDSA output is already the raw r||s
 * form JWS expects, so no DER conversion is needed.
 */
import * as v from 'valibot';

export const CMD_TYP = 'st-cmd+jwt';
export const GRANT_TYP = 'st-grant+jwt';
export const MAX_BATCH = 100;

export type PatrolStatus = 'registered' | 'active' | 'camp' | 'finished' | 'resigned';

const uuid = v.pipe(v.string(), v.regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i));
const int = v.pipe(v.number(), v.integer());

const SetScore = v.object({
	type: v.literal('SetScore'),
	payload: v.object({
		patrolId: uuid,
		itemId: uuid,
		value: int,
		style: v.nullable(int),
		note: v.optional(v.nullable(v.pipe(v.string(), v.maxLength(500))))
	})
});
const VoidScore = v.object({
	type: v.literal('VoidScore'),
	payload: v.object({ patrolId: uuid, itemId: uuid })
});
const SetStatus = v.object({
	type: v.literal('SetStatus'),
	payload: v.object({ patrolId: uuid, status: v.picklist(['registered', 'active', 'camp', 'finished', 'resigned']) })
});

const Envelope = v.object({
	commandId: uuid,
	deviceId: uuid,
	// Stored in an integer column: larger values would fail the whole device's sync.
	deviceSeq: v.pipe(int, v.minValue(1), v.maxValue(2_147_483_647)),
	baseVersion: v.nullable(v.pipe(int, v.minValue(0), v.maxValue(2_147_483_647))),
	/** Server-estimated time when the volunteer acted (device clock + last known offset). */
	clientNow: v.pipe(v.string(), v.isoTimestamp()),
	/** base64url SHA-256 of the previous command JWS from this device (hash chain), null for the first. */
	prev: v.nullable(v.string())
});

export const CommandSchema = v.intersect([Envelope, v.variant('type', [SetScore, VoidScore, SetStatus])]);
export type CommandBody = v.InferOutput<typeof CommandSchema>;
export type CommandType = CommandBody['type'];
export type SetScorePayload = Extract<CommandBody, { type: 'SetScore' }>['payload'];

export function parseCommandBody(json: unknown): { ok: true; body: CommandBody } | { ok: false; reason: string } {
	const r = v.safeParse(CommandSchema, json);
	if (r.success) return { ok: true, body: r.output };
	return { ok: false, reason: 'Ogiltigt kommando: ' + r.issues.map((i) => i.message).join('; ') };
}

/** Per-command result (contract C1). */
export type CommandResult =
	| { commandId: string; result: 'accepted'; version: number }
	| { commandId: string; result: 'duplicate'; version?: number }
	| { commandId: string; result: 'conflict'; server: { points: number; stylePoints: number; version: number; state: string } }
	| { commandId: string; result: 'quarantined'; reason: string }
	| { commandId: string; result: 'rejected'; reason: string };

// ---------- encoding helpers ----------

export function b64url(bytes: Uint8Array | ArrayBuffer): string {
	const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
	let s = '';
	for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
	return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(s: string): Uint8Array {
	const pad = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
	const bin = atob(pad);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

const enc = new TextEncoder();

export async function sha256b64url(text: string): Promise<string> {
	return b64url(await crypto.subtle.digest('SHA-256', enc.encode(text)));
}

/** UUIDv7 (RFC 9562): 48-bit unix ms timestamp, then random bits. Time-ordered (C2). */
export function uuidv7(now = Date.now()): string {
	const b = crypto.getRandomValues(new Uint8Array(16));
	let ts = now;
	for (let i = 5; i >= 0; i--) {
		b[i] = ts % 256;
		ts = Math.floor(ts / 256);
	}
	b[6] = (b[6] & 0x0f) | 0x70;
	b[8] = (b[8] & 0x3f) | 0x80;
	const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
	return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// ---------- device key + signing (browser, also works in Node ≥ 20) ----------

/** Creates the device key pair. The private key is non-extractable; only the public JWK leaves the device. */
export async function generateDeviceKey(): Promise<{ privateKey: CryptoKey; publicJwk: JsonWebKey }> {
	const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
	const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
	return { privateKey: pair.privateKey, publicJwk: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y } };
}

/** Compact ES256 JWS with `typ: st-cmd+jwt`. */
export async function signCommand(privateKey: CryptoKey, body: CommandBody): Promise<string> {
	return signJws(privateKey, { alg: 'ES256', typ: CMD_TYP, kid: body.deviceId }, body);
}

export async function signJws(privateKey: CryptoKey, header: Record<string, unknown>, payload: unknown): Promise<string> {
	const input = `${b64url(enc.encode(JSON.stringify(header)))}.${b64url(enc.encode(JSON.stringify(payload)))}`;
	const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, enc.encode(input));
	return `${input}.${b64url(sig)}`;
}

/** Reads a JWS payload without verifying it (client-side display of the grant). */
export function peekJws<T>(jws: string): T {
	return JSON.parse(new TextDecoder().decode(b64urlDecode(jws.split('.')[1] ?? '')));
}

export interface GrantClaims {
	iss: string;
	sub: string;
	jti: string;
	cid: string;
	role: 'station_volunteer' | 'startfinish';
	stations: string[];
	gen: number;
	name: string;
	iat: number;
	exp: number;
	cnf: { jkt: string };
}

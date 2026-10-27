/**
 * Server-side command verification and batch processing (04 §3.3), written
 * against injected dependencies so it can be unit-tested without a database.
 * The DB-backed implementation lives in #lib/server/field.ts.
 */
import { compactVerify, decodeProtectedHeader, importJWK, type JWK } from 'jose';
import { CMD_TYP, MAX_BATCH, parseCommandBody, peekJws, type CommandBody, type CommandResult } from './protocol.ts';

export class CommandVerifyError extends Error {}

/** Verifies one command JWS against the device's registered public key. */
export async function verifyCommandJws(jws: string, publicJwk: JsonWebKey, expectedDeviceId: string): Promise<CommandBody> {
	let header;
	try {
		header = decodeProtectedHeader(jws);
	} catch {
		throw new CommandVerifyError('Trasig signatur');
	}
	if (header.alg !== 'ES256' || header.typ !== CMD_TYP) throw new CommandVerifyError('Fel signaturtyp');
	let payload: Uint8Array;
	try {
		const key = await importJWK({ kty: 'EC', crv: 'P-256', x: publicJwk.x, y: publicJwk.y } as JWK, 'ES256');
		({ payload } = await compactVerify(jws, key, { algorithms: ['ES256'] }));
	} catch {
		throw new CommandVerifyError('Ogiltig signatur');
	}
	let json: unknown;
	try {
		json = JSON.parse(new TextDecoder().decode(payload));
	} catch {
		throw new CommandVerifyError('Ogiltigt innehåll');
	}
	const parsed = parseCommandBody(json);
	if (!parsed.ok) throw new CommandVerifyError(parsed.reason);
	if (parsed.body.deviceId !== expectedDeviceId) throw new CommandVerifyError('Kommandot tillhör en annan enhet');
	return parsed.body;
}

export interface BatchContext {
	deviceId: string;
	publicJwk: JsonWebKey;
	role: 'station_volunteer' | 'startfinish';
	/** Stations in the grant (intersected with the device row). */
	stations: string[];
	revoked: boolean;
	/** The device's invite was replaced ("Skapa ny kod") after it joined. */
	superseded: boolean;
	/** Grant expiry, unix seconds. */
	grantExp: number;
	/** Grant issue time, unix seconds (no command can be older than the device's join). */
	grantIat: number;
	lastSeq: number;
	now?: Date;
}

export interface BatchDeps {
	/** Atomically reserves the command id. Returns the stored result if it was seen before. */
	claim(body: CommandBody): Promise<{ fresh: true } | { fresh: false; result: CommandResult }>;
	/** Stores the final result for a claimed command. */
	finish(body: CommandBody, result: CommandResult, detail?: Record<string, unknown>): Promise<void>;
	/** Scope facts: the station owning the item (score commands) and whether the patrol belongs to the competition. */
	lookup(body: CommandBody): Promise<{ stationId: string | null; patrolOk: boolean }>;
	/** Applies an authorised command (writeScore / voidScore / status). */
	apply(body: CommandBody): Promise<CommandResult>;
	/** Stores a quarantined command for HQ review (never dropped, C4). false = this device's quarantine is full. */
	quarantine(body: CommandBody, reason: string): Promise<boolean>;
}

const MAX_AHEAD_MS = 10 * 60_000;
/** Phones join a few minutes before use; a command dated well before the join was not made then. */
const MAX_BEFORE_JOIN_MS = 10 * 60_000;

export async function processBatch(
	jwsList: string[],
	ctx: BatchContext,
	deps: BatchDeps
): Promise<{ results: CommandResult[]; lastSeq: number }> {
	if (jwsList.length > MAX_BATCH) throw new CommandVerifyError(`Högst ${MAX_BATCH} kommandon per anrop`);
	const now = ctx.now ?? new Date();
	// Order by deviceSeq (unverified peek only for sorting; each is verified below).
	const ordered = jwsList
		.map((jws, i) => {
			let seq = Number.MAX_SAFE_INTEGER;
			let id = `index-${i}`;
			try {
				const p = peekJws<{ deviceSeq?: number; commandId?: string }>(jws);
				if (typeof p.deviceSeq === 'number') seq = p.deviceSeq;
				if (typeof p.commandId === 'string') id = p.commandId;
			} catch {
				/* rejected below */
			}
			return { jws, seq, id, i };
		})
		.sort((a, b) => a.seq - b.seq || a.i - b.i);

	const results: CommandResult[] = [];
	let lastSeq = ctx.lastSeq;
	for (const { jws, id } of ordered) {
		let body: CommandBody;
		try {
			body = await verifyCommandJws(jws, ctx.publicJwk, ctx.deviceId);
		} catch (e) {
			results.push({ commandId: id, result: 'rejected', reason: e instanceof Error ? e.message : 'Ogiltigt kommando' });
			continue;
		}
		const claim = await deps.claim(body);
		if (!claim.fresh) {
			const prev = claim.result;
			results.push(
				prev.result === 'accepted' || prev.result === 'duplicate'
					? { commandId: body.commandId, result: 'duplicate', version: prev.version }
					: { ...prev, commandId: body.commandId }
			);
			continue;
		}
		const detail: Record<string, unknown> = {};
		if (body.deviceSeq > lastSeq + 1) detail.gap = body.deviceSeq - lastSeq - 1;

		// 1. Scope first, for every command (also those that end up in quarantine): the patrol must
		//    belong to the competition, the item to one of the device's stations, and only the
		//    start & finish desk changes status, which in turn never records station scores.
		const scope = await deps.lookup(body);
		let result: CommandResult | null = null;
		if (!scope.patrolOk) result = { commandId: body.commandId, result: 'rejected', reason: 'Okänd patrull' };
		else if (body.type === 'SetStatus' && ctx.role !== 'startfinish')
			result = { commandId: body.commandId, result: 'rejected', reason: 'Bara start & mål kan ändra status' };
		else if (body.type !== 'SetStatus' && ctx.role === 'startfinish')
			result = { commandId: body.commandId, result: 'rejected', reason: 'Start & mål rapporterar inte poäng' };
		else if (body.type !== 'SetStatus' && (!scope.stationId || !ctx.stations.includes(scope.stationId)))
			result = { commandId: body.commandId, result: 'rejected', reason: 'Kontrollen ingår inte i din behörighet' };

		// 2. Authorised but doubtful: kept for HQ to decide (never dropped, C4).
		if (!result) {
			const at = Date.parse(body.clientNow);
			const quarantineReason = ctx.revoked
				? 'Enheten är avstängd'
				: ctx.superseded
					? 'Inbjudan har ersatts av en ny kod'
					: at > ctx.grantExp * 1000 || now.getTime() > ctx.grantExp * 1000
						? 'Behörigheten hade gått ut'
						: at > now.getTime() + MAX_AHEAD_MS || at < ctx.grantIat * 1000 - MAX_BEFORE_JOIN_MS
							? 'Telefonens klocka går fel'
							: body.deviceSeq <= ctx.lastSeq
								? 'Kommandot kom i fel ordning'
								: null;
			if (quarantineReason) {
				result = (await deps.quarantine(body, quarantineReason))
					? { commandId: body.commandId, result: 'quarantined', reason: quarantineReason }
					: { commandId: body.commandId, result: 'rejected', reason: 'För många rapporter väntar på granskning. Kontakta tävlingsledningen.' };
			} else result = await deps.apply(body);
		}
		await deps.finish(body, result, detail);
		results.push(result);
		if (body.deviceSeq > lastSeq) lastSeq = body.deviceSeq;
	}
	return { results, lastSeq };
}

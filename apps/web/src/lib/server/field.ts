/**
 * Field devices (04 §3): invite redemption → device grant, grant verification,
 * station pack (snapshot) and signed-command sync. Contracts C1–C3, C8, C10.
 */
import { error } from '@sveltejs/kit';
import { and, desc, eq, inArray, max, sql } from 'drizzle-orm';
import {
	calculateJwkThumbprint, compactVerify, decodeProtectedHeader, exportJWK, exportPKCS8, generateKeyPair, importJWK, importPKCS8,
	SignJWT, type JWK
} from 'jose';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { stationCodes } from '@scouttavling/domain';
import { GRANT_SIGNING_KEY } from '$app/env/private';
import { dev } from '$app/env';
import { db, schema } from '#lib/server/db/index.ts';
import { sha256 } from '#lib/server/auth.ts';
import { itemDef, writeScore, voidScore } from '#lib/server/scores.ts';
import { recordChange } from '#lib/server/changes.ts';
import { loadBranding } from '#lib/server/assets.ts';
import { trackColors } from '#lib/brand/colors.ts';
import { GRANT_TYP, uuidv7, type CommandBody, type CommandResult, type GrantClaims, type PatrolStatus } from '#lib/field/protocol.ts';
import { processBatch, type BatchDeps } from '#lib/field/verify.ts';

export const GRANT_ISSUER = 'scouttavling.se';

// ---------- server signing key ----------

interface SigningKey {
	privateKey: CryptoKey;
	publicJwk: JWK;
	kid: string;
	verifyKey: CryptoKey;
}
let keyPromise: Promise<SigningKey> | null = null;

async function loadPem(): Promise<string> {
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

// ---------- invites ----------

type CompRow = typeof schema.competition.$inferSelect;

export async function stationCodeMap(competitionId: string) {
	const [stations, days] = await Promise.all([
		db.select().from(schema.station).where(eq(schema.station.competitionId, competitionId)),
		db.select().from(schema.day).where(eq(schema.day.competitionId, competitionId))
	]);
	const codes = stationCodes(
		stations.map((s) => ({ id: s.id, dayId: s.dayId, order: s.sort, name: s.name, customCode: s.customCode, role: s.role })),
		days.map((d) => ({ id: d.id, prefix: d.prefix }))
	);
	return { stations: stations.sort((a, b) => a.sort - b.sort), days, codes };
}

/** Public info for the /j/<secret> page. Returns null for unknown or revoked invites. */
export async function inviteInfo(secret: string) {
	if (!/^[A-Za-z0-9_-]{16,64}$/.test(secret)) return null;
	const [row] = await db
		.select({ invite: schema.invite, comp: schema.competition, inviter: schema.appUser.name })
		.from(schema.invite)
		.innerJoin(schema.competition, eq(schema.competition.id, schema.invite.competitionId))
		.leftJoin(schema.appUser, eq(schema.appUser.id, schema.competition.createdBy))
		.where(eq(schema.invite.secretHash, await sha256(secret)))
		.limit(1);
	if (!row || row.invite.revokedAt) return null;
	const { comp, invite } = row;
	const { codes, stations } = await stationCodeMap(comp.id);
	const station = invite.stationId ? stations.find((s) => s.id === invite.stationId) ?? null : null;
	const items = station
		? (await db.select().from(schema.scoreItem).where(eq(schema.scoreItem.stationId, station.id)).orderBy(schema.scoreItem.sort)).map((i) =>
				itemDef(i, comp)
			)
		: [];
	let trackNames: string[] = [];
	if (station && !station.allTracks) {
		trackNames = (
			await db
				.select({ name: schema.track.name })
				.from(schema.stationTrack)
				.innerJoin(schema.track, eq(schema.track.id, schema.stationTrack.trackId))
				.where(eq(schema.stationTrack.stationId, station.id))
				.orderBy(schema.track.sort)
		).map((t) => t.name);
	}
	return {
		role: invite.role,
		closed: comp.status === 'closed',
		competition: { slug: comp.slug, name: comp.name },
		inviter: (row.inviter ?? 'Tävlingsledningen').split(' ')[0],
		station: station ? { id: station.id, code: codes.get(station.id) ?? '', name: station.name } : null,
		items,
		tracks: station ? (station.allTracks ? null : trackNames) : null
	};
}

function grantExpiry(comp: CompRow): number {
	// Event end (end of the last day, Swedish time) + 24 h; never less than 24 h from now.
	const end = Date.parse(`${comp.endDate}T23:59:59+02:00`) + 24 * 3600_000;
	return Math.floor(Math.max(end, Date.now() + 24 * 3600_000) / 1000);
}

function cleanJwk(input: unknown): JWK | null {
	if (!input || typeof input !== 'object') return null;
	const j = input as Record<string, unknown>;
	if (j.kty !== 'EC' || j.crv !== 'P-256' || typeof j.x !== 'string' || typeof j.y !== 'string' || 'd' in j) return null;
	if (!/^[A-Za-z0-9_-]{43}$/.test(j.x) || !/^[A-Za-z0-9_-]{43}$/.test(j.y)) return null;
	return { kty: 'EC', crv: 'P-256', x: j.x, y: j.y };
}

export async function redeemInvite(input: { secret: unknown; displayName: unknown; publicJwk: unknown }) {
	const secret = typeof input.secret === 'string' ? input.secret : '';
	const displayName = typeof input.displayName === 'string' ? input.displayName.trim().replace(/\s+/g, ' ').slice(0, 60) : '';
	if (!displayName) error(400, 'Skriv ditt namn');
	const jwk = cleanJwk(input.publicJwk);
	if (!jwk) error(400, 'Ogiltig enhetsnyckel');
	try {
		await importJWK(jwk, 'ES256');
	} catch {
		error(400, 'Ogiltig enhetsnyckel');
	}
	if (!/^[A-Za-z0-9_-]{16,64}$/.test(secret)) error(404, 'Inbjudan finns inte eller har ersatts');
	const [row] = await db
		.select({ invite: schema.invite, comp: schema.competition })
		.from(schema.invite)
		.innerJoin(schema.competition, eq(schema.competition.id, schema.invite.competitionId))
		.where(eq(schema.invite.secretHash, await sha256(secret)))
		.limit(1);
	if (!row || row.invite.revokedAt) error(404, 'Inbjudan finns inte eller har ersatts');
	const { invite, comp } = row;
	if (comp.status === 'closed') error(410, 'Tävlingen är avslutad');

	const stationIds = invite.stationId
		? [invite.stationId]
		: (await db.select({ id: schema.station.id }).from(schema.station).where(eq(schema.station.competitionId, comp.id)).orderBy(schema.station.sort)).map(
				(s) => s.id
			);
	const jkt = await calculateJwkThumbprint(jwk);
	const device = await db.transaction(async (tx) => {
		const [d] = await tx
			.insert(schema.device)
			.values({ competitionId: comp.id, inviteId: invite.id, role: invite.role, stationIds, displayName, publicJwk: jwk as JsonWebKey })
			.returning();
		await recordChange(tx, comp.id, 'device', d.id);
		return d;
	});
	const key = await signingKey();
	const exp = grantExpiry(comp);
	const grant = await new SignJWT({ cid: comp.id, role: invite.role, stations: stationIds, gen: invite.generation, name: displayName, cnf: { jkt } })
		.setProtectedHeader({ alg: 'ES256', typ: GRANT_TYP, kid: key.kid })
		.setIssuer(GRANT_ISSUER)
		.setSubject(device.id)
		.setJti(uuidv7())
		.setIssuedAt()
		.setNotBefore('0s')
		.setExpirationTime(exp)
		.sign(key.privateKey);
	return { grant, deviceId: device.id, slug: comp.slug, role: invite.role, stations: stationIds, displayName, exp, publicKeys: [key.publicJwk] };
}

// ---------- grant verification ----------

export interface DeviceContext {
	comp: CompRow;
	device: typeof schema.device.$inferSelect;
	claims: GrantClaims;
	expired: boolean;
	superseded: boolean;
	revoked: boolean;
}

function deny(code: string, message: string): never {
	error(401, { message: `${code}: ${message}` });
}

/** Verifies `Authorization: Grant <jws>` for a competition slug. Expiry is reported, not thrown (commands made in time still count). */
export async function authenticateDevice(request: Request, slug: string): Promise<DeviceContext> {
	const auth = request.headers.get('authorization') ?? '';
	const m = /^Grant\s+([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(auth);
	if (!m) deny('grant_missing', 'Behörighet saknas');
	const jws = m[1];
	const key = await signingKey();
	let claims: GrantClaims;
	try {
		const header = decodeProtectedHeader(jws);
		if (header.typ !== GRANT_TYP || header.alg !== 'ES256' || header.kid !== key.kid) throw new Error('header');
		const { payload } = await compactVerify(jws, key.verifyKey, { algorithms: ['ES256'] });
		claims = JSON.parse(new TextDecoder().decode(payload));
	} catch {
		deny('grant_invalid', 'Ogiltig behörighet');
	}
	if (claims.iss !== GRANT_ISSUER || typeof claims.sub !== 'string') deny('grant_invalid', 'Ogiltig behörighet');
	const [row] = await db
		.select({ device: schema.device, comp: schema.competition, invite: schema.invite })
		.from(schema.device)
		.innerJoin(schema.competition, eq(schema.competition.id, schema.device.competitionId))
		.innerJoin(schema.invite, eq(schema.invite.id, schema.device.inviteId))
		.where(eq(schema.device.id, claims.sub))
		.limit(1);
	if (!row || row.comp.id !== claims.cid || row.comp.slug !== slug) deny('grant_invalid', 'Behörigheten gäller inte den här tävlingen');
	if ((await calculateJwkThumbprint(row.device.publicJwk as JWK)) !== claims.cnf?.jkt) deny('grant_invalid', 'Fel enhetsnyckel');
	return {
		comp: row.comp,
		device: row.device,
		claims,
		expired: claims.exp * 1000 < Date.now(),
		superseded: claims.gen < row.invite.generation,
		revoked: !!row.device.revokedAt
	};
}

// ---------- snapshot (station pack) ----------

export async function currentCursor(competitionId: string): Promise<number> {
	const [r] = await db.select({ seq: max(schema.changeLog.seq) }).from(schema.changeLog).where(eq(schema.changeLog.competitionId, competitionId));
	return Number(r?.seq ?? 0);
}

export async function buildSnapshot(ctx: DeviceContext, since: number | null) {
	const { comp, device } = ctx;
	const cursor = await currentCursor(comp.id);
	const serverTime = new Date().toISOString();
	if (since !== null && since >= cursor) return { unchanged: true as const, cursor, serverTime };

	const isDesk = device.role === 'startfinish';
	const { stations, codes } = await stationCodeMap(comp.id);
	const stationTracks = await db
		.select({ stationId: schema.stationTrack.stationId, trackId: schema.stationTrack.trackId })
		.from(schema.stationTrack)
		.innerJoin(schema.station, eq(schema.station.id, schema.stationTrack.stationId))
		.where(eq(schema.station.competitionId, comp.id));
	const myStationIds = device.stationIds.filter((id) => ctx.claims.stations.includes(id));
	const tracks = await db.select().from(schema.track).where(eq(schema.track.competitionId, comp.id)).orderBy(schema.track.sort);
	const allItems = stations.length
		? await db
				.select()
				.from(schema.scoreItem)
				.where(inArray(schema.scoreItem.stationId, stations.map((s) => s.id)))
				.orderBy(schema.scoreItem.sort)
		: [];
	const myItems = isDesk ? [] : allItems.filter((i) => myStationIds.includes(i.stationId));
	const patrols = await db.select().from(schema.patrol).where(eq(schema.patrol.competitionId, comp.id)).orderBy(schema.patrol.number);
	const trackName = new Map(tracks.map((t) => [t.id, t.name]));
	const colors = trackColors(tracks);

	const scores = myItems.length
		? await db
				.select({ s: schema.score, by: schema.device.displayName })
				.from(schema.score)
				.leftJoin(schema.device, eq(schema.device.id, schema.score.deviceId))
				.where(inArray(schema.score.itemId, myItems.map((i) => i.id)))
		: [];

	// Desk: per-patrol progress (kontroller x/y, poäng, senast sedd, tid ute).
	let progress: Record<string, { stationsDone: number; points: number; lastSeenAt: string | null; lastStationId: string | null; startedAt: string | null; finishedAt: string | null; campAt: string | null }> = {};
	if (isDesk) {
		const itemStation = new Map(allItems.map((i) => [i.id, i.stationId]));
		const all = await db
			.select({ patrolId: schema.score.patrolId, itemId: schema.score.itemId, points: schema.score.points, style: schema.score.stylePoints, at: schema.score.updatedAt })
			.from(schema.score)
			.where(and(eq(schema.score.competitionId, comp.id), eq(schema.score.state, 'active')));
		const events = await db
			.select({ patrolId: schema.statusEvent.patrolId, status: schema.statusEvent.status, at: schema.statusEvent.at })
			.from(schema.statusEvent)
			.innerJoin(schema.patrol, eq(schema.patrol.id, schema.statusEvent.patrolId))
			.where(eq(schema.patrol.competitionId, comp.id))
			.orderBy(schema.statusEvent.at);
		const acc = new Map<string, { stations: Set<string>; points: number; last: Date | null; lastStation: string | null; started: Date | null; finished: Date | null; camp: Date | null }>();
		const get = (id: string) => {
			let a = acc.get(id);
			if (!a) acc.set(id, (a = { stations: new Set(), points: 0, last: null, lastStation: null, started: null, finished: null, camp: null }));
			return a;
		};
		for (const s of all) {
			const a = get(s.patrolId);
			const st = itemStation.get(s.itemId) ?? null;
			if (st) a.stations.add(st);
			a.points += s.points + s.style;
			if (!a.last || s.at > a.last) {
				a.last = s.at;
				a.lastStation = st;
			}
		}
		for (const e of events) {
			const a = get(e.patrolId);
			// First start counts ("Tid ute" spans every day); a camp → active next morning is not a new start.
			if (e.status === 'active' && !a.started) a.started = e.at;
			if (e.status === 'finished') a.finished = e.at;
			if (e.status === 'camp') a.camp = e.at;
			if (!a.last || e.at > a.last) {
				a.last = e.at;
				a.lastStation = null;
			}
		}
		progress = Object.fromEntries(
			[...acc].map(([id, a]) => [
				id,
				{
					stationsDone: a.stations.size,
					points: a.points,
					lastSeenAt: a.last?.toISOString() ?? null,
					lastStationId: a.lastStation,
					startedAt: a.started?.toISOString() ?? null,
					finishedAt: a.finished?.toISOString() ?? null,
					campAt: a.camp?.toISOString() ?? null
				}
			])
		);
	}

	const msgs = await db
		.select({ m: schema.message, readAt: schema.messageRead.at })
		.from(schema.message)
		.leftJoin(schema.messageRead, and(eq(schema.messageRead.messageId, schema.message.id), eq(schema.messageRead.deviceId, device.id)))
		.where(eq(schema.message.competitionId, comp.id))
		.orderBy(desc(schema.message.createdAt))
		.limit(100);
	const messages = msgs
		.filter(({ m }) => m.audience.includes('all') || (isDesk && m.audience.includes('startfinish')) || m.audience.some((a) => myStationIds.includes(a)))
		.slice(0, 50)
		.map(({ m, readAt }) => ({ id: m.id, title: m.title, body: m.body, important: m.important, createdAt: m.createdAt.toISOString(), read: !!readAt }));

	return {
		unchanged: false as const,
		cursor,
		serverTime,
		device: { id: device.id, displayName: device.displayName, role: device.role, revoked: ctx.revoked, superseded: ctx.superseded },
		competition: {
			id: comp.id, slug: comp.slug, name: comp.name, styleEnabled: comp.styleEnabled, backupMode: comp.backupMode, hqPhone: comp.hqPhone,
			patrolCodeKey: comp.patrolCodeKey, status: comp.status, startDate: comp.startDate, endDate: comp.endDate,
			branding: await loadBranding(comp)
		},
		myStationIds,
		stations: stations.map((s) => ({
			id: s.id, code: codes.get(s.id) ?? '', name: s.name, sort: s.sort, dayId: s.dayId, startable: s.startable,
			trackIds: s.allTracks ? null : stationTracks.filter((t) => t.stationId === s.id).map((t) => t.trackId),
			items: allItems.filter((i) => i.stationId === s.id).length
		})),
		items: myItems.map((i) => ({ ...itemDef(i, comp), stationId: i.stationId })),
		tracks: tracks.map((t) => ({ id: t.id, name: t.name, color: colors[t.id] ?? null })),
		patrols: patrols.map((p) => ({
			id: p.id, number: p.number, name: p.name, trackId: p.trackId, track: p.trackId ? trackName.get(p.trackId) ?? '' : '', troop: p.troop,
			status: p.status as PatrolStatus, startStationId: p.startStationId, ...(isDesk ? { phone: p.contactPhone } : {})
		})),
		scores: scores.map(({ s, by }) => ({
			patrolId: s.patrolId, itemId: s.itemId, points: s.points, stylePoints: s.stylePoints, raw: s.raw, state: s.state, version: s.version,
			at: s.updatedAt.toISOString(), by: s.origin === 'device' ? (by ?? 'Funktionär') : s.origin === 'paper' ? 'Pappersprotokoll' : 'Tävlingsledningen',
			mine: s.deviceId === device.id
		})),
		progress,
		messages
	};
}
export type Snapshot = Exclude<Awaited<ReturnType<typeof buildSnapshot>>, { unchanged: true }>;

// ---------- commands ----------

function resultFromRow(id: string, row: { result: string; resultDetail: unknown }): CommandResult {
	const d = (row.resultDetail ?? {}) as Record<string, any>;
	switch (row.result) {
		case 'accepted':
			return { commandId: id, result: 'accepted', version: d.version ?? 0 };
		case 'duplicate':
			return { commandId: id, result: 'duplicate', version: d.version };
		case 'conflict':
			return { commandId: id, result: 'conflict', server: d.server };
		case 'quarantined':
			return { commandId: id, result: 'quarantined', reason: d.reason ?? '' };
		default:
			return { commandId: id, result: 'rejected', reason: d.reason ?? '' };
	}
}

function clientDate(body: CommandBody): Date {
	const t = Date.parse(body.clientNow);
	return new Date(Math.min(Number.isFinite(t) ? t : Date.now(), Date.now()));
}

export async function syncCommands(ctx: DeviceContext, jwsList: string[]) {
	const { comp, device } = ctx;
	const compItems = new Map<string, { stationId: string; mode: string }>();
	const items = await db
		.select({ id: schema.scoreItem.id, stationId: schema.scoreItem.stationId, mode: schema.scoreItem.mode })
		.from(schema.scoreItem)
		.innerJoin(schema.station, eq(schema.station.id, schema.scoreItem.stationId))
		.where(eq(schema.station.competitionId, comp.id));
	for (const i of items) compItems.set(i.id, i);

	const deps: BatchDeps = {
		async claim(body) {
			// Placeholder row reserves the id; a crash mid-way leaves `pending`, which is retried after 60 s.
			const inserted = await db
				.insert(schema.command)
				.values({
					id: body.commandId, competitionId: comp.id, deviceId: device.id, deviceSeq: body.deviceSeq, type: body.type, payload: body,
					clientAt: new Date(body.clientNow), result: 'rejected', resultDetail: { pending: true }
				})
				.onConflictDoNothing({ target: schema.command.id })
				.returning({ id: schema.command.id });
			if (inserted.length) return { fresh: true };
			const [row] = await db.select().from(schema.command).where(eq(schema.command.id, body.commandId)).limit(1);
			if (row.competitionId !== comp.id || row.deviceId !== device.id) return { fresh: false, result: { commandId: body.commandId, result: 'rejected', reason: 'Kommandot finns redan' } };
			const pending = (row.resultDetail as { pending?: boolean } | null)?.pending;
			if (pending && Date.now() - row.receivedAt.getTime() > 60_000) {
				await db.update(schema.command).set({ receivedAt: new Date() }).where(eq(schema.command.id, body.commandId));
				return { fresh: true };
			}
			if (pending) return { fresh: false, result: { commandId: body.commandId, result: 'rejected', reason: 'Behandlas redan, försök igen' } };
			return { fresh: false, result: resultFromRow(body.commandId, row) };
		},
		async finish(body, result, detail) {
			const { commandId: _id, result: r, ...rest } = result;
			await db
				.update(schema.command)
				.set({ result: r, resultDetail: { ...rest, ...detail } })
				.where(eq(schema.command.id, body.commandId));
		},
		async lookup(body) {
			const [p] = await db
				.select({ id: schema.patrol.id })
				.from(schema.patrol)
				.where(and(eq(schema.patrol.id, body.payload.patrolId), eq(schema.patrol.competitionId, comp.id)))
				.limit(1);
			const stationId = body.type === 'SetStatus' ? null : (compItems.get(body.payload.itemId)?.stationId ?? null);
			return { stationId, patrolOk: !!p };
		},
		async apply(body) {
			// The overview promises "Resultaten är låsta för funktionärer" once the competition is closed.
			if (comp.status === 'closed') return { commandId: body.commandId, result: 'rejected', reason: 'Tävlingen är avslutad. Kontakta tävlingsledningen.' };
			if (body.type === 'SetStatus') return setStatus(ctx, body);
			const base = {
				competitionId: comp.id, patrolId: body.payload.patrolId, itemId: body.payload.itemId, baseVersion: body.baseVersion,
				origin: 'device' as const, deviceId: device.id, commandId: body.commandId, at: clientDate(body)
			};
			const r =
				body.type === 'SetScore'
					? await writeScore({ ...base, raw: { value: body.payload.value, style: body.payload.style }, note: body.payload.note ?? null })
					: await voidScore({ ...base, reason: 'Ångrad på kontrollen' });
			// Status (På banan / I läger / I mål, incl. C10 AUTO_ON_SCAN) follows in writeScore.
			switch (r.result) {
				case 'accepted':
					return { commandId: body.commandId, result: 'accepted', version: r.version };
				case 'duplicate':
					return { commandId: body.commandId, result: 'duplicate', version: r.version };
				case 'conflict':
					return { commandId: body.commandId, result: 'conflict', server: r.server };
				case 'rejected':
					return { commandId: body.commandId, result: 'rejected', reason: r.reason };
			}
		},
		async quarantine(body, reason) {
			if (body.type === 'SetStatus' || !compItems.has(body.payload.itemId)) return; // kept in the command ledger only
			await db.transaction(async (tx) => {
				const [ex] = await tx
					.select()
					.from(schema.score)
					.where(and(eq(schema.score.patrolId, body.payload.patrolId), eq(schema.score.itemId, body.payload.itemId)))
					.limit(1);
				await tx.insert(schema.scoreConflict).values({
					competitionId: comp.id, patrolId: body.payload.patrolId, itemId: body.payload.itemId, commandId: body.commandId, kind: 'quarantine',
					existing: ex ? { points: ex.points, stylePoints: ex.stylePoints, version: ex.version, state: ex.state, origin: ex.origin } : {},
					incoming: {
						type: body.type, reason, deviceId: device.id, deviceName: device.displayName, baseVersion: body.baseVersion, clientNow: body.clientNow,
						...(body.type === 'SetScore' ? { raw: { value: body.payload.value, style: body.payload.style } } : {})
					}
				});
				await recordChange(tx, comp.id, 'conflict', null);
			});
		}
	};

	const out = await processBatch(
		jwsList,
		{
			deviceId: device.id, publicJwk: device.publicJwk, role: device.role, stations: device.stationIds.filter((s) => ctx.claims.stations.includes(s)),
			revoked: ctx.revoked, superseded: ctx.superseded, grantExp: ctx.claims.exp, lastSeq: device.lastSeq
		},
		deps
	);
	await db
		.update(schema.device)
		.set({ lastSeq: sql`greatest(${schema.device.lastSeq}, ${out.lastSeq})`, lastSeenAt: new Date() })
		.where(eq(schema.device.id, device.id));
	return { results: out.results, serverTime: new Date().toISOString() };
}

async function setStatus(ctx: DeviceContext, body: Extract<CommandBody, { type: 'SetStatus' }>): Promise<CommandResult> {
	return db.transaction(async (tx) => {
		const [p] = await tx.select().from(schema.patrol).where(eq(schema.patrol.id, body.payload.patrolId)).for('update').limit(1);
		if (p.status === body.payload.status) return { commandId: body.commandId, result: 'duplicate' } as const;
		await tx.update(schema.patrol).set({ status: body.payload.status }).where(eq(schema.patrol.id, p.id));
		await tx.insert(schema.statusEvent).values({ patrolId: p.id, status: body.payload.status, deviceId: ctx.device.id, at: clientDate(body) });
		await recordChange(tx, ctx.comp.id, 'patrol', p.id);
		return { commandId: body.commandId, result: 'accepted', version: 1 } as const;
	});
}

export async function markMessageRead(ctx: DeviceContext, messageId: string) {
	const [m] = await db
		.select({ id: schema.message.id })
		.from(schema.message)
		.where(and(eq(schema.message.id, messageId), eq(schema.message.competitionId, ctx.comp.id)))
		.limit(1);
	if (!m) error(404, 'Meddelandet finns inte');
	await db.transaction(async (tx) => {
		const ins = await tx.insert(schema.messageRead).values({ messageId, deviceId: ctx.device.id }).onConflictDoNothing().returning({ m: schema.messageRead.messageId });
		// HQ's Meddelanden page shows read receipts live; it only refreshes on change_log events.
		if (ins.length) await recordChange(tx, ctx.comp.id, 'message', messageId);
	});
}

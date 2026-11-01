/** Joining a station: the /j/<secret> page and invite redemption → device grant (04 §3). */
import { refuseIfSuspended } from '../suspended.ts';
import { error } from '@sveltejs/kit';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { calculateJwkThumbprint, importJWK, SignJWT, type JWK } from 'jose';
import { db, schema, type CompRow } from '#lib/server/db/index.ts';
import { sha256 } from '#lib/server/auth.ts';
import { itemDef } from '#lib/server/scores.ts';
import { recordChange } from '#lib/server/changes.ts';
import { fromWallClock } from '@scouttavling/domain';
import { GRANT_TYP, uuidv7, type JoinResponse } from '#lib/field/protocol.ts';
import { signingKey, GRANT_ISSUER } from './keys.ts';
import { stationCodeMap } from '../queries.ts';

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
	refuseIfSuspended(row.comp);
	const { comp, invite } = row;
	const { codes, stations } = await stationCodeMap(comp.id);
	const station = invite.stationId ? (stations.find((s) => s.id === invite.stationId) ?? null) : null;
	const items = station
		? (await db.select().from(schema.scoreItem).where(eq(schema.scoreItem.stationId, station.id)).orderBy(schema.scoreItem.sort)).map((i) => itemDef(i, comp))
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

/** Phones per invite (a station rarely has more than a handful of volunteers). */
const MAX_DEVICES_PER_INVITE = 25;

function grantExpiry(comp: CompRow): number {
	// Event end (end of the last day, Swedish time, summer or winter) + 24 h; never less than 24 h from now.
	const end = (fromWallClock(`${comp.endDate} 23:59:59`)?.getTime() ?? Date.now()) + 24 * 3600_000;
	return Math.floor(Math.max(end, Date.now() + 24 * 3600_000) / 1000);
}

function cleanJwk(input: unknown): JWK | null {
	if (!input || typeof input !== 'object') return null;
	const j = input as Record<string, unknown>;
	if (j.kty !== 'EC' || j.crv !== 'P-256' || typeof j.x !== 'string' || typeof j.y !== 'string' || 'd' in j) return null;
	if (!/^[A-Za-z0-9_-]{43}$/.test(j.x) || !/^[A-Za-z0-9_-]{43}$/.test(j.y)) return null;
	return { kty: 'EC', crv: 'P-256', x: j.x, y: j.y };
}

export async function redeemInvite(input: { secret: unknown; displayName: unknown; publicJwk: unknown }): Promise<JoinResponse> {
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
	refuseIfSuspended(comp);
	// A leaked code must not mint phones without end.
	const [{ joined }] = await db
		.select({ joined: sql<number>`count(*)::int` })
		.from(schema.device)
		.where(and(eq(schema.device.inviteId, invite.id), isNull(schema.device.revokedAt)));
	if (joined >= MAX_DEVICES_PER_INVITE) error(429, 'Många telefoner har redan gått med med den här koden. Be tävlingsledningen om en ny kod.');

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

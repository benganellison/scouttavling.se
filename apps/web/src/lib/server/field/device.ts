/** Verifying a device grant on every field request (04 §3, C3). */
import { refuseIfSuspended } from '../suspended.ts';
import { error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { calculateJwkThumbprint, compactVerify, decodeProtectedHeader, type JWK } from 'jose';
import { db, schema, type CompRow } from '#lib/server/db/index.ts';
import { GRANT_TYP, type GrantClaims } from '#lib/field/protocol.ts';
import { signingKey, GRANT_ISSUER } from './keys.ts';

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
	// Suspended by a site admin: no snapshot, no sync. Commands stay in the device's outbox.
	refuseIfSuspended(row.comp);
	return {
		comp: row.comp,
		device: row.device,
		claims,
		expired: claims.exp * 1000 < Date.now(),
		// "Skapa ny kod" revokes the old invite: every phone that joined with it is superseded.
		superseded: !!row.invite.revokedAt || claims.gen < row.invite.generation,
		revoked: !!row.device.revokedAt
	};
}

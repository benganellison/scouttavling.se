import { and, desc, eq, isNull } from 'drizzle-orm';
import { db, schema, type Queryable } from './db/index.ts';
import { randomToken, sha256 } from './auth.ts';
import { seal, unseal } from './sealed.ts';

/**
 * Invite secrets (contract: /j/<secret>, 128-bit base64url, sha256 stored).
 *
 * The field agent only ever needs the hash. Organisers, however, must be able
 * to re-display the QR (invite panel, printed station signs) long after the
 * invite was created, so the secret is additionally stored encrypted in
 * `invite.secret_enc`: AES-256-GCM, random 96-bit IV, key from a server secret
 * that is not in the database (#lib/server/sealed.ts). A database dump alone
 * does not reveal working links; rotating a code revokes the old row and
 * disconnects its phones, so a leaked secret is cut off with one click.
 */
const KEY_CONTEXT = 'scouttavling.invite-secret.v1';

export const encryptSecret = (patrolCodeKey: string, secret: string) => seal(patrolCodeKey, KEY_CONTEXT, secret);
export const decryptSecret = (patrolCodeKey: string, enc: string | null) => unseal(patrolCodeKey, KEY_CONTEXT, enc);

export { publicOrigin } from './origin.ts';

export function inviteUrl(origin: string, secret: string): string {
	return `${origin}/j/${secret}`;
}

export { qrSvg } from './qr.ts';

export type InviteRow = typeof schema.invite.$inferSelect;

/** Creates a new invite (generation = previous + 1) and revokes any active one for the same target. */
export async function rotateInvite(tx: Queryable, comp: { id: string; patrolCodeKey: string }, stationId: string | null) {
	const target = stationId ? eq(schema.invite.stationId, stationId) : and(isNull(schema.invite.stationId), eq(schema.invite.role, 'startfinish'));
	const [prev] = await tx
		.select()
		.from(schema.invite)
		.where(and(eq(schema.invite.competitionId, comp.id), target))
		.orderBy(desc(schema.invite.generation))
		.limit(1);
	await tx
		.update(schema.invite)
		.set({ revokedAt: new Date() })
		.where(and(eq(schema.invite.competitionId, comp.id), target, isNull(schema.invite.revokedAt)));
	const secret = randomToken(16);
	const [row] = await tx
		.insert(schema.invite)
		.values({
			competitionId: comp.id,
			stationId,
			role: stationId ? 'station_volunteer' : 'startfinish',
			secretHash: await sha256(secret),
			secretEnc: await encryptSecret(comp.patrolCodeKey, secret),
			generation: (prev?.generation ?? 0) + 1
		})
		.returning();
	return { invite: row, secret };
}

/** Active (non-revoked, newest) invite per station id; key '' = start & finish. */
export async function activeInvites(competitionId: string): Promise<Map<string, InviteRow>> {
	const rows = await db
		.select()
		.from(schema.invite)
		.where(and(eq(schema.invite.competitionId, competitionId), isNull(schema.invite.revokedAt)))
		.orderBy(desc(schema.invite.generation));
	const out = new Map<string, InviteRow>();
	for (const r of rows) {
		const k = r.stationId ?? '';
		if (!out.has(k)) out.set(k, r);
	}
	return out;
}

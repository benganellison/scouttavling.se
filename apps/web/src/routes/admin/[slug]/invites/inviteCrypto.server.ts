import { and, desc, eq, isNull } from 'drizzle-orm';
import QRCode from 'qrcode';
import { db, schema } from '#lib/server/db/index.ts';
import { randomToken, sha256 } from '#lib/server/auth.ts';
import { dataKey } from '#lib/server/dataKey.ts';

/**
 * Invite secrets (contract: /j/<secret>, 128-bit base64url, sha256 stored).
 *
 * The field agent only ever needs the hash. Organisers, however, must be able
 * to re-display the QR (invite panel, printed station signs) long after the
 * invite was created, so the secret is additionally stored encrypted in
 * `invite.secret_enc`: AES-256-GCM, random 96-bit IV, key from a server secret
 * that is not in the database (#lib/server/dataKey.ts). A database dump alone
 * does not reveal working links; rotating a code revokes the old row and
 * disconnects its phones, so a leaked secret is cut off with one click.
 */
const KEY_CONTEXT = 'scouttavling.invite-secret.v1';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0] | typeof db;

const key = (patrolCodeKey: string, usage: KeyUsage[]) => dataKey(patrolCodeKey, KEY_CONTEXT, usage);

export async function encryptSecret(patrolCodeKey: string, secret: string): Promise<string> {
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(patrolCodeKey, ['encrypt']), new TextEncoder().encode(secret)));
	const out = new Uint8Array(iv.length + ct.length);
	out.set(iv);
	out.set(ct, iv.length);
	return Buffer.from(out).toString('base64url');
}

export async function decryptSecret(patrolCodeKey: string, enc: string | null): Promise<string | null> {
	if (!enc) return null;
	try {
		const buf = new Uint8Array(Buffer.from(enc, 'base64url'));
		const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf.slice(0, 12) }, await key(patrolCodeKey, ['decrypt']), buf.slice(12));
		return new TextDecoder().decode(pt);
	} catch {
		return null;
	}
}

export { publicOrigin } from '#lib/server/origin.ts';

export function inviteUrl(origin: string, secret: string): string {
	return `${origin}/j/${secret}`;
}

export async function qrSvg(text: string, opts: { dark?: string; margin?: number } = {}): Promise<string> {
	return QRCode.toString(text, { type: 'svg', errorCorrectionLevel: 'M', margin: opts.margin ?? 1, color: { dark: opts.dark ?? '#000000', light: '#ffffff' } });
}

export type InviteRow = typeof schema.invite.$inferSelect;

/** Creates a new invite (generation = previous + 1) and revokes any active one for the same target. */
export async function rotateInvite(tx: Tx, comp: { id: string; patrolCodeKey: string }, stationId: string | null) {
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

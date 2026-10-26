import { and, eq, inArray, isNotNull, ne, or, sql } from 'drizzle-orm';
import { db, schema } from './db/index.ts';
import { recordChange } from './changes.ts';
import { clearUploader } from './assetStore.ts';
import { sha256 } from './auth.ts';
import { writeAudit, type Actor } from './audit.ts';

/**
 * "Ta bort personuppgifter" for a CLOSED edition (manual only). Every decision per column is
 * listed in docs/architecture/05-series-and-archive.md §4; keep the two in sync.
 *
 * Removed: scout names (member), patrol contacts and links, volunteer names and devices (+ grants,
 * which are their invites), messages and reads, free-text notes/reasons, user/device references,
 * command payloads, non-owner memberships, invites, station contacts and the HQ phone.
 * Kept: patrol number/name/kår/class/status, scores (points, style, raw value), stations, days,
 * classes, items, everything ranking reads, and change_log (kind + entity id, no personal data).
 * Results are therefore identical before and after (tested in anonymise.db.test.ts).
 */

/** Patrols that still carry personal data (members, contact details or patrol links). */
export async function personalDataLeft(competitionId: string): Promise<number> {
	const [{ n }] = await db
		.select({ n: sql<number>`count(*)::int` })
		.from(schema.patrol)
		.where(
			and(
				eq(schema.patrol.competitionId, competitionId),
				or(
					isNotNull(schema.patrol.contactName), isNotNull(schema.patrol.contactPhone), isNotNull(schema.patrol.contactEmail),
					isNotNull(schema.patrol.contactMemberNo), isNotNull(schema.patrol.manageTokenHash), isNotNull(schema.patrol.followTokenHash),
					isNotNull(schema.patrol.followTokenEnc),
					sql`exists (select 1 from ${schema.member} where ${schema.member.patrolId} = ${schema.patrol.id})`
				)
			)
		);
	return n;
}

/** JSON keys that may name or identify a person inside score_conflict.existing/incoming. */
const CONFLICT_PERSONAL_KEYS = ['deviceName', 'deviceId', 'userId', 'reason', 'note', 'by', 'name'];

/**
 * `actor` is logged in audit_log in the same transaction (owner from the confirm page, a site admin
 * on behalf of the owners). The audit row keeps only ids, the action and the reason.
 */
export async function anonymiseCompetition(competitionId: string, actor?: Actor): Promise<{ patrols: number }> {
	return db.transaction(async (tx) => {
		const [comp] = await tx.select().from(schema.competition).where(eq(schema.competition.id, competitionId)).for('update');
		if (!comp) throw new Error('Tävlingen finns inte');
		if (comp.status !== 'closed') throw new Error('Bara en avslutad tävling kan arkiveras');
		const patrolIds = (await tx.select({ id: schema.patrol.id }).from(schema.patrol).where(eq(schema.patrol.competitionId, competitionId))).map((p) => p.id);
		const scoreIds = (await tx.select({ id: schema.score.id }).from(schema.score).where(eq(schema.score.competitionId, competitionId))).map((s) => s.id);

		// Patrol links: keep only "this hash belonged to that edition" so old links can say it is archived.
		const links = await tx
			.select({ m: schema.patrol.manageTokenHash, f: schema.patrol.followTokenHash })
			.from(schema.patrol)
			.where(eq(schema.patrol.competitionId, competitionId));
		const retired = links.flatMap((l) => [
			...(l.m ? [{ tokenHash: l.m, competitionId, kind: 'manage' as const }] : []),
			...(l.f ? [{ tokenHash: l.f, competitionId, kind: 'follow' as const }] : [])
		]);
		if (retired.length) await tx.insert(schema.retiredLink).values(retired).onConflictDoNothing();

		// Patrols: keep number, name, kår, class, status; drop contacts and links.
		await tx
			.update(schema.patrol)
			.set({ contactName: null, contactPhone: null, contactEmail: null, contactMemberNo: null, followTokenHash: null, followTokenEnc: null, manageTokenHash: null })
			.where(eq(schema.patrol.competitionId, competitionId));
		if (patrolIds.length) {
			await tx.delete(schema.member).where(inArray(schema.member.patrolId, patrolIds));
			await tx.update(schema.statusEvent).set({ deviceId: null, userId: null }).where(inArray(schema.statusEvent.patrolId, patrolIds));
		}

		// Scores: points and style stay; who/why goes.
		await tx.update(schema.score).set({ note: null, userId: null, deviceId: null }).where(eq(schema.score.competitionId, competitionId));
		if (scoreIds.length) {
			await tx
				.update(schema.scoreRevision)
				.set({ reason: null, userId: null, deviceId: null, commandId: null })
				.where(inArray(schema.scoreRevision.scoreId, scoreIds));
		}
		await tx
			.update(schema.scoreConflict)
			.set({
				existing: sql`${schema.scoreConflict.existing} - ${sql.raw(`array[${CONFLICT_PERSONAL_KEYS.map((k) => `'${k}'`).join(',')}]`)}`,
				incoming: sql`${schema.scoreConflict.incoming} - ${sql.raw(`array[${CONFLICT_PERSONAL_KEYS.map((k) => `'${k}'`).join(',')}]`)}`,
				commandId: null
			})
			.where(eq(schema.scoreConflict.competitionId, competitionId));

		// Commands: keep the idempotency ledger rows (id, type, result) but not what they carried.
		await tx
			.update(schema.command)
			.set({ payload: {}, resultDetail: null, deviceId: null })
			.where(eq(schema.command.competitionId, competitionId));

		// Messages (+ reads), devices (+ grants), invites.
		await tx.delete(schema.message).where(eq(schema.message.competitionId, competitionId));
		await tx.delete(schema.device).where(eq(schema.device.competitionId, competitionId));
		await tx.delete(schema.invite).where(eq(schema.invite.competitionId, competitionId));

		// Volunteer contacts on stations, the HQ phone, and memberships other than owners.
		await tx.update(schema.station).set({ contactName: null, contactPhone: null }).where(eq(schema.station.competitionId, competitionId));
		await tx
			.delete(schema.competitionMember)
			.where(and(eq(schema.competitionMember.competitionId, competitionId), ne(schema.competitionMember.role, 'owner')));
		await clearUploader(tx, { competitionId });

		await tx
			.update(schema.competition)
			.set({ anonymisedAt: new Date(), hqPhone: null, registrationOpen: false })
			.where(eq(schema.competition.id, competitionId));
		await recordChange(tx, competitionId, 'competition', competitionId);
		if (actor) {
			await writeAudit(tx, actor, {
				action: 'competition.anonymise', targetType: 'competition', targetId: competitionId, competitionId, seriesId: comp.seriesId,
				details: { patrols: patrolIds.length }
			});
		}
		return { patrols: patrolIds.length };
	});
}

/** The archived edition an old /m or /folj link belonged to, or null. */
export async function retiredLinkCompetition(tokenHash: string) {
	const [row] = await db
		.select({ slug: schema.competition.slug })
		.from(schema.retiredLink)
		.innerJoin(schema.competition, eq(schema.competition.id, schema.retiredLink.competitionId))
		.where(eq(schema.retiredLink.tokenHash, tokenHash))
		.limit(1);
	return row?.slug ?? null;
}

/** Where an old /m or /folj link of an archived edition should go ("/arkiverad/<slug>"), or null. */
export async function archivedLinkTarget(token: string): Promise<string | null> {
	if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
	const slug = await retiredLinkCompetition(await sha256(token));
	return slug ? `/arkiverad/${slug}` : null;
}

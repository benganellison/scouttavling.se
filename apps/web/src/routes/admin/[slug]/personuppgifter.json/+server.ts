import { and, asc, eq, inArray } from 'drizzle-orm';
import { requireCompetition } from '#lib/server/auth.ts';
import { db, schema } from '#lib/server/db/index.ts';
import { writeAudit } from '#lib/server/audit.ts';

/**
 * Every personal datum this edition holds, as JSON (GDPR access requests, or before "Ta bort
 * personuppgifter"). Owners only; each export is written to the audit log (ids only).
 */
export async function GET(event) {
	const { comp, user, access } = await requireCompetition(event, event.params.slug, ['owner']);
	const patrols = await db.select().from(schema.patrol).where(eq(schema.patrol.competitionId, comp.id)).orderBy(asc(schema.patrol.number));
	const ids = patrols.map((p) => p.id);
	const [members, tracks, stations, devices, messages, organisers] = await Promise.all([
		ids.length ? db.select().from(schema.member).where(inArray(schema.member.patrolId, ids)) : Promise.resolve([]),
		db.select().from(schema.track).where(eq(schema.track.competitionId, comp.id)),
		db.select().from(schema.station).where(eq(schema.station.competitionId, comp.id)).orderBy(asc(schema.station.sort)),
		db.select().from(schema.device).where(eq(schema.device.competitionId, comp.id)),
		db.select().from(schema.message).where(eq(schema.message.competitionId, comp.id)),
		db
			.select({ name: schema.appUser.name, memberNo: schema.appUser.memberNo, email: schema.appUser.email, role: schema.competitionMember.role })
			.from(schema.competitionMember)
			.innerJoin(schema.appUser, eq(schema.appUser.id, schema.competitionMember.userId))
			.where(and(eq(schema.competitionMember.competitionId, comp.id)))
	]);
	const trackName = new Map(tracks.map((t) => [t.id, t.name]));
	const stationName = new Map(stations.map((s) => [s.id, s.name]));
	const body = {
		exported: new Date().toISOString(),
		competition: { name: comp.name, slug: comp.slug, organiser: comp.ownerGroupName, hqPhone: comp.hqPhone, personalDataRemoved: comp.anonymisedAt },
		patrols: patrols.map((p) => ({
			number: p.number,
			name: p.name,
			troop: p.troop,
			class: p.trackId ? (trackName.get(p.trackId) ?? null) : null,
			status: p.status,
			paid: p.paid,
			paidAt: p.paidAt,
			registeredAt: p.createdAt,
			contact: { name: p.contactName, phone: p.contactPhone, email: p.contactEmail, memberNo: p.contactMemberNo },
			members: members.filter((m) => m.patrolId === p.id).map((m) => ({ firstName: m.firstName, lastName: m.lastName, troop: m.troopText }))
		})),
		stationContacts: stations.filter((s) => s.contactName || s.contactPhone).map((s) => ({ station: s.name, name: s.contactName, phone: s.contactPhone })),
		volunteers: devices.map((d) => ({
			name: d.displayName,
			stations: d.stationIds.map((id) => stationName.get(id) ?? id),
			joinedAt: d.createdAt,
			lastSeenAt: d.lastSeenAt,
			disconnectedAt: d.revokedAt
		})),
		messages: messages.map((m) => ({ title: m.title, body: m.body, sentAt: m.createdAt })),
		organisers
	};
	await writeAudit(db, access ? { kind: 'site_admin', userId: user.id, reason: access.reason } : { kind: 'user', userId: user.id }, {
		action: 'competition.export_personal_data',
		targetType: 'competition',
		targetId: comp.id,
		competitionId: comp.id,
		seriesId: comp.seriesId,
		details: { patrols: patrols.length }
	});
	return new Response(JSON.stringify(body, null, 2), {
		headers: {
			'content-type': 'application/json; charset=utf-8',
			'content-disposition': `attachment; filename="personuppgifter-${comp.slug}.json"`,
			'cache-control': 'private, no-store'
		}
	});
}

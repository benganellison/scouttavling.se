import { fail, redirect } from '@sveltejs/kit';
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { db, schema } from '#lib/server/db/index.ts';
import { requireCompetition } from '#lib/server/auth.ts';
import { anonymiseCompetition, personalDataLeft } from '#lib/server/anonymise.ts';

const count = (rows: { n: number }[]) => rows[0]?.n ?? 0;

/**
 * "Ta bort personuppgifter": confirm page for a closed edition (manual only).
 * OWNERS ONLY (product decision): organisers get 403 here and in the action; the overview shows
 * them who to ask instead. Every path into anonymiseCompetition() must keep this check.
 */
const REMOVERS = ['owner'] as const;

export async function load(event) {
	const { comp } = await requireCompetition(event, event.params.slug, [...REMOVERS]);
	if (comp.anonymisedAt || comp.status !== 'closed') redirect(303, `/admin/${comp.slug}`);
	const cid = comp.id;
	const n = sql<number>`count(*)::int`;
	const patrolIds = db.select({ id: schema.patrol.id }).from(schema.patrol).where(eq(schema.patrol.competitionId, cid));
	const [patrols, members, devices, messages, invites, team] = await Promise.all([
		personalDataLeft(cid),
		db.select({ n }).from(schema.member).where(inArray(schema.member.patrolId, patrolIds)).then(count),
		db.select({ n }).from(schema.device).where(eq(schema.device.competitionId, cid)).then(count),
		db.select({ n }).from(schema.message).where(eq(schema.message.competitionId, cid)).then(count),
		db.select({ n }).from(schema.invite).where(eq(schema.invite.competitionId, cid)).then(count),
		db
			.select({ n })
			.from(schema.competitionMember)
			.where(and(eq(schema.competitionMember.competitionId, cid), ne(schema.competitionMember.role, 'owner')))
			.then(count)
	]);
	return { counts: { patrols, members, devices, messages, invites, team } };
}

export const actions = {
	default: async (event) => {
		const { comp } = await requireCompetition(event, event.params.slug, [...REMOVERS]);
		if (comp.status !== 'closed') return fail(409, { error: 'Avsluta tävlingen först.' });
		const typed = String((await event.request.formData()).get('confirm') ?? '').trim();
		if (typed.toLocaleLowerCase('sv-SE') !== comp.name.trim().toLocaleLowerCase('sv-SE')) {
			return fail(400, { error: `Skriv tävlingens namn exakt: ${comp.name}`, typed });
		}
		await anonymiseCompetition(comp.id);
		redirect(303, `/admin/${comp.slug}?arkiverad=1`);
	}
};

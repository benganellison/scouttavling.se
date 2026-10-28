import { fail } from '@sveltejs/kit';
import { and, eq, max, ne } from 'drizzle-orm';
import * as v from 'valibot';
import { db, schema } from '#lib/server/db/index.ts';
import { paidAtFor, paidAtNew } from '#lib/server/payments.ts';
import { recordChange } from '#lib/server/changes.ts';

/** Server side of the add/edit patrol form. No birth data is ever accepted. */

const trimmed = (maxLen: number) => v.pipe(v.string(), v.trim(), v.maxLength(maxLen, `Högst ${maxLen} tecken`));

const MemberSchema = v.object({
	firstName: trimmed(80),
	lastName: trimmed(80),
	troopText: trimmed(120)
});

export const PatrolFormSchema = v.object({
	name: v.pipe(trimmed(80), v.minLength(1, 'Ange patrullens namn')),
	number: v.pipe(v.string(), v.trim(), v.regex(/^\d{1,5}$/, 'Ange ett nummer (1–99999)'), v.transform(Number), v.minValue(1, 'Numret måste vara minst 1')),
	trackId: v.union([v.literal(''), v.pipe(v.string(), v.uuid('Okänd klass'))]),
	troop: trimmed(120),
	contactName: trimmed(120),
	contactPhone: v.pipe(trimmed(40), v.regex(/^[\d +()-]*$/, 'Bara siffror, mellanslag, + och -')),
	contactEmail: v.union([v.literal(''), v.pipe(trimmed(160), v.email('Ogiltig e-postadress'))]),
	contactMemberNo: v.pipe(trimmed(12), v.regex(/^\d*$/, 'Medlemsnummer är bara siffror')),
	paid: v.boolean(),
	status: v.picklist(['registered', 'active', 'camp', 'finished', 'resigned'], 'Okänd status'),
	members: v.pipe(v.array(MemberSchema), v.maxLength(30, 'Högst 30 medlemmar'))
});

export type PatrolFormValues = v.InferInput<typeof PatrolFormSchema>;

export function readPatrolForm(form: FormData): PatrolFormValues {
	const s = (k: string) => String(form.get(k) ?? '');
	const first = form.getAll('memberFirst').map(String);
	const last = form.getAll('memberLast').map(String);
	const troop = form.getAll('memberTroop').map(String);
	return {
		name: s('name'),
		number: s('number'),
		trackId: s('trackId'),
		troop: s('troop'),
		contactName: s('contactName'),
		contactPhone: s('contactPhone'),
		contactEmail: s('contactEmail'),
		contactMemberNo: s('contactMemberNo'),
		paid: form.get('paid') === 'on',
		status: s('status') as PatrolFormValues['status'],
		members: first.map((f, i) => ({ firstName: f, lastName: last[i] ?? '', troopText: troop[i] ?? '' })).filter((m) => m.firstName.trim() || m.lastName.trim())
	};
}

export async function nextPatrolNumber(competitionId: string): Promise<number> {
	const [row] = await db
		.select({ n: max(schema.patrol.number) })
		.from(schema.patrol)
		.where(eq(schema.patrol.competitionId, competitionId));
	return row?.n ? row.n + 1 : 101;
}

/** Validates and saves; returns a `fail` on errors or the saved patrol number. */
export async function savePatrol(competitionId: string, patrolId: string | null, form: FormData, userId: string | null = null) {
	const values = readPatrolForm(form);
	const statusWas = String(form.get('statusWas') ?? '');
	const parsed = v.safeParse(PatrolFormSchema, values);
	const errors: Record<string, string> = {};
	if (!parsed.success) {
		for (const issue of parsed.issues) {
			const path = v.getDotPath(issue) ?? 'form';
			const key = path.startsWith('members') ? 'members' : path;
			errors[key] ??= issue.message;
		}
		return { error: fail(400, { values, errors }) };
	}
	const data = parsed.output;
	if (data.trackId) {
		const [t] = await db
			.select()
			.from(schema.track)
			.where(and(eq(schema.track.id, data.trackId), eq(schema.track.competitionId, competitionId)));
		if (!t) errors.trackId = 'Okänd klass';
	}
	const clash = await db
		.select({ id: schema.patrol.id })
		.from(schema.patrol)
		.where(and(eq(schema.patrol.competitionId, competitionId), eq(schema.patrol.number, data.number), patrolId ? ne(schema.patrol.id, patrolId) : undefined));
	if (clash.length) errors.number = `Nummer ${data.number} används redan`;
	if (Object.keys(errors).length) return { error: fail(400, { values, errors }) };

	const row = {
		name: data.name,
		number: data.number,
		trackId: data.trackId || null,
		troop: data.troop,
		contactName: data.contactName || null,
		contactPhone: data.contactPhone || null,
		contactEmail: data.contactEmail ? data.contactEmail.toLowerCase() : null,
		contactMemberNo: data.contactMemberNo || null,
		paid: data.paid
	};
	await db.transaction(async (tx) => {
		let id = patrolId;
		if (id) {
			// Patrol row first (same lock order as score writes). The status is live: phones and the desk
			// change it while this form is open, so it is only written when the organiser changed it here.
			const [cur] = await tx
				.select({ status: schema.patrol.status })
				.from(schema.patrol)
				.where(and(eq(schema.patrol.id, id), eq(schema.patrol.competitionId, competitionId)))
				.for('update');
			const changed = !!cur && data.status !== statusWas && data.status !== cur.status;
			await tx
				.update(schema.patrol)
				.set({ ...row, paidAt: paidAtFor(row.paid), ...(changed ? { status: data.status } : {}) })
				.where(and(eq(schema.patrol.id, id), eq(schema.patrol.competitionId, competitionId)));
			if (changed) await tx.insert(schema.statusEvent).values({ patrolId: id, status: data.status, userId });
			await tx.delete(schema.member).where(eq(schema.member.patrolId, id));
		} else {
			const [created] = await tx
				.insert(schema.patrol)
				.values({ ...row, status: data.status, paidAt: paidAtNew(row.paid), competitionId })
				.returning({ id: schema.patrol.id });
			id = created.id;
			if (data.status !== 'registered') await tx.insert(schema.statusEvent).values({ patrolId: id, status: data.status, userId });
		}
		if (data.members.length) {
			await tx.insert(schema.member).values(data.members.map((m) => ({ patrolId: id!, firstName: m.firstName, lastName: m.lastName, troopText: m.troopText })));
		}
		await recordChange(tx, competitionId, 'patrol', id);
	});
	return { number: data.number };
}

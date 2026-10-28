import { fail } from '@sveltejs/kit';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { requireCompetition } from '#lib/server/auth.ts';
import { db, schema } from '#lib/server/db/index.ts';
import type { ConflictExisting, ConflictIncoming } from '#lib/server/db/schema.ts';
import { recordChange } from '#lib/server/changes.ts';
import { voidScore, writeScore } from '#lib/server/scores.ts';
import { formatTime, loadStations } from '#lib/server/live.ts';

/** One side as shown: the stored conflict side plus its author. */
type Side = ConflictIncoming & Omit<ConflictExisting, 'state'> & { state?: string };

export async function load(event) {
	const { comp } = await requireCompetition(event, event.params.slug);
	event.depends(`live:${comp.slug}`);
	const [rows, stations, devices] = await Promise.all([
		db
			.select({ c: schema.scoreConflict, patrolNumber: schema.patrol.number, patrolName: schema.patrol.name })
			.from(schema.scoreConflict)
			.innerJoin(schema.patrol, eq(schema.patrol.id, schema.scoreConflict.patrolId))
			.where(and(eq(schema.scoreConflict.competitionId, comp.id), eq(schema.scoreConflict.status, 'open')))
			.orderBy(asc(schema.scoreConflict.createdAt)),
		loadStations(comp.id),
		db.select({ id: schema.device.id, name: schema.device.displayName }).from(schema.device).where(eq(schema.device.competitionId, comp.id))
	]);
	const devName = new Map(devices.map((d) => [d.id, d.name]));
	// The stored `existing` side has no author; look it up from the score revision with that version.
	// One query for all open conflicts (not one per conflict: a phone with a wrong clock can park hundreds).
	const revs = rows.length
		? await db
				.select({
					patrolId: schema.score.patrolId,
					itemId: schema.score.itemId,
					version: schema.scoreRevision.version,
					deviceId: schema.scoreRevision.deviceId,
					userId: schema.scoreRevision.userId,
					origin: schema.scoreRevision.origin
				})
				.from(schema.scoreRevision)
				.innerJoin(schema.score, eq(schema.score.id, schema.scoreRevision.scoreId))
				.where(
					and(
						eq(schema.score.competitionId, comp.id),
						sql`exists (select 1 from ${schema.scoreConflict} c where c.competition_id = ${comp.id} and c.status = 'open' and c.patrol_id = ${schema.score.patrolId} and c.item_id = ${schema.score.itemId})`
					)
				)
		: [];
	const revsOf = new Map<string, typeof revs>();
	for (const r of revs) revsOf.set(`${r.patrolId}|${r.itemId}`, [...(revsOf.get(`${r.patrolId}|${r.itemId}`) ?? []), r]);
	const authors = rows.map(({ c }) => {
		const ex = c.existing;
		const list = (revsOf.get(`${c.patrolId}|${c.itemId}`) ?? []).filter((r) => !ex.version || r.version === ex.version);
		const r = list.sort((a, b) => b.version - a.version)[0];
		return r ? { deviceId: r.deviceId, userId: r.userId, origin: r.origin } : null;
	});
	const userIds = [...new Set([...authors.map((a) => a?.userId), ...rows.map(({ c }) => c.incoming.userId)].filter((x): x is string => !!x))];
	const users = userIds.length
		? await db.select({ id: schema.appUser.id, name: schema.appUser.name }).from(schema.appUser).where(inArray(schema.appUser.id, userIds))
		: [];
	const userName = new Map(users.map((u) => [u.id, u.name]));
	/** Who reported: device display name, the organiser's name, or "Papper". */
	const who = (x: Side): string | null =>
		x.deviceId
			? (devName.get(x.deviceId) ?? 'Okänd enhet')
			: x.userId && userName.get(x.userId)
				? x.origin === 'paper'
					? `Papper (${userName.get(x.userId)})`
					: userName.get(x.userId)!
				: x.origin === 'paper'
					? 'Papper'
					: null;
	const where = new Map(
		stations.flatMap((s) => s.items.map((i) => [i.id, s.items.length > 1 ? `${s.code} ${s.name} · ${i.name}` : `${s.code} ${s.name}`] as const))
	);
	const side = (x: Side) => ({
		points: x.points ?? null,
		stylePoints: x.stylePoints ?? 0,
		state: x.state ?? 'active',
		origin: x.origin ?? null,
		device: who(x),
		reason: x.reason ?? null
	});
	return {
		comp: { slug: comp.slug, name: comp.name },
		conflicts: rows.map(({ c, patrolNumber, patrolName }, i) => ({
			id: c.id,
			kind: c.kind,
			time: formatTime(c.createdAt),
			patrol: `${patrolNumber} ${patrolName}`,
			patrolNumber,
			where: where.get(c.itemId) ?? 'Okänd kontroll',
			existing: side({
				...c.existing,
				...(authors[i] ? { deviceId: authors[i]!.deviceId, userId: authors[i]!.userId, origin: c.existing.origin ?? authors[i]!.origin } : {})
			}),
			incoming: side({ ...c.incoming, ...(c.incoming.type === 'VoidScore' ? { state: 'void' } : {}) })
		}))
	};
}

async function openConflict(competitionId: string, id: string) {
	const [c] = await db
		.select()
		.from(schema.scoreConflict)
		.where(and(eq(schema.scoreConflict.id, id), eq(schema.scoreConflict.competitionId, competitionId), eq(schema.scoreConflict.status, 'open')))
		.limit(1);
	return c ?? null;
}

async function markResolved(competitionId: string, id: string) {
	await db.transaction(async (tx) => {
		await tx.update(schema.scoreConflict).set({ status: 'resolved' }).where(eq(schema.scoreConflict.id, id));
		await recordChange(tx, competitionId, 'conflict', id);
	});
}

export const actions = {
	keep: async (event) => {
		const { comp } = await requireCompetition(event, event.params.slug);
		const id = String((await event.request.formData()).get('id') ?? '');
		const c = await openConflict(comp.id, id);
		if (!c) return fail(404, { message: 'Konflikten är redan löst' });
		await markResolved(comp.id, id);
		return { message: 'Befintlig poäng behölls.' };
	},
	useNew: async (event) => {
		const { comp, user } = await requireCompetition(event, event.params.slug);
		const id = String((await event.request.formData()).get('id') ?? '');
		const c = await openConflict(comp.id, id);
		if (!c) return fail(404, { message: 'Konflikten är redan löst' });
		const inc = c.incoming;
		const base = {
			competitionId: comp.id,
			patrolId: c.patrolId,
			itemId: c.itemId,
			baseVersion: null,
			origin: 'admin' as const,
			userId: user.id,
			deviceId: null,
			force: true
		};
		// A quarantined undo ("Ångra" on the phone) carries no points: using it means removing the score.
		if (inc.type === 'VoidScore') {
			await voidScore({ ...base, reason: 'Konflikt löst: ångringen från kontrollen används' });
			await markResolved(comp.id, id);
			return { message: 'Poängen är borttagen, som funktionären ångrade.' };
		}
		const raw = inc.raw ?? { value: inc.points ?? 0, style: inc.stylePoints ?? null };
		const res = await writeScore({ ...base, raw, reason: 'Konflikt löst: ny rapport används' });
		if (res.result === 'rejected') return fail(400, { message: `Kunde inte spara: ${res.reason}` });
		await markResolved(comp.id, id);
		return { message: 'Den nya poängen används.' };
	}
};

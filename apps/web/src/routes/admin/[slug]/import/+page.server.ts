import { fail } from '@sveltejs/kit';
import { eq, inArray, max } from 'drizzle-orm';
import { requireCompetition } from '#lib/server/auth.ts';
import { recordChange } from '#lib/server/changes.ts';
import { db, schema } from '#lib/server/db/index.ts';
import { paidAtFor, paidAtNew } from '#lib/server/payments.ts';
import { loadPatrols, loadTracks } from '../print/prep.server.ts';
import { matchExisting, parseImportPayload } from './validate.ts';

export async function load(event) {
	const { comp } = await requireCompetition(event, event.params.slug);
	const [tracks, patrols] = await Promise.all([loadTracks(comp.id), loadPatrols(comp.id)]);
	return {
		competition: { slug: comp.slug, name: comp.name },
		tracks: tracks.map((t) => ({ id: t.id, name: t.name })),
		// Only what the browser needs to label rows as "Ny" / "Uppdateras".
		existing: patrols.map((p) => ({ id: p.id, name: p.name, contactMemberNo: p.contactMemberNo }))
	};
}

export const actions = {
	commit: async (event) => {
		const { comp } = await requireCompetition(event, event.params.slug, ['owner', 'organiser']);
		const form = await event.request.formData();
		const keys = [...form.keys()];
		if (keys.some((k) => k !== 'payload')) return fail(400, { message: 'Okända fält i importen' });
		const parsed = parseImportPayload(String(form.get('payload') ?? ''));
		if (!parsed.ok) return fail(400, { message: parsed.message });
		const { rows, createTracks } = parsed.payload;

		const result = await db.transaction(async (tx) => {
			const tracks = await tx.select().from(schema.track).where(eq(schema.track.competitionId, comp.id));
			const byName = new Map(tracks.map((t) => [t.name.toLowerCase(), t.id]));
			let sort = Math.max(0, ...tracks.map((t) => t.sort));
			const wanted = new Set(rows.map((r) => r.trackText.toLowerCase()));
			for (const name of new Set(createTracks)) {
				if (byName.has(name.toLowerCase()) || !wanted.has(name.toLowerCase())) continue;
				const [t] = await tx.insert(schema.track).values({ competitionId: comp.id, name, sort: ++sort }).returning();
				byName.set(name.toLowerCase(), t.id);
			}

			const existing = await tx
				.select({ id: schema.patrol.id, name: schema.patrol.name, troop: schema.patrol.troop, contactMemberNo: schema.patrol.contactMemberNo })
				.from(schema.patrol)
				.where(eq(schema.patrol.competitionId, comp.id));
			const [top] = await tx.select({ n: max(schema.patrol.number) }).from(schema.patrol).where(eq(schema.patrol.competitionId, comp.id));
			let next = top?.n ? top.n + 1 : 101;
			let created = 0;
			let updated = 0;
			const touched: string[] = [];
			for (const r of rows) {
				const trackId = r.trackText ? (byName.get(r.trackText.toLowerCase()) ?? null) : null;
				const fields = {
					name: r.patrolName,
					troop: r.troop,
					contactName: r.contactName || null,
					contactPhone: r.contactPhone || null,
					contactEmail: r.contactEmail ? r.contactEmail.toLowerCase() : null,
					contactMemberNo: r.contactMemberNo || null
				};
				// Only patrols that existed before this import, each matched at most once: a file with
				// two "Vargarna" must not turn into one patrol overwritten by the second row.
				const hit = matchExisting(r, existing);
				let id: string;
				if (hit) {
					id = hit.id;
					existing.splice(existing.indexOf(hit), 1);
					// An update never erases what the file does not say: no payment column keeps "Betald",
					// an empty or unknown class keeps the patrol's class.
					await tx
						.update(schema.patrol)
						.set({
							...fields,
							...(trackId ? { trackId } : {}),
							...(r.paid === null ? {} : { paid: r.paid, paidAt: paidAtFor(r.paid) })
						})
						.where(eq(schema.patrol.id, id));
					updated++;
				} else {
					const paid = r.paid ?? false;
					const [p] = await tx
						.insert(schema.patrol)
						.values({ ...fields, trackId, paid, paidAt: paidAtNew(paid), competitionId: comp.id, number: next++ })
						.returning({ id: schema.patrol.id });
					id = p.id;
					created++;
				}
				touched.push(id);
				await tx.delete(schema.member).where(eq(schema.member.patrolId, id));
				if (r.members.length) await tx.insert(schema.member).values(r.members.map((m) => ({ patrolId: id, ...m })));
				await recordChange(tx, comp.id, 'patrol', id);
			}
			const linked = rows.filter((r) => r.contactMemberNo).length;
			const unique = new Set(touched).size;
			const memberRows = unique ? await tx.select({ id: schema.member.id }).from(schema.member).where(inArray(schema.member.patrolId, [...new Set(touched)])) : [];
			return { imported: unique, created, updated, linked, members: memberRows.length };
		});
		return { done: result };
	}
};

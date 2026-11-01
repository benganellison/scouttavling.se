import { fail, redirect } from '@sveltejs/kit';
import { and, asc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import * as v from 'valibot';
import { ITEM_MODES } from '@scouttavling/domain';
import { db, schema } from '#lib/server/db/index.ts';
import { requireCompetition } from '#lib/server/auth.ts';
import { stationsOf } from '#lib/server/queries.ts';
import { createStation, deleteStation, moveStation, saveStation } from '#lib/server/stations.ts';

const EDIT_ROLES = ['owner', 'organiser'] as const;

export async function load(event) {
	const { comp } = await requireCompetition(event, event.params.slug);
	const cid = comp.id;
	const stations = await stationsOf(cid);
	const ids = stations.map((s) => s.id);
	const [items, links, invited, scoreCounts] = ids.length
		? await Promise.all([
				db.select().from(schema.scoreItem).where(inArray(schema.scoreItem.stationId, ids)).orderBy(asc(schema.scoreItem.sort)),
				db.select().from(schema.stationTrack).where(inArray(schema.stationTrack.stationId, ids)),
				db
					.selectDistinct({ stationId: schema.invite.stationId })
					.from(schema.invite)
					.where(and(eq(schema.invite.competitionId, cid), isNotNull(schema.invite.stationId))),
				db
					.select({ itemId: schema.score.itemId, n: sql<number>`count(*)::int` })
					.from(schema.score)
					.where(and(eq(schema.score.competitionId, cid), eq(schema.score.state, 'active')))
					.groupBy(schema.score.itemId)
			])
		: [[], [], [], []];
	const invitedSet = new Set(invited.map((i) => i.stationId));
	const scoresBy = new Map(scoreCounts.map((r) => [r.itemId, r.n]));
	return {
		stations: stations.map((s) => ({
			id: s.id,
			name: s.name,
			sort: s.sort,
			dayId: s.dayId,
			customCode: s.customCode,
			role: s.role,
			allTracks: s.allTracks,
			startable: s.startable,
			trackIds: links.filter((l) => l.stationId === s.id).map((l) => l.trackId),
			invited: invitedSet.has(s.id),
			items: items
				.filter((i) => i.stationId === s.id)
				.map((i) => ({
					id: i.id,
					name: i.name,
					mode: i.mode,
					min: i.min,
					max: i.max,
					distinctValues: i.distinctValues ?? [],
					countMultiplier: i.countMultiplier ?? 1,
					styleEnabled: i.styleEnabled,
					styleMin: i.styleMin,
					styleMax: i.styleMax,
					countsForTiebreak: i.countsForTiebreak,
					scores: scoresBy.get(i.id) ?? 0
				}))
		}))
	};
}

// ---------- parsing (the rules are in packages/domain stations.ts) ----------

const Int = v.pipe(v.number(), v.integer());
const ItemIn = v.object({
	id: v.optional(v.nullable(v.string())),
	name: v.string(),
	mode: v.picklist(ITEM_MODES),
	min: Int,
	max: Int,
	distinctValues: v.array(v.object({ value: Int, label: v.optional(v.string()) })),
	countMultiplier: Int,
	styleEnabled: v.boolean(),
	styleMin: Int,
	styleMax: Int,
	countsForTiebreak: v.boolean()
});
const StationIn = v.object({
	id: v.string(),
	name: v.string(),
	customCode: v.string(),
	dayId: v.nullable(v.string()),
	/** "Roll": the day's start / finish, null = ordinary station. Absent = keep the stored role. */
	role: v.optional(v.nullable(v.picklist(['start', 'finish']))),
	allTracks: v.boolean(),
	trackIds: v.array(v.string()),
	startable: v.boolean(),
	items: v.array(ItemIn)
});
type Errors = Record<string, string>;

export const actions = {
	save: async (event) => {
		const { comp } = await requireCompetition(event, event.params.slug, [...EDIT_ROLES]);
		const f = await event.request.formData();
		let input: v.InferOutput<typeof StationIn>;
		try {
			input = v.parse(StationIn, JSON.parse(String(f.get('payload') ?? '')));
		} catch {
			return fail(400, { stationId: null, errors: { form: 'Formuläret kunde inte läsas. Ladda om sidan och försök igen.' } as Errors });
		}
		const r = await saveStation(comp, input);
		if (!r.ok) return fail(r.status, { stationId: input.id, errors: r.errors });
		return { saved: input.id, at: Date.now() };
	},

	create: async (event) => {
		const { comp } = await requireCompetition(event, event.params.slug, [...EDIT_ROLES]);
		const f = await event.request.formData();
		const id = await createStation(comp, String(f.get('dayId') ?? ''));
		redirect(303, `/admin/${comp.slug}/stations?s=${id}`);
	},

	delete: async (event) => {
		const { comp } = await requireCompetition(event, event.params.slug, [...EDIT_ROLES]);
		const id = String((await event.request.formData()).get('id') ?? '');
		const problem = await deleteStation(comp, id);
		if (problem) return fail(problem.status, { stationId: id, errors: { form: problem.message } as Errors });
		redirect(303, `/admin/${comp.slug}/stations`);
	},

	move: async (event) => {
		const { comp } = await requireCompetition(event, event.params.slug, [...EDIT_ROLES]);
		const f = await event.request.formData();
		const dir = String(f.get('dir') ?? '') === 'up' ? -1 : 1;
		return { moved: await moveStation(comp, String(f.get('id') ?? ''), dir) };
	}
};

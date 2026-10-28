import { error, fail } from '@sveltejs/kit';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { requireCompetition } from '#lib/server/auth.ts';
import { db, schema } from '#lib/server/db/index.ts';
import { itemDef, writeScore } from '#lib/server/scores.ts';
import { STATUS_LABEL } from '#lib/ui/patrols/labels.ts';
import { firstName, formatTime, getResults, loadStations, stationAppliesTo } from '#lib/server/live.ts';

const pts = (p: number, s: number) => (s ? `${p} + ${s}` : `${p}`);

async function loadPatrol(competitionId: string, nrParam: string) {
	const nr = Number(nrParam);
	if (!Number.isInteger(nr)) error(404, 'Patrullen finns inte');
	const [p] = await db
		.select()
		.from(schema.patrol)
		.where(and(eq(schema.patrol.competitionId, competitionId), eq(schema.patrol.number, nr)))
		.limit(1);
	if (!p) error(404, 'Patrullen finns inte');
	return p;
}

export async function load(event) {
	const { comp } = await requireCompetition(event, event.params.slug);
	event.depends(`live:${comp.slug}`);
	const p = await loadPatrol(comp.id, event.params.nr);
	const [members, tracks, stations, scores, results, statusEvents] = await Promise.all([
		db.select().from(schema.member).where(eq(schema.member.patrolId, p.id)),
		db.select().from(schema.track).where(eq(schema.track.competitionId, comp.id)),
		loadStations(comp.id),
		db.select().from(schema.score).where(eq(schema.score.patrolId, p.id)),
		getResults(comp),
		db
			.select({ e: schema.statusEvent, deviceName: schema.device.displayName, userName: schema.appUser.name })
			.from(schema.statusEvent)
			.leftJoin(schema.device, eq(schema.device.id, schema.statusEvent.deviceId))
			.leftJoin(schema.appUser, eq(schema.appUser.id, schema.statusEvent.userId))
			.where(eq(schema.statusEvent.patrolId, p.id))
	]);
	const revisions = scores.length
		? await db
				.select({ r: schema.scoreRevision, deviceName: schema.device.displayName, userName: schema.appUser.name })
				.from(schema.scoreRevision)
				.leftJoin(schema.device, eq(schema.device.id, schema.scoreRevision.deviceId))
				.leftJoin(schema.appUser, eq(schema.appUser.id, schema.scoreRevision.userId))
				.where(
					inArray(
						schema.scoreRevision.scoreId,
						scores.map((s) => s.id)
					)
				)
				.orderBy(asc(schema.scoreRevision.version))
		: [];

	const label = new Map<string, string>();
	for (const st of stations) for (const it of st.items) label.set(it.id, st.items.length > 1 ? `${st.code} ${it.name}` : st.code);
	const itemOfScore = new Map(scores.map((s) => [s.id, s.itemId]));

	type Ev = { at: Date; time: string; text: string; kind: 'score' | 'edit' | 'void' | 'status'; reason: string | null };
	const events: Ev[] = [];
	const prevByScore = new Map<string, (typeof revisions)[number]['r']>();
	for (const { r, deviceName, userName } of revisions) {
		const who = deviceName ?? (userName ? firstName(userName) : r.origin === 'paper' ? 'papper' : 'okänd');
		const code = label.get(itemOfScore.get(r.scoreId) ?? '') ?? '?';
		const prev = prevByScore.get(r.scoreId);
		let text: string;
		let kind: Ev['kind'];
		if (r.state === 'void') {
			text = `${code} ångrad av ${who} · var ${pts(r.points, r.stylePoints)}`;
			kind = 'void';
		} else if (!prev) {
			text = `${code} rapporterad av ${who} · ${pts(r.points, r.stylePoints)}`;
			kind = 'score';
		} else if (prev.state === 'void') {
			text = `${code} återställd av ${who} · ${pts(r.points, r.stylePoints)}`;
			kind = 'edit';
		} else {
			text = `${code} ändrad av ${who} · var ${pts(prev.points, prev.stylePoints)} → ${pts(r.points, r.stylePoints)}`;
			kind = 'edit';
		}
		events.push({ at: r.at, time: formatTime(r.at), text, kind, reason: r.reason && r.reason !== 'seed' ? r.reason : null });
		prevByScore.set(r.scoreId, r);
	}
	for (const { e, deviceName, userName } of statusEvents) {
		const who = deviceName ?? (userName ? firstName(userName) : null);
		events.push({ at: e.at, time: formatTime(e.at), text: `Status: ${STATUS_LABEL[e.status]}${who ? ` · ${who}` : ''}`, kind: 'status', reason: null });
	}
	events.sort((a, b) => b.at.getTime() - a.at.getTime());

	const track = tracks.find((t) => t.id === p.trackId) ?? null;
	const row = results.tracks.find((t) => t.trackId === p.trackId)?.rows.find((r) => r.patrolId === p.id) ?? null;
	const byItem = new Map(scores.map((s) => [s.itemId, s]));

	return {
		comp: { slug: comp.slug, name: comp.name },
		patrol: {
			number: p.number,
			name: p.name,
			troop: p.troop,
			status: p.status,
			contactName: p.contactName,
			contactPhone: p.contactPhone,
			track: track?.name ?? 'Ingen klass',
			trackCount: results.tracks.find((t) => t.trackId === p.trackId)?.rows.length ?? 0,
			startStation: stations.find((s) => s.id === p.startStationId) ?? null,
			/** "I läger · klar för dagen 18:42". */
			campAt:
				p.status === 'camp'
					? (() => {
							const last = statusEvents
								.filter(({ e }) => e.status === 'camp')
								.map(({ e }) => e.at)
								.sort((a, b) => b.getTime() - a.getTime())[0];
							return last ? formatTime(last) : null;
						})()
					: null
		},
		members: members.map((m) => `${m.firstName} ${m.lastName}`.trim()),
		result: row ? { place: row.place, total: row.total, scorePoints: row.scorePoints, stylePoints: row.stylePoints, tied: row.tied } : null,
		stations: stations.map((st) => ({
			id: st.id,
			code: st.code,
			name: st.name,
			checkpoint: st.checkpoint,
			applies: stationAppliesTo(st, p.trackId),
			items: st.items.map((it) => {
				const s = byItem.get(it.id);
				return {
					id: it.id,
					name: it.name,
					def: itemDef(it, comp),
					score: s ? { points: s.points, stylePoints: s.stylePoints, raw: s.raw, version: s.version, state: s.state } : null,
					version: s?.version ?? null
				};
			})
		})),
		events
	};
}

export const actions = {
	save: async (event) => {
		const { comp, user } = await requireCompetition(event, event.params.slug);
		const p = await loadPatrol(comp.id, event.params.nr);
		const f = await event.request.formData();
		const itemId = String(f.get('itemId') ?? '');
		const stations = await loadStations(comp.id);
		const item = stations.flatMap((s) => s.items).find((i) => i.id === itemId);
		if (!item) return fail(400, { itemId, message: 'Okänd kontroll' });
		const value = Number(f.get('value') ?? 0);
		const styleRaw = f.get('style');
		const style = styleRaw === null || styleRaw === '' ? null : Number(styleRaw);
		const baseRaw = String(f.get('baseVersion') ?? '');
		const reason = String(f.get('reason') ?? '').trim() || null;
		if (f.get('value') === null && item.mode !== 'CHECKIN' && item.mode !== 'AUTO_ON_SCAN') return fail(400, { itemId, message: 'Välj poäng' });
		const res = await writeScore({
			competitionId: comp.id,
			patrolId: p.id,
			itemId,
			raw: { value, style },
			baseVersion: baseRaw === '' ? null : Number(baseRaw),
			origin: 'admin',
			userId: user.id,
			reason
		});
		if (res.result === 'rejected') return fail(400, { itemId, message: res.reason });
		if (res.result === 'conflict') return fail(409, { itemId, message: 'Poängen ändrades av någon annan samtidigt. Ändringen ligger nu under Konflikter.' });
		if (res.result === 'duplicate') return { itemId, saved: false, message: 'Oförändrat — samma poäng var redan sparad.' };
		return { itemId, saved: true, message: 'Ändringen är sparad.' };
	}
};

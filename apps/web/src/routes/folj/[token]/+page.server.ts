import { error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '#lib/server/db/index.ts';
import { NO_STORE, missLimiter, patrolByFollowToken } from '#lib/server/registration.ts';
import { formatTime, getResults, loadStations, stationAppliesTo } from '#lib/server/live.ts';

/**
 * "Följ patrullen": read-only live view of one patrol for leaders and parents.
 * No personal data: patrol name, number, kår, class and progress only.
 * The page polls (invalidateAll) every 10 s.
 */
export async function load({ params, setHeaders, getClientAddress, depends }) {
	depends('folj:data');
	const ip = getClientAddress();
	if (missLimiter.blocked(ip)) error(429, 'För många försök. Vänta en stund.');
	const row = await patrolByFollowToken(params.token);
	if (!row) {
		missLimiter.hit(ip);
		error(404, 'Länken finns inte eller har slutat gälla');
	}
	setHeaders(NO_STORE);
	const { patrol, comp } = row;
	const compInfo = { name: comp.name, slug: comp.slug, status: comp.status, publicResults: comp.publicResults };
	if (!comp.followEnabled) return { enabled: false as const, comp: compInfo };

	const [stations, scores, events, track] = await Promise.all([
		loadStations(comp.id),
		db
			.select({ itemId: schema.score.itemId, points: schema.score.points, stylePoints: schema.score.stylePoints, updatedAt: schema.score.updatedAt })
			.from(schema.score)
			.where(and(eq(schema.score.patrolId, patrol.id), eq(schema.score.state, 'active'))),
		db.select({ status: schema.statusEvent.status, at: schema.statusEvent.at }).from(schema.statusEvent).where(eq(schema.statusEvent.patrolId, patrol.id)),
		patrol.trackId ? db.select({ name: schema.track.name }).from(schema.track).where(eq(schema.track.id, patrol.trackId)).then((r) => r[0]?.name ?? '') : Promise.resolve('')
	]);
	const showScores = comp.followShowScores;
	const mine = stations.filter((s) => s.items.length > 0 && stationAppliesTo(s, patrol.trackId));
	const byItem = new Map(scores.map((s) => [s.itemId, s]));
	const list = mine.map((s) => {
		const got = s.items.map((i) => byItem.get(i.id)).filter((x) => x !== undefined);
		const last = got.reduce<Date | null>((acc, x) => (!acc || x.updatedAt > acc ? x.updatedAt : acc), null);
		return {
			code: s.code,
			name: s.name,
			checkpoint: s.checkpoint,
			done: got.length > 0,
			time: last ? formatTime(last) : null,
			points: showScores && got.length && !s.checkpoint ? got.reduce((a, x) => a + x.points + x.stylePoints, 0) : null,
			sortAt: last?.getTime() ?? null
		};
	});
	const firstAt = (st: string) => events.filter((e) => e.status === st).map((e) => e.at).sort((a, b) => a.getTime() - b.getTime())[0];
	const started = firstAt('active');
	const finished = firstAt('finished');
	const lastAt = (st: string) => events.filter((e) => e.status === st).map((e) => e.at).sort((a, b) => b.getTime() - a.getTime())[0];
	const camp = patrol.status === 'camp' ? lastAt('camp') : undefined;

	let placement: { place: number; total: number; of: number; tied: boolean } | null = null;
	if (showScores && patrol.trackId) {
		const res = await getResults(comp, 10_000);
		const t = res.tracks.find((x) => x.trackId === patrol.trackId);
		const r = t?.rows.find((x) => x.patrolId === patrol.id);
		if (t && r) placement = { place: r.place, total: r.total, of: t.rows.length, tied: r.tied };
	}

	return {
		enabled: true as const,
		comp: compInfo,
		showScores,
		patrol: { number: patrol.number, name: patrol.name, troop: patrol.troop, track, status: patrol.status },
		started: started ? formatTime(started) : null,
		finished: finished ? formatTime(finished) : null,
		/** "I läger · klar för dagen 18:42" (multi-day, done for the day). */
		campAt: camp ? formatTime(camp) : null,
		done: list.filter((s) => s.done).length,
		total: list.length,
		stations: list,
		placement,
		updated: formatTime(new Date())
	};
}

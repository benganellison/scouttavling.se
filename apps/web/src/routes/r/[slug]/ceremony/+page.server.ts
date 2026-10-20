import { requireCompetition } from '#lib/server/auth.ts';
import { formatTime, getResults, type TrackResults } from '#lib/server/live.ts';

/** Frozen ceremony snapshots per competition + class; `?fresh=1` takes a new one. */
const snapshots: Map<string, { at: Date; track: TrackResults }> = ((globalThis as unknown as { __ceremony?: Map<string, { at: Date; track: TrackResults }> }).__ceremony ??= new Map());

export async function load(event) {
	const { comp } = await requireCompetition(event, event.params.slug);
	const classId = event.url.searchParams.get('class');
	const res = await getResults(comp);
	const classes = res.tracks.map((t) => ({ id: t.trackId, name: t.name, count: t.rows.length }));
	if (!classId || !res.tracks.some((t) => t.trackId === classId)) {
		return { comp: { slug: comp.slug, name: comp.name }, classes, ceremony: null };
	}
	const key = `${comp.id}:${classId}`;
	let snap = snapshots.get(key);
	if (!snap || event.url.searchParams.get('fresh') === '1') {
		snap = { at: new Date(), track: structuredClone(res.tracks.find((t) => t.trackId === classId)!) };
		snapshots.set(key, snap);
	}
	return {
		comp: { slug: comp.slug, name: comp.name },
		classes,
		ceremony: {
			classId,
			className: snap.track.name,
			takenAt: formatTime(snap.at),
			rows: snap.track.rows.slice(0, 10).map((r) => ({
				number: r.number, name: r.name, troop: r.troop, place: r.place, total: r.total, tied: r.tied, tieNote: r.tieNote,
				scorePoints: r.scorePoints, stylePoints: r.stylePoints
			}))
		}
	};
}

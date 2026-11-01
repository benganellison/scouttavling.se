export type Strategy = 'BALANCED' | 'ALL' | 'PER_TRACK';

export interface DistPatrol {
	id: string;
	trackId: string;
	/** Station already fixed by the organiser (manual move). */
	lockedStationId?: string | null;
}

export interface DistStation {
	id: string;
	order: number;
	/** Track ids that do this station; null = all tracks. */
	trackIds: string[] | null;
	/** Checkpoints (lunch etc.) are never start stations. */
	startable: boolean;
}

export interface DistResult {
	assignment: Map<string, string>;
	/** Patrols per station, for the preview chart. */
	counts: Map<string, number>;
	/** Patrols placed on a station their track does not do (only ALL/PER_TRACK can do this). */
	ineligible: number;
}

/** Deterministic PRNG so a preview can be reproduced ("Slumpa om" bumps the seed). */
function mulberry32(seed: number) {
	return () => {
		seed |= 0;
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function shuffle<T>(arr: T[], rnd: () => number): T[] {
	const a = [...arr];
	for (let i = a.length - 1; i > 0; i--) {
		const j = Math.floor(rnd() * (i + 1));
		[a[i], a[j]] = [a[j], a[i]];
	}
	return a;
}

const eligible = (s: DistStation, trackId: string) => s.startable && (s.trackIds === null || s.trackIds.includes(trackId));

/**
 * Assigns start stations.
 * - ALL: gokapp's "distribute all": one long round-robin over the stations.
 * - PER_TRACK: gokapp's per-track variant: every track restarts at the first station.
 * - BALANCED (default): most constrained tracks first, each patrol to the eligible
 *   station with the fewest patrols (ties: fewest of the same track), so no track
 *   ever starts at a station it does not do.
 */
export function distribute(patrols: DistPatrol[], stations: DistStation[], strategy: Strategy, seed = 1): DistResult {
	const rnd = mulberry32(seed);
	const st = [...stations].filter((s) => s.startable).sort((a, b) => a.order - b.order);
	const assignment = new Map<string, string>();
	const counts = new Map(st.map((s) => [s.id, 0]));
	const perTrack = new Map<string, number>();
	const key = (s: string, t: string) => `${s}|${t}`;
	const place = (p: DistPatrol, s: DistStation) => {
		assignment.set(p.id, s.id);
		counts.set(s.id, (counts.get(s.id) ?? 0) + 1);
		perTrack.set(key(s.id, p.trackId), (perTrack.get(key(s.id, p.trackId)) ?? 0) + 1);
	};
	if (st.length === 0) return { assignment, counts, ineligible: 0 };

	const locked = patrols.filter((p) => p.lockedStationId && counts.has(p.lockedStationId));
	locked.forEach((p) =>
		place(
			p,
			st.find((s) => s.id === p.lockedStationId)!
		)
	);
	const free = shuffle(
		patrols.filter((p) => !locked.includes(p)),
		rnd
	);
	const offset = Math.floor(rnd() * st.length);

	if (strategy === 'ALL') {
		free.forEach((p, i) => place(p, st[(i + offset) % st.length]));
	} else if (strategy === 'PER_TRACK') {
		const tracks = [...new Set(free.map((p) => p.trackId))];
		for (const t of tracks) free.filter((p) => p.trackId === t).forEach((p, i) => place(p, st[(i + offset) % st.length]));
	} else {
		const tracks = [...new Set(free.map((p) => p.trackId))].sort((a, b) => st.filter((s) => eligible(s, a)).length - st.filter((s) => eligible(s, b)).length);
		for (const t of tracks) {
			const options = st.filter((s) => eligible(s, t));
			const pool = options.length ? options : st;
			for (const p of free.filter((fp) => fp.trackId === t)) {
				const best = [...pool].sort(
					(a, b) =>
						counts.get(a.id)! - counts.get(b.id)! ||
						(perTrack.get(key(a.id, t)) ?? 0) - (perTrack.get(key(b.id, t)) ?? 0) ||
						((a.order + offset) % st.length) - ((b.order + offset) % st.length)
				)[0];
				place(p, best);
			}
		}
	}

	let ineligible = 0;
	for (const p of patrols) {
		const s = st.find((x) => x.id === assignment.get(p.id));
		if (s && !eligible(s, p.trackId)) ineligible++;
	}
	return { assignment, counts, ineligible };
}

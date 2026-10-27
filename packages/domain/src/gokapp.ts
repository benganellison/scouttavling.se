/**
 * gokapp → scouttavling.se: the pure parts of importing an old year into the archive
 * (docs/architecture/02 §9). No I/O; the reader and writer live in apps/web.
 */
import type { ScoreItemDef } from './scoring.ts';

/** gokapp `station` row, only the columns we read (never stationcontact/stationphone/user_id). */
export interface GokappStation {
	id: number;
	stationnumber: number;
	stationname: string | null;
	alltracks: boolean;
	minscore: number;
	maxscore: number;
	minstylescore: number;
	maxstylescore: number;
	waypoint: boolean | null;
	usedistinctscores: boolean | null;
	distinctscores: string | null;
}

export type GokappStatus = 'REGISTERED' | 'ACTIVE' | 'FINISHED' | 'RESIGNED';

export type ItemShape = Pick<ScoreItemDef, 'mode' | 'min' | 'max' | 'styleEnabled' | 'styleMin' | 'styleMax' | 'countsForTiebreak'> & {
	distinctValues: { value: number }[] | null;
};

/** One gokapp station = one station with one item (02 §9 mapping table). */
export function itemFromStation(s: GokappStation): ItemShape {
	const styleEnabled = s.maxstylescore > 0;
	const style = { styleEnabled, styleMin: styleEnabled ? s.minstylescore : 0, styleMax: styleEnabled ? s.maxstylescore : 0 };
	if (s.waypoint) return { mode: 'CHECKIN', min: 0, max: 0, distinctValues: null, countsForTiebreak: false, styleEnabled: false, styleMin: 0, styleMax: 0 };
	if (s.usedistinctscores) {
		const values = parseDistinct(s.distinctscores);
		if (values.length) {
			return { mode: 'DISTINCT', min: Math.min(...values), max: Math.max(...values), distinctValues: values.map((value) => ({ value })), countsForTiebreak: true, ...style };
		}
	}
	return { mode: 'RANGE', min: s.minscore, max: s.maxscore, distinctValues: null, countsForTiebreak: true, ...style };
}

/** "0,5, 10;20" → [0, 5, 10, 20] (sorted, unique, integers only). */
export function parseDistinct(csv: string | null): number[] {
	const nums = (csv ?? '')
		.split(/[,;\s]+/)
		.map((x) => x.trim())
		.filter((x) => /^-?\d+$/.test(x))
		.map(Number);
	return [...new Set(nums)].sort((a, b) => a - b);
}

/** An archived year: anyone still on the course or registered was simply never closed in gokapp. */
export function statusFromGokapp(s: GokappStatus | string | null): 'registered' | 'active' | 'finished' | 'resigned' {
	switch (s) {
		case 'FINISHED':
			return 'finished';
		case 'RESIGNED':
			return 'resigned';
		case 'ACTIVE':
			return 'active';
		default:
			return 'registered';
	}
}

/** The competition day: the date most scores were saved on (gokapp has no date setting). */
export function guessDate(saved: (Date | null)[], timeZone = 'Europe/Stockholm'): string | null {
	const fmt = new Intl.DateTimeFormat('sv-SE', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
	const counts = new Map<string, number>();
	for (const d of saved) if (d) counts.set(fmt.format(d), (counts.get(fmt.format(d)) ?? 0) + 1);
	return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
}

export interface OracleScore {
	patrolId: string;
	stationId: string;
	points: number;
	style: number;
}

/**
 * gokapp's ranking, ported line by line from Patrol.compareTo / getNumberOfXPoints:
 * total ↓ → points without style ↓ → count of max-score, then max−1, … (0..50), counting only
 * non-waypoint scores with points > 0. Returns a comparator for Array.sort (better first).
 * Exact ties compare as 0 (gokapp leaves them in arbitrary order; we give a shared place).
 */
export function gokappComparator(scores: OracleScore[], stations: Map<string, { max: number; waypoint: boolean }>) {
	const of = new Map<string, OracleScore[]>();
	for (const s of scores) of.set(s.patrolId, [...(of.get(s.patrolId) ?? []), s]);
	const list = (p: string) => of.get(p) ?? [];
	const total = (p: string) => list(p).reduce((a, s) => a + s.points + s.style, 0);
	const points = (p: string) => list(p).reduce((a, s) => a + s.points, 0);
	const nX = (p: string, x: number) =>
		list(p).filter((s) => {
			const st = stations.get(s.stationId);
			return !!st && !st.waypoint && st.max - x > 0 && s.points === st.max - x;
		}).length;
	return (a: string, b: string) => {
		let c = total(b) - total(a);
		if (c === 0) c = points(b) - points(a);
		if (c === 0)
			for (let i = 0; i <= 50; i++) {
				c = nX(b, i) - nX(a, i);
				if (c !== 0) break;
			}
		return c;
	};
}

/**
 * gokapp stores Java LocalDateTime: wall-clock time without a zone, as on the organisers' clocks.
 * "2023-09-22 18:40:48" in Swedish time → the right instant (DST-aware).
 */
export function fromWallClock(s: string, timeZone = 'Europe/Stockholm'): Date | null {
	const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(s);
	if (!m) return null;
	const [y, mo, d, h, mi, se] = m.slice(1).map((x) => Number(x ?? 0));
	const guess = Date.UTC(y, mo - 1, d, h, mi, se || 0);
	const offset = (t: number) => {
		const p = Object.fromEntries(
			new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
				.formatToParts(new Date(t))
				.map((x) => [x.type, x.value])
		);
		return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second)) - t;
	};
	let t = guess - offset(guess);
	t = guess - offset(t); // second pass settles DST changes
	return new Date(t);
}

/**
 * The competition days: Swedish dates that hold at least `minShare` of the score saves (a
 * correction made a week later does not make the competition a week long), first to last.
 */
export function competitionDays(saved: (Date | null)[], minShare = 0.03, timeZone = 'Europe/Stockholm'): string[] {
	const fmt = new Intl.DateTimeFormat('sv-SE', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
	const counts = new Map<string, number>();
	let n = 0;
	for (const d of saved) if (d) (counts.set(fmt.format(d), (counts.get(fmt.format(d)) ?? 0) + 1), n++);
	return [...counts].filter(([, c]) => c >= n * minShare).map(([d]) => d).sort();
}

/** Swedish date of an instant (for placing a station on a day). */
export const swedishDate = (d: Date, timeZone = 'Europe/Stockholm') =>
	new Intl.DateTimeFormat('sv-SE', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

/**
 * Competition statistics (pure, unit-tested). Used by the organiser's "Statistik" page and the
 * public statistics page; the server only loads rows and decides what is public.
 */

export interface Summary {
	n: number;
	min: number;
	max: number;
	mean: number;
	median: number;
	/** Population standard deviation. */
	sd: number;
}

/** min/max/mean/median/sd of a list, or null when it is empty. Mean, median and sd keep one decimal. */
export function summarize(values: number[]): Summary | null {
	if (values.length === 0) return null;
	const v = [...values].sort((a, b) => a - b);
	const n = v.length;
	const mean = v.reduce((s, x) => s + x, 0) / n;
	const median = n % 2 ? v[(n - 1) / 2] : (v[n / 2 - 1] + v[n / 2]) / 2;
	const sd = Math.sqrt(v.reduce((s, x) => s + (x - mean) ** 2, 0) / n);
	return { n, min: v[0], max: v[n - 1], mean: round1(mean), median: round1(median), sd: round1(sd) };
}

const round1 = (x: number) => Math.round(x * 10) / 10;

export interface Bucket {
	/** Inclusive range of points in the bucket. */
	from: number;
	to: number;
	count: number;
}

/**
 * Histogram over 0..max: one bucket per point up to 20 points (the usual 0–20 scale), otherwise
 * 10 equal-width buckets. Values outside the range are clamped (a lowered max keeps old scores).
 */
export function histogram(values: number[], max: number): Bucket[] {
	const top = Math.max(0, Math.ceil(max));
	const width = top <= 20 ? 1 : Math.ceil((top + 1) / 10);
	const buckets: Bucket[] = [];
	for (let from = 0; from <= top; from += width) buckets.push({ from, to: Math.min(top, from + width - 1), count: 0 });
	for (const x of values) {
		const i = Math.min(buckets.length - 1, Math.max(0, Math.floor(x / width)));
		buckets[i].count++;
	}
	return buckets;
}

export interface Visit {
	patrolId: string;
	stationId: string;
	/** Day of the station (null in a single-day competition). */
	dayId: string | null;
	at: Date;
}

export interface Leg {
	from: string;
	to: string;
	/** Minutes per patrol that walked this leg. */
	minutes: Summary;
}

export interface Times {
	/** Patrol-by-patrol order of visits → time from one station to the next, per station pair. */
	legs: Leg[];
	/** First to last visit per patrol and day, in minutes (null day = single-day). */
	course: { dayId: string | null; minutes: Summary }[];
}

/**
 * Times between stations from visit times. Per patrol and day the visits are put in time order;
 * each consecutive pair is a leg. Legs across days (overnight) are not counted. A patrol needs two
 * timed visits on a day to count for the course time.
 */
export function stationTimes(visits: Visit[]): Times {
	const byPatrolDay = new Map<string, Visit[]>();
	for (const v of visits) {
		const k = `${v.patrolId}|${v.dayId ?? ''}`;
		byPatrolDay.set(k, [...(byPatrolDay.get(k) ?? []), v]);
	}
	const legMinutes = new Map<string, number[]>();
	const courseMinutes = new Map<string | null, number[]>();
	for (const list of byPatrolDay.values()) {
		const seen = new Set<string>();
		const ordered = [...list].sort((a, b) => a.at.getTime() - b.at.getTime()).filter((v) => (seen.has(v.stationId) ? false : (seen.add(v.stationId), true)));
		for (let i = 1; i < ordered.length; i++) {
			const k = `${ordered[i - 1].stationId}|${ordered[i].stationId}`;
			legMinutes.set(k, [...(legMinutes.get(k) ?? []), minutesBetween(ordered[i - 1].at, ordered[i].at)]);
		}
		if (ordered.length >= 2) {
			const day = ordered[0].dayId;
			courseMinutes.set(day, [...(courseMinutes.get(day) ?? []), minutesBetween(ordered[0].at, ordered[ordered.length - 1].at)]);
		}
	}
	return {
		legs: [...legMinutes].map(([k, m]) => {
			const [from, to] = k.split('|');
			return { from, to, minutes: summarize(m)! };
		}),
		course: [...courseMinutes].map(([dayId, m]) => ({ dayId, minutes: summarize(m)! }))
	};
}

const minutesBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 60_000);

/** Counts per calendar date (YYYY-MM-DD in Swedish time) and the running total, oldest first. */
export function perDate(dates: Date[], timeZone = 'Europe/Stockholm'): { date: string; count: number; total: number }[] {
	const fmt = new Intl.DateTimeFormat('sv-SE', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
	const counts = new Map<string, number>();
	for (const d of dates) {
		const k = fmt.format(d);
		counts.set(k, (counts.get(k) ?? 0) + 1);
	}
	let total = 0;
	return [...counts.keys()].sort().map((date) => ({ date, count: counts.get(date)!, total: (total += counts.get(date)!) }));
}

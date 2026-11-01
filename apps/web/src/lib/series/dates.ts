/**
 * Date shifting for "Skapa <serie> <år+1>": whole years, keeping the weekday. GökOpen on
 * Saturday 15 May 2027 becomes Saturday 13 May 2028 (the Saturday nearest 15 May), so a weekend
 * competition stays on a weekend. Every date of an edition moves by the SAME number of days, so
 * multi-day competitions and registration windows keep their shape. Pure, UTC-only arithmetic.
 */

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

function toUtc(iso: string): number {
	const m = ISO.exec(iso);
	if (!m) throw new Error(`Not an ISO date: ${iso}`);
	return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

const fromUtc = (t: number) => new Date(t).toISOString().slice(0, 10);

export function addDays(iso: string, days: number): string {
	return fromUtc(toUtc(iso) + days * 86_400_000);
}

export const weekday = (iso: string) => new Date(toUtc(iso)).getUTCDay();

/** The same calendar date `years` later (29 Feb → 28 Feb in a non-leap year). */
export function sameDateInYear(iso: string, years: number): string {
	const m = ISO.exec(iso)!;
	const y = Number(m[1]) + years;
	const mo = Number(m[2]);
	let d = Number(m[3]);
	const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
	if (d > last) d = last;
	return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Days to add to every date of an edition: `years` later, on the same weekday, nearest the same calendar date (±3 days). */
export function editionShiftDays(startIso: string, years = 1): number {
	const target = sameDateInYear(startIso, years);
	let diff = (weekday(startIso) - weekday(target) + 7) % 7;
	if (diff > 3) diff -= 7;
	return Math.round((toUtc(target) - toUtc(startIso)) / 86_400_000) + diff;
}

/** Shifts a nullable date by `days`. */
export const shiftDate = (iso: string | null, days: number): string | null => (iso ? addDays(iso, days) : null);

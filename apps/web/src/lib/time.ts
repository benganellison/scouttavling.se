/**
 * Dates as the competition sees them. Competitions are Swedish: "today" and calendar dates are in
 * Europe/Stockholm regardless of the server's or the viewer's time zone. (Clock times shown on a
 * volunteer's phone use the phone's own time zone: see hhmm in #lib/field/app.svelte.ts.)
 */

export function todayIso(now = new Date()): string {
	return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function daysUntil(iso: string, now = new Date()): number {
	const a = Date.parse(`${todayIso(now)}T12:00:00Z`);
	const b = Date.parse(`${iso}T12:00:00Z`);
	return Math.round((b - a) / 86400_000);
}

/** URL slug from a competition name: "GökOpen 2027" → "gokopen-2027". */

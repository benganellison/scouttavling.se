export interface CodeDay {
	id: string;
	/** Prefix used in paper codes, e.g. "F" for Fredag. */
	prefix: string;
}

export interface CodeStation {
	id: string;
	dayId: string | null;
	order: number;
	name: string;
	/** Set when the organiser typed their own code. */
	customCode?: string | null;
	/**
	 * Explicit station role: 'start' / 'finish', or null for an ordinary station.
	 * Leave it undefined (not stored) to fall back to the name rule.
	 */
	role?: StationRole | null;
}

export type StationRole = 'start' | 'finish';

/** Fallback when no explicit role is set: "… start" → start, "… mål" → finish (case-insensitive). */
export function roleFromName(name: string): StationRole | null {
	const n = name.trim().toLowerCase();
	return n.endsWith('start') ? 'start' : n.endsWith('mål') ? 'finish' : null;
}

/**
 * Suggests paper codes for stations.
 * Single-day: K1, K2, … by order.
 * Multi-day: per day, a station with role start gets <prefix>S, role finish gets
 * <prefix>M and the rest are numbered: FS F1 F2 FM / LS L1 … LM. Without an
 * explicit role the name decides ("… start" / "… mål").
 * A custom code always wins, and numbering skips custom codes on the same day.
 */
export function stationCodes(stations: CodeStation[], days: CodeDay[]): Map<string, string> {
	const out = new Map<string, string>();
	const ordered = [...stations].sort((a, b) => a.order - b.order);
	if (days.length <= 1) {
		const taken = new Set(ordered.map((st) => st.customCode).filter(Boolean));
		const used = new Set<string>();
		ordered.forEach((s, i) => {
			let n = i + 1;
			while (!s.customCode && (taken.has(`K${n}`) || used.has(`K${n}`))) n++;
			const code = s.customCode || `K${n}`;
			used.add(code);
			out.set(s.id, code);
		});
		return out;
	}
	for (const day of days) {
		let n = 0;
		const mine = ordered.filter((st) => st.dayId === day.id);
		// Numbers skip codes someone typed by hand, so "L1" is never given out twice.
		const taken = new Set(mine.map((st) => st.customCode).filter(Boolean));
		for (const s of mine) {
			if (s.customCode) {
				out.set(s.id, s.customCode);
				continue;
			}
			const role = s.role !== undefined ? s.role : roleFromName(s.name);
			let code: string;
			if (role === 'start') code = `${day.prefix}S`;
			else if (role === 'finish') code = `${day.prefix}M`;
			else do code = `${day.prefix}${++n}`; while (taken.has(code));
			out.set(s.id, code);
		}
	}
	for (const s of ordered) if (!out.has(s.id)) out.set(s.id, s.customCode || '?');
	return out;
}

const SV_WEEKDAYS = ['Söndag', 'Måndag', 'Tisdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lördag'];

/** Days between two ISO dates (inclusive) with Swedish weekday names and default prefixes. */
export function daysBetween(fromIso: string, toIso: string): { date: string; name: string; prefix: string }[] {
	const out: { date: string; name: string; prefix: string }[] = [];
	const d = new Date(`${fromIso}T12:00:00Z`);
	const end = new Date(`${toIso}T12:00:00Z`);
	const used = new Set<string>();
	while (d <= end && out.length < 14) {
		const name = SV_WEEKDAYS[d.getUTCDay()];
		let prefix = name[0];
		if (used.has(prefix)) prefix = name.slice(0, 2);
		used.add(prefix);
		out.push({ date: d.toISOString().slice(0, 10), name, prefix });
		d.setUTCDate(d.getUTCDate() + 1);
	}
	return out;
}

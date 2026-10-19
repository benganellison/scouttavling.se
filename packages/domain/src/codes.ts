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
}

/**
 * Suggests paper codes for stations.
 * Single-day: K1, K2, … by order.
 * Multi-day: per day, a station named "… start" gets <prefix>S, "… mål" gets
 * <prefix>M and the rest are numbered: FS F1 F2 FM / LS L1 … LM.
 * A custom code always wins.
 */
export function stationCodes(stations: CodeStation[], days: CodeDay[]): Map<string, string> {
	const out = new Map<string, string>();
	const ordered = [...stations].sort((a, b) => a.order - b.order);
	if (days.length <= 1) {
		ordered.forEach((s, i) => out.set(s.id, s.customCode || `K${i + 1}`));
		return out;
	}
	for (const day of days) {
		let n = 0;
		for (const s of ordered.filter((st) => st.dayId === day.id)) {
			const name = s.name.trim().toLowerCase();
			const code = name.endsWith('start') ? `${day.prefix}S` : name.endsWith('mål') ? `${day.prefix}M` : `${day.prefix}${++n}`;
			out.set(s.id, s.customCode || code);
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

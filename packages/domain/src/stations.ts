/**
 * Editing a station (the organiser's "Kontroller" page): checks, the stored shape of an item, which
 * changes are refused once an item has scores, and the display order. Pure; the database side is in
 * apps/web/src/lib/server/stations.ts.
 */
import { MODE_TRAITS, type DistinctValue, type ItemMode } from './scoring.ts';

export interface ItemEdit {
	id?: string | null;
	name: string;
	mode: ItemMode;
	min: number;
	max: number;
	distinctValues: { value: number; label?: string }[];
	countMultiplier: number;
	styleEnabled: boolean;
	styleMin: number;
	styleMax: number;
	countsForTiebreak: boolean;
}

export interface StationEdit {
	id: string;
	name: string;
	customCode: string;
	dayId: string | null;
	/** The day's start / finish, null = ordinary. Absent = keep the stored role. */
	role?: 'start' | 'finish' | null;
	allTracks: boolean;
	trackIds: string[];
	startable: boolean;
	items: ItemEdit[];
}

export type FieldErrors = Record<string, string>;

/** A new station's item: 0–20 points with style. */
export const DEFAULT_ITEM = { mode: 'RANGE', min: 0, max: 20, styleEnabled: true, countsForTiebreak: true } as const;
/** A start / finish / rest stop: a check-in, no points. */
export const CHECKPOINT_ITEM = { mode: 'CHECKIN', min: 0, max: 0, styleEnabled: false, countsForTiebreak: false } as const;

/** Checks of an edited station; field-keyed Swedish messages (items.<i>.<field> for items). */
export function validateStation(s: StationEdit, ctx: { dayIds: string[]; trackIds: string[]; multiDay: boolean }): FieldErrors {
	const e: FieldErrors = {};
	const name = s.name.trim();
	if (!name) e.name = 'Kontrollen behöver ett namn.';
	else if (name.length > 60) e.name = 'Högst 60 tecken.';
	const code = s.customCode.trim().toUpperCase();
	if (code && !/^[A-ZÅÄÖ0-9]{1,6}$/.test(code)) e.customCode = 'Koden får bara ha bokstäver och siffror (högst 6).';
	if (ctx.multiDay && (!s.dayId || !ctx.dayIds.includes(s.dayId))) e.dayId = 'Välj vilken dag kontrollen är.';
	if (!s.allTracks) {
		if (s.trackIds.length === 0) e.tracks = 'Välj minst en klass, eller "Alla klasser".';
		else if (s.trackIds.some((t) => !ctx.trackIds.includes(t))) e.tracks = 'Okänd klass.';
	}
	if (s.items.length === 0) e.items = 'En kontroll behöver minst en del.';
	if (s.items.length > 12) e.items = 'Högst 12 delar per kontroll.';
	s.items.forEach((it, i) => {
		const k = `items.${i}`;
		const t = MODE_TRAITS[it.mode];
		if (!it.name.trim()) e[`${k}.name`] = 'Delen behöver ett namn.';
		else if (it.name.trim().length > 60) e[`${k}.name`] = 'Högst 60 tecken.';
		if (t.usesRange) {
			if (it.min < 0 || it.max > 1000) e[`${k}.range`] = 'Värdena måste ligga mellan 0 och 1000.';
			else if (it.min >= it.max) e[`${k}.range`] = 'Högsta måste vara större än lägsta.';
			else if (it.max - it.min > 100) e[`${k}.range`] = 'Högst 100 steg mellan lägsta och högsta.';
		}
		if (t.usesMultiplier && (it.countMultiplier < 1 || it.countMultiplier > 100)) e[`${k}.mult`] = 'Multiplikatorn måste vara 1–100.';
		if (t.usesDistinct) {
			const vals = it.distinctValues.map((d) => d.value);
			if (vals.length === 0) e[`${k}.distinct`] = 'Lägg till minst ett värde.';
			else if (new Set(vals).size !== vals.length) e[`${k}.distinct`] = 'Samma värde finns två gånger.';
			else if (vals.some((x) => x < 0 || x > 1000)) e[`${k}.distinct`] = 'Värdena måste ligga mellan 0 och 1000.';
			else if (it.distinctValues.some((d) => (d.label ?? '').length > 40)) e[`${k}.distinct`] = 'En etikett får vara högst 40 tecken.';
		}
		if (t.takesValue && it.styleEnabled) {
			if (it.styleMin < 0 || it.styleMax > 20) e[`${k}.style`] = 'Stilpoäng måste ligga mellan 0 och 20.';
			else if (it.styleMin >= it.styleMax) e[`${k}.style`] = 'Högsta stilpoäng måste vara större än lägsta.';
		}
	});
	return e;
}

export interface StoredItem {
	name: string;
	mode: ItemMode;
	min: number;
	max: number;
	distinctValues: DistinctValue[] | null;
	countMultiplier: number | null;
	styleEnabled: boolean;
	styleMin: number;
	styleMax: number;
	countsForTiebreak: boolean;
}

/** An edited item as stored: fields the mode does not use are reset, distinct values sorted. */
export function normaliseItem(it: ItemEdit): StoredItem {
	const t = MODE_TRAITS[it.mode];
	const values = [...it.distinctValues]
		.map((d) => ({ value: d.value, ...(d.label?.trim() ? { label: d.label.trim() } : {}) }))
		.sort((a, b) => a.value - b.value);
	return {
		name: it.name.trim(),
		mode: it.mode,
		min: t.usesRange ? it.min : t.usesDistinct ? Math.min(...values.map((d) => d.value)) : 0,
		max: t.usesRange ? it.max : t.usesDistinct ? Math.max(...values.map((d) => d.value)) : 0,
		distinctValues: t.usesDistinct ? values : null,
		countMultiplier: t.usesMultiplier ? it.countMultiplier : null,
		styleEnabled: t.takesValue && it.styleEnabled,
		styleMin: it.styleMin,
		styleMax: it.styleMax,
		countsForTiebreak: t.takesValue && it.countsForTiebreak
	};
}

/**
 * Stored points were evaluated under the item's rules when they were saved. A change that would make
 * them wrong or invalid is refused while the item has scores: another mode, multiplier or value set,
 * or a narrower range. Name, labels, style and a wider range are fine.
 */
export function scoringChangeLocked(
	old: Pick<StoredItem, 'mode' | 'min' | 'max' | 'distinctValues' | 'countMultiplier'>,
	next: Pick<StoredItem, 'mode' | 'min' | 'max' | 'distinctValues' | 'countMultiplier'>
): boolean {
	const values = (x: { distinctValues: { value: number }[] | null }) => (x.distinctValues ?? []).map((d) => d.value).join(',');
	return (
		next.mode !== old.mode ||
		(next.countMultiplier ?? null) !== (old.countMultiplier ?? null) ||
		values(next) !== values(old) ||
		next.min > old.min ||
		next.max < old.max
	);
}

/** Stations in display order: by day (in the days' order), then by position. */
export function displayOrder<S extends { dayId: string | null; sort: number }>(stations: readonly S[], days: readonly { id: string }[]): S[] {
	if (days.length <= 1) return [...stations].sort((a, b) => a.sort - b.sort);
	const dayIdx = new Map(days.map((d, i) => [d.id, i]));
	return [...stations].sort((a, b) => (dayIdx.get(a.dayId ?? '') ?? 99) - (dayIdx.get(b.dayId ?? '') ?? 99) || a.sort - b.sort);
}

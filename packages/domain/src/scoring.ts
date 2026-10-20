/**
 * How a single score item is reported. A station has one or more items; a
 * "kontrollgrupp" such as Mål is simply a station with several items.
 */
export type ItemMode = 'RANGE' | 'DISTINCT' | 'COUNT' | 'CHECKIN' | 'AUTO_ON_SCAN';

export interface DistinctValue {
	value: number;
	label?: string;
}

export interface ScoreItemDef {
	id: string;
	name: string;
	mode: ItemMode;
	/** RANGE: inclusive bounds. COUNT: bounds of the counted quantity. */
	min: number;
	max: number;
	/** DISTINCT: the only allowed point values. */
	distinctValues?: DistinctValue[];
	/** COUNT: points = count × multiplier. */
	countMultiplier?: number;
	styleEnabled: boolean;
	styleMin: number;
	styleMax: number;
	/** Checkpoints and auto items never count toward the max-score tiebreak. */
	countsForTiebreak: boolean;
}

export interface RawEntry {
	/** RANGE/DISTINCT: points. COUNT: the counted quantity. CHECKIN/AUTO: ignored. */
	value: number;
	style?: number | null;
}

export interface ScoredValue {
	points: number;
	stylePoints: number;
}

export class InvalidScoreError extends Error {}

/** Distinct values sorted ascending, deduplicated. */
export function distinctList(item: ScoreItemDef): number[] {
	return [...new Set((item.distinctValues ?? []).map((d) => d.value))].sort((a, b) => a - b);
}

/** The values a volunteer can pick for an item, in display order (ascending). */
export function selectableValues(item: ScoreItemDef): number[] {
	switch (item.mode) {
		case 'RANGE':
		case 'COUNT':
			return range(item.min, item.max);
		case 'DISTINCT':
			return distinctList(item);
		default:
			return [];
	}
}

export function styleValues(item: ScoreItemDef): number[] {
	return item.styleEnabled ? range(item.styleMin, item.styleMax) : [];
}

/**
 * Turns what the volunteer entered into stored points, rejecting anything the
 * UI would never offer (server-side gate against tampered commands).
 */
export function evaluate(item: ScoreItemDef, raw: RawEntry): ScoredValue {
	const style = item.styleEnabled ? (raw.style ?? null) : 0;
	if (item.styleEnabled) {
		if (style === null || !Number.isInteger(style) || style < item.styleMin || style > item.styleMax) {
			throw new InvalidScoreError(`Stilpoäng måste vara ${item.styleMin}–${item.styleMax}`);
		}
	}
	const stylePoints = style ?? 0;
	switch (item.mode) {
		case 'RANGE':
			assertInt(raw.value, item.min, item.max);
			return { points: raw.value, stylePoints };
		case 'DISTINCT':
			if (!distinctList(item).includes(raw.value)) {
				throw new InvalidScoreError(`Tillåtna poäng: ${distinctList(item).join(', ')}`);
			}
			return { points: raw.value, stylePoints };
		case 'COUNT':
			assertInt(raw.value, item.min, item.max);
			return { points: raw.value * (item.countMultiplier ?? 1), stylePoints };
		case 'CHECKIN':
		case 'AUTO_ON_SCAN':
			return { points: 0, stylePoints: 0 };
	}
}

/**
 * How many achievable values rank above `points` at this item: 0 for the top
 * value, 1 for the next best… Generalises gokapp's Station.rankOfScore so that
 * a 0/5/10/15/20 item and a 0–20 item compare fairly in the tiebreak.
 * Returns -1 when the item does not take part in the tiebreak.
 */
export function rankOfValue(item: ScoreItemDef, points: number): number {
	if (!item.countsForTiebreak) return -1;
	switch (item.mode) {
		case 'RANGE':
			return item.max - points;
		case 'DISTINCT': {
			const values = distinctList(item);
			const idx = values.indexOf(points);
			return idx < 0 ? -1 : values.length - 1 - idx;
		}
		case 'COUNT': {
			const mult = item.countMultiplier ?? 1;
			return item.max - Math.round(points / mult);
		}
		default:
			return -1;
	}
}

export function maxPoints(item: ScoreItemDef): number {
	switch (item.mode) {
		case 'RANGE':
			return item.max;
		case 'DISTINCT':
			return Math.max(0, ...distinctList(item));
		case 'COUNT':
			return item.max * (item.countMultiplier ?? 1);
		default:
			return 0;
	}
}

function assertInt(v: number, min: number, max: number) {
	if (!Number.isInteger(v) || v < min || v > max) {
		throw new InvalidScoreError(`Poäng måste vara ${min}–${max}`);
	}
}

export function range(min: number, max: number): number[] {
	const out: number[] = [];
	for (let i = min; i <= max; i++) out.push(i);
	return out;
}

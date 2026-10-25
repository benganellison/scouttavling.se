import { describe, expect, it } from 'vitest';
import { addDays, editionShiftDays, sameDateInYear, shiftDate, weekday } from './dates.ts';

describe('editionShiftDays', () => {
	it('keeps the weekday, nearest the same date a year later', () => {
		// Sat 15 May 2027 → Sat 13 May 2028 (15 May 2028 is a Monday).
		const d = editionShiftDays('2027-05-15');
		expect(addDays('2027-05-15', d)).toBe('2028-05-13');
		expect(weekday('2028-05-13')).toBe(weekday('2027-05-15'));
	});
	it('is 364 days when the next year lands one weekday later', () => {
		// Sat 16 May 2026 → Sat 15 May 2027.
		expect(editionShiftDays('2026-05-16')).toBe(364);
	});
	it('handles leap days', () => {
		expect(sameDateInYear('2028-02-29', 1)).toBe('2029-02-28');
		const d = editionShiftDays('2028-02-29');
		expect(weekday(addDays('2028-02-29', d))).toBe(weekday('2028-02-29'));
		expect(Math.abs(d - 365)).toBeLessThanOrEqual(3);
	});
	it('always moves within ±3 days of the calendar date, same weekday, for many dates', () => {
		for (let i = 0; i < 800; i++) {
			const src = addDays('2025-01-01', i);
			for (const years of [1, 2]) {
				const d = editionShiftDays(src, years);
				const out = addDays(src, d);
				expect(weekday(out)).toBe(weekday(src));
				const cal = sameDateInYear(src, years);
				expect(Math.abs((Date.parse(out) - Date.parse(cal)) / 86_400_000)).toBeLessThanOrEqual(3);
			}
		}
	});
	it('moves a multi-day edition as one block (Fri–Sun stays Fri–Sun)', () => {
		const d = editionShiftDays('2027-05-14');
		expect(['2027-05-14', '2027-05-15', '2027-05-16'].map((x) => addDays(x, d))).toEqual(['2028-05-12', '2028-05-13', '2028-05-14']);
	});
	it('crosses year ends and keeps nulls', () => {
		expect(addDays('2027-12-30', 5)).toBe('2028-01-04');
		expect(shiftDate(null, 10)).toBeNull();
	});
});

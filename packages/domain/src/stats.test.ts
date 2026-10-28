import { describe, expect, it } from 'vitest';
import { histogram, perDate, stationTimes, summarize } from './stats.ts';

describe('summarize', () => {
	it('gives min, max, mean, median and sd', () => {
		expect(summarize([12, 18, 15, 20, 15])).toEqual({ n: 5, min: 12, max: 20, mean: 16, median: 15, sd: 2.8 });
	});
	it('takes the middle of the two middle values for an even count', () => {
		expect(summarize([10, 20, 11, 19])!.median).toBe(15);
	});
	it('is null for no values', () => {
		expect(summarize([])).toBeNull();
	});
});

describe('histogram', () => {
	it('has one bucket per point on a 0–20 scale', () => {
		const h = histogram([0, 20, 20, 7], 20);
		expect(h).toHaveLength(21);
		expect(h[20]).toEqual({ from: 20, to: 20, count: 2 });
		expect(h[7].count).toBe(1);
	});
	it('groups into 10 buckets above 20 points, clamping values outside the range', () => {
		const h = histogram([0, 5, 59, 60, 75], 60);
		expect(h.map((b) => [b.from, b.to])).toEqual([
			[0, 6],
			[7, 13],
			[14, 20],
			[21, 27],
			[28, 34],
			[35, 41],
			[42, 48],
			[49, 55],
			[56, 60]
		]);
		expect(h[0].count).toBe(2);
		expect(h.at(-1)!.count).toBe(3);
	});
});

describe('stationTimes', () => {
	const t = (hhmm: string, day = '2027-05-15') => new Date(`${day}T${hhmm}:00+02:00`);
	it('measures each leg in visit order, per patrol, and the time on course', () => {
		const times = stationTimes([
			{ patrolId: 'a', stationId: 'K1', dayId: null, at: t('10:00') },
			{ patrolId: 'a', stationId: 'K2', dayId: null, at: t('10:25') },
			{ patrolId: 'a', stationId: 'K3', dayId: null, at: t('11:05') },
			// b walks the other way; K2→K1 is its own leg.
			{ patrolId: 'b', stationId: 'K2', dayId: null, at: t('10:05') },
			{ patrolId: 'b', stationId: 'K1', dayId: null, at: t('10:35') },
			{ patrolId: 'c', stationId: 'K1', dayId: null, at: t('10:10') },
			{ patrolId: 'c', stationId: 'K2', dayId: null, at: t('10:45') }
		]);
		const leg = (from: string, to: string) => times.legs.find((l) => l.from === from && l.to === to)?.minutes;
		expect(leg('K1', 'K2')).toMatchObject({ n: 2, min: 25, max: 35, median: 30 });
		expect(leg('K2', 'K1')).toMatchObject({ n: 1, median: 30 });
		expect(leg('K2', 'K3')).toMatchObject({ n: 1, median: 40 });
		expect(times.course).toEqual([{ dayId: null, minutes: { n: 3, min: 30, max: 65, mean: 43.3, median: 35, sd: 15.5 } }]);
	});
	it('does not count the night between days as a leg', () => {
		const times = stationTimes([
			{ patrolId: 'a', stationId: 'FM', dayId: 'fre', at: t('21:00', '2027-05-14') },
			{ patrolId: 'a', stationId: 'LS', dayId: 'lor', at: t('08:00', '2027-05-15') },
			{ patrolId: 'a', stationId: 'L1', dayId: 'lor', at: t('08:40', '2027-05-15') }
		]);
		expect(times.legs.map((l) => `${l.from}→${l.to}`)).toEqual(['LS→L1']);
		expect(times.course).toEqual([{ dayId: 'lor', minutes: expect.objectContaining({ n: 1, median: 40 }) }]);
	});
});

describe('perDate', () => {
	it('counts per Swedish calendar date with a running total', () => {
		const d = (iso: string) => new Date(iso);
		// 23:30 UTC on 1 March is already 2 March in Sweden.
		expect(perDate([d('2027-03-01T10:00:00Z'), d('2027-03-01T23:30:00Z'), d('2027-03-02T08:00:00Z'), d('2027-02-20T12:00:00Z')])).toEqual([
			{ date: '2027-02-20', count: 1, total: 1 },
			{ date: '2027-03-01', count: 1, total: 2 },
			{ date: '2027-03-02', count: 2, total: 4 }
		]);
	});
});

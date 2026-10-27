import { describe, expect, it } from 'vitest';
import { competitionDays, fromWallClock, guessDate, itemFromStation, parseDistinct, statusFromGokapp, type GokappStation } from './gokapp.ts';

const st = (o: Partial<GokappStation>): GokappStation => ({
	id: 1, stationnumber: 1, stationname: 'K', alltracks: true, minscore: 0, maxscore: 20, minstylescore: 0, maxstylescore: 5,
	waypoint: false, usedistinctscores: false, distinctscores: null, ...o
});

describe('gokapp import mapping', () => {
	it('maps an ordinary station to RANGE with style', () => {
		expect(itemFromStation(st({}))).toEqual({ mode: 'RANGE', min: 0, max: 20, distinctValues: null, countsForTiebreak: true, styleEnabled: true, styleMin: 0, styleMax: 5 });
	});
	it('maps distinct scores, a waypoint and no style', () => {
		expect(itemFromStation(st({ usedistinctscores: true, distinctscores: '20, 0,10;10', maxstylescore: 0 }))).toMatchObject({
			mode: 'DISTINCT', min: 0, max: 20, distinctValues: [{ value: 0 }, { value: 10 }, { value: 20 }], styleEnabled: false
		});
		expect(itemFromStation(st({ waypoint: true }))).toMatchObject({ mode: 'CHECKIN', countsForTiebreak: false, styleEnabled: false });
		// "Distinct" switched on without values falls back to the range.
		expect(itemFromStation(st({ usedistinctscores: true, distinctscores: ' ' })).mode).toBe('RANGE');
	});
	it('parses distinct CSVs leniently', () => {
		expect(parseDistinct('5,x, 15 ,5')).toEqual([5, 15]);
		expect(parseDistinct(null)).toEqual([]);
	});
	it('maps statuses', () => {
		expect(['REGISTERED', 'ACTIVE', 'FINISHED', 'RESIGNED', null].map(statusFromGokapp)).toEqual(['registered', 'active', 'finished', 'resigned', 'registered']);
	});
	it('guesses the competition date from save times (Swedish date)', () => {
		const d = (iso: string) => new Date(iso);
		expect(guessDate([d('2023-05-13T08:00:00Z'), d('2023-05-13T21:00:00Z'), d('2023-05-14T09:00:00Z'), null])).toBe('2023-05-13');
		expect(guessDate([])).toBeNull();
	});
	it('reads gokapp wall-clock times as Swedish time, summer and winter', () => {
		expect(fromWallClock('2023-09-22 23:16:25')!.toISOString()).toBe('2023-09-22T21:16:25.000Z');
		expect(fromWallClock('2023-01-14 08:00:00')!.toISOString()).toBe('2023-01-14T07:00:00.000Z');
		expect(fromWallClock('not a date')).toBeNull();
	});
	it('finds the competition days, ignoring a stray late correction', () => {
		const at = (s: string) => fromWallClock(s);
		const saves = [
			...Array.from({ length: 30 }, () => at('2023-09-22 20:00:00')),
			...Array.from({ length: 80 }, () => at('2023-09-23 10:00:00')),
			at('2023-09-22 23:59:00'),
			at('2023-10-02 18:00:00')
		];
		expect(competitionDays(saves)).toEqual(['2023-09-22', '2023-09-23']);
	});
});


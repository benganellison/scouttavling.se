import { describe, expect, it } from 'vitest';
import { displayOrder, normaliseItem, scoringChangeLocked, validateStation, type ItemEdit, type StationEdit } from './index.ts';

const item = (o: Partial<ItemEdit> = {}): ItemEdit => ({
	name: 'Kontroll',
	mode: 'RANGE',
	min: 0,
	max: 20,
	distinctValues: [],
	countMultiplier: 1,
	styleEnabled: true,
	styleMin: 0,
	styleMax: 5,
	countsForTiebreak: true,
	...o
});
const station = (o: Partial<StationEdit> = {}): StationEdit => ({
	id: 's',
	name: 'Kontroll 1',
	customCode: '',
	dayId: null,
	allTracks: true,
	trackIds: [],
	startable: true,
	items: [item()],
	...o
});
const ctx = { dayIds: [], trackIds: ['t1'], multiDay: false };

describe('validateStation', () => {
	it('accepts an ordinary station', () => {
		expect(validateStation(station(), ctx)).toEqual({});
	});
	it('keys item errors by position and field', () => {
		const e = validateStation(
			station({ items: [item(), item({ mode: 'DISTINCT', distinctValues: [{ value: 5 }, { value: 5 }] }), item({ mode: 'COUNT', countMultiplier: 0 })] }),
			ctx
		);
		expect(e).toEqual({ 'items.1.distinct': 'Samma värde finns två gånger.', 'items.2.mult': 'Multiplikatorn måste vara 1–100.' });
	});
	it('needs a day on a multi-day competition and known classes', () => {
		expect(validateStation(station({ allTracks: false, trackIds: ['x'] }), { ...ctx, multiDay: true, dayIds: ['d1'] })).toMatchObject({
			dayId: expect.any(String),
			tracks: 'Okänd klass.'
		});
	});
});

describe('normaliseItem', () => {
	it('resets what the mode does not use and sorts distinct values', () => {
		expect(normaliseItem(item({ mode: 'DISTINCT', distinctValues: [{ value: 10, label: ' Bra ' }, { value: 0 }], countMultiplier: 3 }))).toMatchObject({
			min: 0,
			max: 10,
			distinctValues: [{ value: 0 }, { value: 10, label: 'Bra' }],
			countMultiplier: null
		});
		expect(normaliseItem(item({ mode: 'CHECKIN', styleEnabled: true, countsForTiebreak: true }))).toMatchObject({
			min: 0,
			max: 0,
			styleEnabled: false,
			countsForTiebreak: false
		});
	});
});

describe('scoringChangeLocked (an item that has scores)', () => {
	const old = normaliseItem(item());
	it('allows a wider range, a new name and style', () => {
		expect(scoringChangeLocked(old, normaliseItem(item({ max: 25, name: 'Nytt namn', styleEnabled: false })))).toBe(false);
	});
	it('refuses another mode, a narrower range or another multiplier', () => {
		expect(scoringChangeLocked(old, normaliseItem(item({ mode: 'COUNT' })))).toBe(true);
		expect(scoringChangeLocked(old, normaliseItem(item({ max: 15 })))).toBe(true);
		const count = normaliseItem(item({ mode: 'COUNT', countMultiplier: 2 }));
		expect(scoringChangeLocked(count, normaliseItem(item({ mode: 'COUNT', countMultiplier: 3 })))).toBe(true);
	});
});

describe('displayOrder', () => {
	it('orders by day, then position', () => {
		const s = [
			{ id: 'l1', dayId: 'lor', sort: 1 },
			{ id: 'f2', dayId: 'fre', sort: 3 },
			{ id: 'f1', dayId: 'fre', sort: 2 }
		];
		expect(displayOrder(s, [{ id: 'fre' }, { id: 'lor' }]).map((x) => x.id)).toEqual(['f1', 'f2', 'l1']);
	});
});

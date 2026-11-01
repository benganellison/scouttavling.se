import { describe, expect, it } from 'vitest';
import { ITEM_MODES, isCheckpointOnly, isScorable, scorableItems } from './index.ts';

describe('item mode traits', () => {
	it('every mode has traits, and only RANGE/DISTINCT/COUNT take a value', () => {
		expect(ITEM_MODES.filter(isScorable)).toEqual(['RANGE', 'DISTINCT', 'COUNT']);
	});
	it('a station with only check-ins (CHECKIN or AUTO_ON_SCAN) is checkpoint-only; an empty one is not', () => {
		expect(isCheckpointOnly([{ mode: 'AUTO_ON_SCAN' }])).toBe(true);
		expect(isCheckpointOnly([{ mode: 'CHECKIN' }, { mode: 'AUTO_ON_SCAN' }])).toBe(true);
		expect(isCheckpointOnly([{ mode: 'CHECKIN' }, { mode: 'RANGE' }])).toBe(false);
		expect(isCheckpointOnly([])).toBe(false);
	});
	it('scorableItems keeps the order', () => {
		const items = [
			{ mode: 'CHECKIN' as const, n: 1 },
			{ mode: 'COUNT' as const, n: 2 },
			{ mode: 'AUTO_ON_SCAN' as const, n: 3 },
			{ mode: 'RANGE' as const, n: 4 }
		];
		expect(scorableItems(items).map((i) => i.n)).toEqual([2, 4]);
	});
});

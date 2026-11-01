import { describe, expect, it } from 'vitest';
import { editionSlug, stripYear, yearIn } from './names.ts';

describe('series names', () => {
	it('strips the year but never empties a name', () => {
		expect(stripYear('GökOpen 2027')).toBe('GökOpen');
		expect(stripYear('Hajk 2027 i skogen')).toBe('Hajk i skogen');
		expect(stripYear('2027')).toBe('2027');
	});
	it('finds the year', () => {
		expect(yearIn('GökOpen 2027')).toBe(2027);
		expect(yearIn('GökOpen')).toBeNull();
	});
	it('gives the edition the year only when its address would equal the series address', () => {
		expect(editionSlug('gokopen', 'gokopen', 2027)).toBe('gokopen-2027');
		expect(editionSlug('gokopen-2027', 'gokopen', 2027)).toBe('gokopen-2027');
		expect(editionSlug('gokopen', 'gokopen', null)).toBe('gokopen');
	});
});

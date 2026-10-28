import { describe, expect, it, vi } from 'vitest';

vi.mock('./db', () => ({ db: {}, schema: {} }));
const { safeNext } = await import('./auth.ts');

describe('safeNext (open-redirect guard)', () => {
	it('keeps same-origin paths with query and hash', () => {
		expect(safeNext('/admin/gokopen-2027/settings?x=1#utseende')).toBe('/admin/gokopen-2027/settings?x=1#utseende');
		expect(safeNext('/t/gokopen')).toBe('/t/gokopen');
	});
	it('refuses everything that a browser would send to another site', () => {
		for (const bad of [
			'//evil.example',
			'/\\evil.example',
			'/\t/evil.example',
			'/\n/evil.example',
			'/%09/evil.example'.replace('%09', '\t'),
			'https://evil.example',
			'evil.example',
			'/\r\n//evil',
			'\\\\evil',
			''
		]) {
			const r = safeNext(bad);
			expect(r, JSON.stringify(bad)).toBe('/admin');
			expect(new URL(r, 'https://scouttavling.se').origin).toBe('https://scouttavling.se');
		}
		expect(safeNext(null)).toBe('/admin');
		expect(safeNext('//evil', '/')).toBe('/');
	});
});

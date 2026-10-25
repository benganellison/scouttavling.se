import { describe, expect, it } from 'vitest';
import { PALETTE, SCOUTBLA, contrast, namedTrackColor, parseHex, readableText, textOk, trackColors } from './colors.ts';

describe('contrast', () => {
	it('matches known WCAG values', () => {
		expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
		expect(contrast(SCOUTBLA, '#ffffff')).toBeCloseTo(12.38, 1);
		expect(contrast('#ffffff', '#ffffff')).toBe(1);
	});
	it('rates the profile colours as text on white the way the manual does (large text)', () => {
		expect(textOk(SCOUTBLA)).toBe(true);
		expect(textOk('#41a62a')).toBe(false); // Spårargrön: large only
		expect(textOk('#41a62a', '#ffffff', true)).toBe(true);
		expect(textOk('#e95f13', '#ffffff', true)).toBe(true); // Äventyrarorange: large only
		expect(textOk('#e95f13')).toBe(false);
		expect(textOk('#00a8e1', '#ffffff', true)).toBe(false); // Upptäckarblå: never
		expect(textOk('#e2e000', '#ffffff', true)).toBe(false); // Rovergul: never
	});
});

describe('readableText', () => {
	it('picks white on dark and black on light', () => {
		expect(readableText(SCOUTBLA).text).toBe('#ffffff');
		expect(readableText('#e2e000').text).toBe('#000000');
		expect(readableText('#e95f13').text).toBe('#000000');
		expect(readableText('#00a8e1').text).toBe('#000000');
	});
	it('returns null (decoration only) when neither black nor white reaches 4.5:1', () => {
		// Mid grey: the best of black/white is ~4.7:1, so a 7:1 (AAA) requirement fails.
		const r = readableText('#777777', 7);
		expect(r.text).toBeNull();
		expect(r.ratio).toBeLessThan(7);
		// With AA the better of black/white always reaches 4.5:1 (minimum is ~4.58:1).
		for (let v = 0; v < 256; v += 5) {
			const h = `#${v.toString(16).padStart(2, '0').repeat(3)}`;
			expect(readableText(h).text).not.toBeNull();
		}
		expect(readableText('#41a62a').text).toBe('#000000'); // 7.2:1 with black
	});
	it('every palette swatch has a readable text colour', () => {
		for (const p of PALETTE) expect(readableText(p.hex).ratio).toBeGreaterThanOrEqual(4.5);
	});
});

describe('parseHex', () => {
	it('normalises and rejects', () => {
		expect(parseHex('#ABC')).toBe('#aabbcc');
		expect(parseHex('003660')).toBe('#003660');
		expect(parseHex('red')).toBeNull();
		expect(parseHex('#12345')).toBeNull();
		expect(parseHex('url(x)')).toBeNull();
		expect(parseHex(null)).toBeNull();
	});
});

describe('class colours', () => {
	const t = (name: string, color: string | null = null) => ({ id: name, name, color });
	it('maps age groups and Ledare by name', () => {
		expect(namedTrackColor('Spårare')).toBe('#41a62a');
		expect(namedTrackColor('Upptäckare')).toBe('#00a8e1');
		expect(namedTrackColor('Äventyrare')).toBe('#e95f13');
		expect(namedTrackColor('Utmanare')).toBe('#da005e');
		expect(namedTrackColor('Rover')).toBe('#e2e000');
		expect(namedTrackColor('Ledare')).toBe(SCOUTBLA);
		expect(namedTrackColor('ledarklass')).toBe(SCOUTBLA);
		expect(namedTrackColor('Öppen klass')).toBeNull();
	});
	it('keeps explicit colours and gives every default a distinct colour', () => {
		const tracks = [t('Upptäckare'), t('Äventyrare'), t('Ledare'), t('Öppen'), t('Familj'), t('Mix', '#e95f13'), ...Array.from({ length: 14 }, (_, i) => t(`Klass ${i}`))];
		const c = trackColors(tracks);
		expect(c.Mix).toBe('#e95f13');
		expect(c['Upptäckare']).toBe('#00a8e1');
		expect(c.Ledare).toBe(SCOUTBLA);
		// Äventyrare's name colour is taken explicitly by Mix, so it gets another one.
		expect(c['Äventyrare']).not.toBe('#e95f13');
		const defaults = tracks.filter((x) => !x.color).map((x) => c[x.id]);
		expect(new Set(defaults).size).toBe(defaults.length);
		expect(defaults.every((h) => parseHex(h) === h)).toBe(true);
	});
	it('two classes with the same age-group stem do not share a default', () => {
		const c = trackColors([t('Spårare A'), t('Spårare B')]);
		expect(c['Spårare A']).toBe('#41a62a');
		expect(c['Spårare B']).not.toBe('#41a62a');
	});
	it('is deterministic', () => {
		const tracks = [t('X'), t('Y'), t('Z')];
		expect(trackColors(tracks)).toEqual(trackColors(tracks));
	});
});

import { describe, expect, it } from 'vitest';
import { resolveBranding, type AssetMeta } from './branding.ts';
import { SCOUTBLA, templateColor, trackColors } from './colors.ts';

const img = (id: string, kind: AssetMeta['kind'], width = 400, height = 100): AssetMeta => ({ id, kind, width, height });
const edition = (o: Partial<{ accentColor: string | null; coverFit: 'contain' | 'cover' | null; assets: AssetMeta[] }> = {}) => ({
	name: 'GökOpen 2027', ownerGroupName: 'Granlidens scoutkår', accentColor: null, coverFit: null, assets: [], ...o
});
const series = (o: Partial<{ accentColor: string | null; coverFit: 'contain' | 'cover' | null; assets: AssetMeta[] }> = {}) => ({
	name: 'GökOpen', slug: 'gokopen', accentColor: null, coverFit: null, assets: [], ...o
});

describe('resolveBranding', () => {
	it('falls back to the Scouterna base without series or overrides', () => {
		const b = resolveBranding(edition(), null);
		expect(b.accent).toBe(SCOUTBLA);
		expect(b.customAccent).toBe(false);
		expect(b.eventLogo).toBeNull();
		expect(b.sources).toEqual({ accent: 'base', coverFit: 'base', eventLogo: 'base', organiserLogo: 'base', cover: 'base' });
		expect(b.inherited).toBeNull();
	});
	it('inherits every part from the series', () => {
		const b = resolveBranding(edition(), series({ accentColor: '#00a8e1', coverFit: 'cover', assets: [img('s1', 'event_logo'), img('s2', 'cover')] }));
		expect(b.accent).toBe('#00a8e1');
		expect(b.coverFit).toBe('cover');
		expect(b.eventLogo?.url).toBe('/media/s1');
		expect(b.cover?.url).toBe('/media/s2');
		expect(b.organiserLogo).toBeNull();
		expect(b.sources).toMatchObject({ accent: 'series', coverFit: 'series', eventLogo: 'series', cover: 'series', organiserLogo: 'base' });
		expect(b.eventName).toBe('GökOpen 2027');
		expect(b.inherited).toMatchObject({ seriesSlug: 'gokopen', accent: '#00a8e1' });
	});
	it('lets the edition override part by part', () => {
		const b = resolveBranding(
			edition({ accentColor: '#e95f13', assets: [img('e1', 'cover', 3000, 600)] }),
			series({ accentColor: '#00a8e1', coverFit: 'cover', assets: [img('s1', 'event_logo'), img('s2', 'cover')] })
		);
		expect(b.accent).toBe('#e95f13');
		expect(b.cover?.url).toBe('/media/e1');
		expect(b.eventLogo?.url).toBe('/media/s1');
		expect(b.sources).toMatchObject({ accent: 'edition', cover: 'edition', eventLogo: 'series', coverFit: 'series' });
	});
	it('ignores an invalid stored colour', () => {
		expect(resolveBranding(edition({ accentColor: 'nope' }), series({ accentColor: '#41a62a' })).accent).toBe('#41a62a');
	});
	it('auto cover fit uses the resolved cover (wide banners shown whole)', () => {
		expect(resolveBranding(edition(), series({ assets: [img('s2', 'cover', 3000, 600)] })).coverFit).toBe('contain');
		expect(resolveBranding(edition(), series({ assets: [img('s2', 'cover', 1600, 900)] })).coverFit).toBe('cover');
	});
});

describe('class colour template', () => {
	it('own colour → series template (case-insensitive name) → name default', () => {
		const tracks = [
			{ id: 'a', name: 'Spårare', color: '#123456' },
			{ id: 'b', name: 'upptäckare', color: null },
			{ id: 'c', name: 'Äventyrare', color: null }
		];
		const c = trackColors(tracks, { Spårare: '#41a62a', Upptäckare: '#da005e' });
		expect(c).toMatchObject({ a: '#123456', b: '#da005e', c: '#e95f13' });
		expect(templateColor({ Ledare: 'nope' }, 'Ledare')).toBeNull();
	});
});

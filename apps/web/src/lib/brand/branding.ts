import { SCOUTBLA, parseHex, readableText } from './colors.ts';

/** Per-event branding as sent to pages (no bytes, only URLs). */
export interface BrandImage {
	url: string;
	width: number;
	height: number;
	alt: string;
}

export interface Branding {
	eventName: string;
	/** The owning kår/district, shown as "Arrangeras av …". */
	organiserName: string | null;
	/** Effective accent (#rrggbb); Scoutblå when none is set. */
	accent: string;
	/** True when the organiser picked an accent. */
	customAccent: boolean;
	/** Black/white text on the accent, or null: then the accent is decoration only (never a text background). */
	onAccent: '#000000' | '#ffffff' | null;
	accentRatio: number;
	eventLogo: BrandImage | null;
	organiserLogo: BrandImage | null;
	cover: BrandImage | null;
	/** How the cover is shown: 'contain' = whole image (baked-in text never cropped), 'cover' = fill and crop. */
	coverFit: 'contain' | 'cover';
	/** The organiser's explicit choice (null = automatic). */
	coverFitSetting: 'contain' | 'cover' | null;
	/** Where each part comes from: the edition's own override, its series, or the Scouterna base. */
	sources: Record<BrandPart, BrandSource>;
	/** The series' values alone (what the edition falls back to); null for one-off competitions. */
	inherited: { seriesName: string; seriesSlug: string; accent: string | null; coverFit: 'contain' | 'cover' | null } | null;
}

export type BrandSource = 'edition' | 'series' | 'base';
export type BrandPart = 'accent' | 'coverFit' | 'eventLogo' | 'organiserLogo' | 'cover';

/** Wide banners (often with text baked in) are shown whole by default. */
export const WIDE_BANNER = 2.5;

export function effectiveCoverFit(setting: 'contain' | 'cover' | null | undefined, cover: { width: number; height: number } | null): 'contain' | 'cover' {
	if (setting) return setting;
	if (!cover) return 'contain';
	return cover.width / cover.height > WIDE_BANNER ? 'contain' : 'cover';
}

export type AssetKind = 'event_logo' | 'organiser_logo' | 'cover';

export interface AssetMeta {
	id: string;
	kind: AssetKind;
	width: number;
	height: number;
}

export interface BrandLevel {
	accentColor: string | null;
	coverFit?: 'contain' | 'cover' | null;
	assets: AssetMeta[];
}

/**
 * THE branding resolution rule, per part: the edition's own value if set, else the series' value,
 * else the Scouterna base (Scoutblå, no images, automatic cover fit). Pure; `loadBranding` feeds it.
 */
export function resolveBranding(
	edition: { name: string; ownerGroupName: string | null } & BrandLevel,
	series: ({ name: string; slug: string } & BrandLevel) | null
): Branding {
	const pick = <T>(e: T | null | undefined, s: T | null | undefined): [T | null, BrandSource] =>
		e != null ? [e, 'edition'] : s != null ? [s, 'series'] : [null, 'base'];
	const [accentColor, accentSrc] = pick(parseHex(edition.accentColor), parseHex(series?.accentColor ?? null));
	const [coverFit, fitSrc] = pick(edition.coverFit ?? null, series?.coverFit ?? null);
	const assets: AssetMeta[] = [];
	const sources = { accent: accentSrc, coverFit: fitSrc } as Record<BrandPart, BrandSource>;
	const PART: Record<AssetKind, BrandPart> = { event_logo: 'eventLogo', organiser_logo: 'organiserLogo', cover: 'cover' };
	for (const kind of ['event_logo', 'organiser_logo', 'cover'] as AssetKind[]) {
		const [a, src] = pick(
			edition.assets.find((x) => x.kind === kind),
			series?.assets.find((x) => x.kind === kind)
		);
		if (a) assets.push(a);
		sources[PART[kind]] = src;
	}
	return {
		...buildBranding({ name: edition.name, ownerGroupName: edition.ownerGroupName, accentColor, coverFit }, assets),
		sources,
		inherited: series ? { seriesName: series.name, seriesSlug: series.slug, accent: parseHex(series.accentColor), coverFit: series.coverFit ?? null } : null
	};
}

export function buildBranding(
	comp: { name: string; ownerGroupName: string | null; accentColor: string | null; coverFit?: 'contain' | 'cover' | null },
	assets: AssetMeta[]
): Omit<Branding, 'sources' | 'inherited'> {
	const custom = parseHex(comp.accentColor);
	const accent = custom ?? SCOUTBLA;
	const r = readableText(accent);
	const img = (kind: AssetKind, alt: string): BrandImage | null => {
		const a = assets.find((x) => x.kind === kind);
		return a ? { url: `/media/${a.id}`, width: a.width, height: a.height, alt } : null;
	};
	const organiserName = comp.ownerGroupName?.trim() || null;
	return {
		eventName: comp.name,
		organiserName,
		accent,
		customAccent: !!custom,
		onAccent: r.text,
		accentRatio: r.ratio,
		eventLogo: img('event_logo', comp.name),
		organiserLogo: img('organiser_logo', organiserName ?? comp.name),
		cover: img('cover', comp.name),
		coverFit: effectiveCoverFit(comp.coverFit, assets.find((a) => a.kind === 'cover') ?? null),
		coverFitSetting: comp.coverFit ?? null
	};
}

/**
 * CSS custom properties for an event shell. When the accent cannot carry text, --event-accent-bg
 * falls back to Scoutblå (so headers stay readable) and the accent is used only as a stripe.
 */
export function accentStyle(b: Pick<Branding, 'accent' | 'onAccent' | 'customAccent'>): string {
	const bg = b.onAccent ? b.accent : SCOUTBLA;
	const on = b.onAccent ?? '#ffffff';
	// Decorative stripe: the organiser's accent, else Äventyrarorange as a small highlight.
	const stripe = b.customAccent ? b.accent : 'var(--orange)';
	return `--event-accent:${b.accent};--event-accent-bg:${bg};--on-event-accent:${on};--event-stripe:${stripe}`;
}

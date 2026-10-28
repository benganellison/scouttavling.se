/**
 * Scouterna's palette (graphic profile, Oct 2023) and WCAG contrast helpers.
 * Shared by server and client: class colours, the per-event accent and their text colours.
 *
 * Rules encoded here:
 * - Complementary colours are decoration (chips, edges, bars). Text sits on them only in
 *   black or white, and only when that reaches 4.5:1; otherwise no text on that colour.
 * - Colour as text on white only when it reaches 4.5:1 (normal) / 3:1 (large).
 */

export interface Swatch {
	key: string;
	name: string;
	hex: string;
}

export const SCOUTBLA = '#003660';

/** The profile palette, Scoutblå first. #837a02 is deliberately absent (only allowed on Rovergul). */
export const PALETTE: Swatch[] = [
	{ key: 'scoutbla', name: 'Scoutblå', hex: SCOUTBLA },
	{ key: 'spararGron', name: 'Spårargrön', hex: '#41a62a' },
	{ key: 'upptackarBla', name: 'Upptäckarblå', hex: '#00a8e1' },
	{ key: 'aventyrarOrange', name: 'Äventyrarorange', hex: '#e95f13' },
	{ key: 'utmanarRosa', name: 'Utmanarrosa', hex: '#da005e' },
	{ key: 'roverGul', name: 'Rovergul', hex: '#e2e000' }
];

/** Normalises "#abc", "abc", "#AABBCC" to "#aabbcc"; null if not a hex colour. */
export function parseHex(input: string | null | undefined): string | null {
	if (!input) return null;
	const s = input.trim().replace(/^#/, '').toLowerCase();
	if (/^[0-9a-f]{3}$/.test(s)) return `#${[...s].map((c) => c + c).join('')}`;
	if (/^[0-9a-f]{6}$/.test(s)) return `#${s}`;
	return null;
}

/** WCAG 2.x relative luminance of a hex colour. */
export function luminance(hex: string): number {
	const h = parseHex(hex);
	if (!h) throw new Error(`not a colour: ${hex}`);
	const ch = [1, 3, 5].map((i) => {
		const c = parseInt(h.slice(i, i + 2), 16) / 255;
		return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

/** WCAG contrast ratio (1–21). */
export function contrast(a: string, b: string): number {
	const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (l1 + 0.05) / (l2 + 0.05);
}

export const AA_NORMAL = 4.5;
export const AA_LARGE = 3;

export interface Readable {
	/** Black or white text that reads on `bg`; null = use the colour for decoration only (no text on it). */
	text: '#000000' | '#ffffff' | null;
	/** Contrast of the better of black/white on `bg`. */
	ratio: number;
}

/**
 * The readable text colour (black or white) on a background, or null when neither reaches `min`.
 * Note: with the AA default (4.5) the better of black/white always reaches at least 4.58:1,
 * so null only happens with a stricter `min`; callers still handle it.
 */
export function readableText(bg: string, min = AA_NORMAL): Readable {
	const onBlack = contrast(bg, '#000000');
	const onWhite = contrast(bg, '#ffffff');
	const best = onWhite >= onBlack ? ({ text: '#ffffff', ratio: onWhite } as const) : ({ text: '#000000', ratio: onBlack } as const);
	return best.ratio >= min ? best : { text: null, ratio: best.ratio };
}

/** Is `fg` usable as a text colour on `bg` (default white)? */
export function textOk(fg: string, bg = '#ffffff', large = false): boolean {
	return contrast(fg, bg) >= (large ? AA_LARGE : AA_NORMAL);
}

// ------------------------------------------------------------------ class (track) colours

/** Name stems → profile colour. Age groups per the profile; "Ledare" → Scoutblå. */
const NAMED: [RegExp, string][] = [
	[/^spårar/i, '#41a62a'],
	[/^upptäck/i, '#00a8e1'],
	[/^äventyr/i, '#e95f13'],
	[/^utmanar/i, '#da005e'],
	[/^rover/i, '#e2e000'],
	[/^ledar|^ledare/i, SCOUTBLA]
];

/** The profile colour a class name implies (Spårare…Rover, Ledare), else null. */
export function namedTrackColor(name: string): string | null {
	const n = name.trim();
	for (const [re, hex] of NAMED) if (re.test(n)) return hex;
	return null;
}

/** After the palette: neutral greys of clearly different lightness (still not brand colours). */
const NEUTRALS = ['#5c6570', '#b4bcc6', '#1f262e', '#8a939e'];

/** Generated, evenly spread hues for very many classes (beyond palette + neutrals). */
function generated(i: number): string {
	const hue = (i * 137.508 + 200) % 360;
	const l = i % 2 ? 0.42 : 0.62;
	const s = 0.55;
	const k = (n: number) => (n + hue / 30) % 12;
	const a = s * Math.min(l, 1 - l);
	const f = (n: number) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))));
	return `#${[f(0), f(8), f(4)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** A series' class colour template (class name → hex), looked up case-insensitively. */
export type ClassColorTemplate = Record<string, string>;

export function templateColor(template: ClassColorTemplate | null | undefined, name: string): string | null {
	if (!template) return null;
	const n = name.trim().toLowerCase();
	for (const [k, v] of Object.entries(template)) if (k.trim().toLowerCase() === n) return parseHex(v);
	return null;
}

/**
 * Effective colour per class: an explicit colour wins, then the series' template colour for that
 * class name, then the name default, then a distinct automatic colour, so no two classes in one
 * competition share a *default*. Deterministic in the given order (pass tracks sorted by `sort`).
 */
export function trackColors(tracks: { id: string; name: string; color?: string | null }[], template?: ClassColorTemplate | null): Record<string, string> {
	const out: Record<string, string> = {};
	const used = new Set<string>();
	for (const t of tracks) {
		const c = parseHex(t.color) ?? templateColor(template, t.name);
		if (c) {
			out[t.id] = c;
			used.add(c);
		}
	}
	for (const t of tracks) {
		if (out[t.id]) continue;
		const named = namedTrackColor(t.name);
		if (named && !used.has(named)) {
			out[t.id] = named;
			used.add(named);
		}
	}
	const pool = [...PALETTE.slice(1).map((p) => p.hex), SCOUTBLA, ...NEUTRALS];
	let gen = 0;
	for (const t of tracks) {
		if (out[t.id]) continue;
		let c = pool.find((p) => !used.has(p));
		while (!c) {
			const g = generated(gen++);
			if (!used.has(g)) c = g;
		}
		out[t.id] = c;
		used.add(c);
	}
	return out;
}

/** Light fills (e.g. Rovergul, pale greys) need an outline to stand out on white. */
export function needsOutline(hex: string): boolean {
	return contrast(hex, '#ffffff') < 1.6;
}

/** Display name of a palette colour, or the hex itself. */
export function colorName(hex: string): string {
	const h = parseHex(hex);
	return PALETTE.find((p) => p.hex === h)?.name ?? h ?? hex;
}

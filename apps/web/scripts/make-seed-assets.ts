/**
 * Renders the invented demo branding for GökOpen 2027 (seed data) to PNG:
 *   seed-assets/gokopen-cover.png      1600×560  forest and lake, no text (the name is overlaid by the page)
 *   seed-assets/gokopen-logo.png        512×512  cuckoo emblem in a round "GökOpen" badge, transparent
 *   seed-assets/granliden-logo.png      600×200  "Granlidens scoutkår" wordmark with a spruce, transparent
 *
 * Everything here is made up for the demo (no real event or scout group). The Scouterna symbol is
 * deliberately NOT used: it belongs to Scouterna, not to an organiser.
 *
 *   node scripts/make-seed-assets.ts      (from apps/web; uses the installed Playwright Chromium)
 */
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = join(ROOT, 'scripts/seed-assets');
const FONTS = resolve(ROOT, '../../node_modules/@fontsource/libre-franklin/files');
const font = (w: number) => readFileSync(join(FONTS, `libre-franklin-latin-${w}-normal.woff2`)).toString('base64');

const BLUE = '#003660'; // Scoutblå
const ACCENT = '#00a8e1'; // Upptäckarblå, GökOpen's accent

const fontFace = [400, 700, 800]
	.map((w) => `@font-face{font-family:LF;font-weight:${w};src:url(data:font/woff2;base64,${font(w)}) format('woff2')}`)
	.join('');
const page = (w: number, h: number, svg: string) =>
	`<!doctype html><meta charset="utf-8"><style>${fontFace}html,body{margin:0;background:transparent}svg{display:block}</style>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${svg}</svg>`;

/** Deterministic pseudo-random numbers, so the cover is identical on every run. */
function rng(seed: number) {
	return () => {
		seed = (seed * 1664525 + 1013904223) >>> 0;
		return seed / 2 ** 32;
	};
}

/** A stylised spruce: stacked triangles on a short trunk, foot at (x, y). */
function spruce(x: number, y: number, h: number, fill: string) {
	const w = h * 0.42;
	const tiers = 4;
	let d = '';
	for (let i = 0; i < tiers; i++) {
		const top = y - h + (i * h * 0.8) / tiers;
		const bottom = top + h * 0.38;
		const half = (w / 2) * (0.45 + (0.55 * (i + 1)) / tiers);
		d += `M${x} ${top}L${x + half} ${bottom}L${x - half} ${bottom}Z`;
	}
	d += `M${x - h * 0.03} ${y - h * 0.12}h${h * 0.06}V${y}h${-h * 0.06}Z`;
	return `<path d="${d}" fill="${fill}"/>`;
}

function cover() {
	const W = 1600;
	const H = 560;
	const r = rng(2027);
	const row = (n: number, y0: number, hMin: number, hMax: number, fill: string, xFrom = -40, xTo = W + 40, gapFrom = -1, gapTo = -1) => {
		let s = '';
		for (let i = 0; i < n; i++) {
			const x = xFrom + ((xTo - xFrom) * (i + r() * 0.8)) / n;
			if (x > gapFrom && x < gapTo) continue;
			s += spruce(x, y0 + r() * 14, hMin + r() * (hMax - hMin), fill);
		}
		return s;
	};
	const lakeY = 360;
	return page(W, H, `
<defs>
  <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#bfe0ef"/><stop offset="1" stop-color="#eaf5f2"/></linearGradient>
  <linearGradient id="lake" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8fc3d6"/><stop offset="1" stop-color="#5d9bb5"/></linearGradient>
</defs>
<rect width="${W}" height="${H}" fill="url(#sky)"/>
<circle cx="1180" cy="120" r="58" fill="#fff6d8"/>
<path d="M0 300 C 180 230 330 250 470 280 S 760 210 930 250 S 1250 230 1400 260 S 1560 240 1600 250 V ${lakeY} H0Z" fill="#a9cbc6"/>
<path d="M0 330 C 220 290 420 300 600 320 S 980 280 1200 310 S 1480 300 1600 300 V ${lakeY} H0Z" fill="#7fae9e"/>
${row(60, lakeY + 2, 34, 60, '#5f9483')}
<rect y="${lakeY}" width="${W}" height="${H - lakeY}" fill="url(#lake)"/>
<g opacity=".22" fill="#ffffff">
  <rect x="380" y="${lakeY + 22}" width="220" height="3" rx="1.5"/><rect x="760" y="${lakeY + 40}" width="320" height="3" rx="1.5"/>
  <rect x="1150" y="${lakeY + 28}" width="160" height="3" rx="1.5"/><rect x="560" y="${lakeY + 64}" width="260" height="3" rx="1.5"/>
  <rect x="1040" y="${lakeY + 82}" width="200" height="3" rx="1.5"/><rect x="1150" y="${lakeY + 12}" width="60" height="3" rx="1.5"/>
</g>
<path d="M0 ${lakeY + 60} C 140 ${lakeY + 40} 300 ${lakeY + 60} 440 ${H} H0Z" fill="#3f7a5c"/>
<path d="M1600 ${lakeY + 40} C 1440 ${lakeY + 30} 1290 ${lakeY + 70} 1170 ${H} H1600Z" fill="#3f7a5c"/>
${row(8, lakeY + 92, 120, 190, '#2f6a4f', -30, 300)}
${row(7, lakeY + 110, 130, 210, '#2f6a4f', 1300, 1640)}
<path d="M0 ${H - 60} C 200 ${H - 90} 420 ${H - 70} 600 ${H - 40} L 600 ${H} H0Z" fill="#1f4f3b"/>
<path d="M1600 ${H - 80} C 1420 ${H - 100} 1200 ${H - 70} 1050 ${H - 30} L 1050 ${H} H1600Z" fill="#1f4f3b"/>
${row(6, H + 30, 230, 320, '#173f30', -60, 260)}
${row(5, H + 30, 230, 330, '#173f30', 1360, 1680)}
`);
}

/** A perched cuckoo facing left, in local coordinates around (0,0), about 300 wide. */
function cuckoo(body: string, wing: string, bars: string) {
	return `
<path d="M40 30 L150 120 L136 136 L22 52Z" fill="${body}"/>
<path d="M-108 -48 C -110 -84 -78 -102 -52 -96 C -26 -90 -14 -70 -18 -52 C 10 -46 60 -10 70 30 C 76 56 40 66 0 58 C -50 50 -96 20 -104 -14 Z" fill="${body}"/>
<path d="M-112 -70 L-150 -60 L-110 -56Z" fill="${body}"/>
<circle cx="-78" cy="-70" r="9" fill="#fff"/><circle cx="-80" cy="-70" r="4.5" fill="${body}"/>
<path d="M-40 -34 C 10 -40 60 -6 92 40 C 50 30 0 20 -36 6 C -48 -6 -50 -24 -40 -34Z" fill="${wing}"/>
<g fill="none" stroke="${bars}" stroke-width="5" stroke-linecap="round">
  <path d="M-92 -12 q 14 8 28 6"/><path d="M-80 6 q 16 8 32 6"/><path d="M-62 24 q 16 8 32 6"/><path d="M-40 40 q 14 6 28 4"/>
</g>
<path d="M-40 56 l -6 22 M-10 60 l -2 20" stroke="${body}" stroke-width="7" stroke-linecap="round"/>
`;
}

function eventLogo() {
	const S = 512;
	const c = S / 2;
	return page(S, S, `
<defs>
  <path id="bot" d="M ${c - 186} ${c} A 186 186 0 0 0 ${c + 186} ${c}"/>
</defs>
<circle cx="${c}" cy="${c}" r="250" fill="${BLUE}"/>
<circle cx="${c}" cy="${c}" r="232" fill="none" stroke="${ACCENT}" stroke-width="10"/>
<circle cx="${c}" cy="${c - 34}" r="150" fill="#fff"/>
<g transform="translate(${c + 6} ${c - 34}) scale(.92)">
  <path d="M-170 86 C -60 70 70 76 170 92" stroke="${ACCENT}" stroke-width="12" fill="none" stroke-linecap="round"/>
  ${cuckoo(BLUE, ACCENT, '#fff')}
</g>
<text font-family="LF" font-weight="800" font-size="68" fill="#fff" letter-spacing="1" text-anchor="middle">
  <textPath href="#bot" startOffset="50%" side="left" dy="0">GökOpen</textPath>
</text>
`);
}

function organiserLogo() {
	return page(600, 200, `
<g transform="translate(78 172)">
  ${spruce(0, 0, 150, BLUE)}
</g>
<text x="160" y="104" font-family="LF" font-weight="800" font-size="64" fill="${BLUE}" letter-spacing="-.5">Granlidens</text>
<text x="162" y="160" font-family="LF" font-weight="400" font-size="46" fill="${BLUE}" letter-spacing="2">scoutkår</text>
`);
}

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const items: [string, number, number, string, boolean][] = [
	['gokopen-cover.png', 1600, 560, cover(), false],
	['gokopen-logo.png', 512, 512, eventLogo(), true],
	['granliden-logo.png', 600, 200, organiserLogo(), true]
];
for (const [file, w, h, html, transparent] of items) {
	const p = await browser.newPage({ viewport: { width: w, height: h } });
	await p.setContent(html);
	await p.evaluate(() => document.fonts.ready);
	await p.locator('svg').screenshot({ path: join(OUT, file), omitBackground: transparent });
	await p.close();
	console.log(`${file}: ${w}×${h}, ${Math.round(statSync(join(OUT, file)).size / 1024)} KB`);
}
await browser.close();

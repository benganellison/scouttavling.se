/**
 * Turns the raw demo recordings (e2e/demo.e2e.ts) into the README clips:
 * captions from e2e/demo-results/captions.json are burned into a band BELOW
 * the screen (never covering the UI), encoded as small H.264 MP4s.
 *
 *   node scripts/demo-cut.ts          (from apps/web; needs Docker)
 *
 * Output: e2e/demo-results/final/*.mp4. Each clip is re-encoded with stronger
 * compression until it fits its byte budget, so the README videos never grow.
 *
 * Every clip opens with a 1.5 s title card (Scoutblå, the clip's name, the GökOpen event logo and
 * Scouterna's white logo), rendered with Playwright at the clip's exact size: GitHub shows the first
 * frame as the video's still. The recordings themselves start when their first real page is painted
 * (e2e/demo-results/ready.json), so there are no blank frames.
 */
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const FFMPEG_IMAGE = 'linuxserver/ffmpeg:9.0.2';
const ROOT = resolve(import.meta.dirname, '..');
const DIR = join(ROOT, 'e2e/demo-results');
const WORK = join(DIR, '_cut');
const FONT = resolve(ROOT, '../../node_modules/@fontsource/libre-franklin/files/libre-franklin-latin-700-normal.woff');
const BG = '0x003660'; // Scoutblå

interface Cap { start: number; end: number | null; text: string }
const captions: Record<string, Cap[]> = JSON.parse(readFileSync(join(DIR, 'captions.json'), 'utf8'));
const timing: Record<string, number> = JSON.parse(readFileSync(join(DIR, 'timing.json'), 'utf8'));
const ready: Record<string, number> = existsSync(join(DIR, 'ready.json')) ? JSON.parse(readFileSync(join(DIR, 'ready.json'), 'utf8')) : {};
/** Seconds to skip at the start of a recording (blank page before the first paint). */
const skip = (name: string) => (ready[name] && timing[name] ? Math.max(0, (ready[name] - timing[name]) / 1000) : 0);
/** Trims a recording to its first painted frame (captions are shifted to match in captionFilters). */
const trim = (name: string) => `trim=start=${skip(name).toFixed(3)},setpts=PTS-STARTPTS`;

/** Byte budgets = sizes of the previous README clips (2026-10-19). The new clips must not be bigger. */
const clips = [
	{ out: '01-funktionar-offline.mp4', budget: 434_371 },
	{ out: '02-ledningscentral-live.mp4', budget: 572_420 },
	{ out: '03-mal-alla-delar.mp4', budget: 178_204 },
	{ out: '04-prisutdelning.mp4', budget: 164_480 },
	{ out: '05-tavlingssida-varumarke.mp4', budget: 450_000 }
];

/** Title cards: the clip's Swedish name and a one-line subtitle. */
const titles = [
	['Funktionären på kontrollen', 'Poäng i telefonen, även utan täckning'],
	['Ledningscentralen live', 'Rapporter, rättningar och meddelanden i realtid'],
	['Målet med flera delar', 'En skanning, alla delar på samma skärm'],
	['Prisutdelningen', 'Placeringarna avslöjas en i taget på storbild'],
	['Tävlingens eget utseende', 'Logga, färg och omslagsbild, med Scouterna som avsändare']
];
const CARD_SECONDS = 1.5;

rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });
mkdirSync(join(DIR, 'final'), { recursive: true });
copyFileSync(FONT, join(WORK, 'font.woff'));

// ---- title cards (PNG at each clip's exact size) ----
const b64 = (f: string) => readFileSync(f).toString('base64');
const FONTS = resolve(ROOT, '../../node_modules/@fontsource/libre-franklin/files');
const EVENT_LOGO = join(ROOT, 'scripts/seed-assets/gokopen-logo.png');
const SCOUTERNA_WHITE = join(ROOT, 'static/brand/scouterna/scouterna_white_RGB.svg'); // official, unchanged

function cardHtml(w: number, h: number, title: string, sub: string) {
	const m = Math.min(w, h);
	const narrow = w < 600;
	const pad = Math.round(narrow ? 32 : w * 0.07);
	const logo = Math.round(narrow ? 150 : m * 0.26);
	const t = Math.round(narrow ? 34 : m * 0.075);
	const st = Math.round(narrow ? 19 : m * 0.032);
	// Scouterna logo: 250 px (minimum on screen) with its clear space (≈ 7.6 % of its width).
	const sw = narrow ? 250 : Math.round(Math.max(250, w * 0.2));
	const clear = Math.round(0.076 * sw);
	return `<!doctype html><meta charset="utf-8"><style>
@font-face{font-family:LF;font-weight:800;src:url(data:font/woff2;base64,${b64(join(FONTS, 'libre-franklin-latin-800-normal.woff2'))}) format('woff2')}
@font-face{font-family:LF;font-weight:400;src:url(data:font/woff2;base64,${b64(join(FONTS, 'libre-franklin-latin-400-normal.woff2'))}) format('woff2')}
html,body{margin:0}
.card{position:relative;width:${w}px;height:${h}px;background:#003660;color:#fff;font-family:LF;overflow:hidden;box-sizing:border-box;
 padding:${pad}px;display:flex;flex-direction:${narrow ? 'column' : 'row'};align-items:${narrow ? 'flex-start' : 'center'};justify-content:${narrow ? 'center' : 'flex-start'};gap:${narrow ? 28 : Math.round(pad * 0.6)}px;padding-bottom:${narrow ? pad + 120 : pad}px}
.ev{width:${logo}px;height:${logo}px;flex:none}
h1{font-weight:800;font-size:${t}px;line-height:1.1;margin:0 0 ${Math.round(t * 0.35)}px;letter-spacing:-.01em}
p{font-weight:400;font-size:${st}px;line-height:1.35;margin:0;max-width:${narrow ? w - 2 * pad : Math.round(w * 0.62)}px}
.by{font-size:${Math.max(13, Math.round(st * 0.7))}px;opacity:1;margin-top:${Math.round(st * 0.9)}px;font-weight:400}
.sc{position:absolute;right:${narrow ? 16 : pad / 2}px;bottom:${narrow ? 16 : pad / 2}px;padding:${clear}px;line-height:0}
.sc img{width:${sw}px;display:block}
</style><div class="card"><img class="ev" src="data:image/png;base64,${b64(EVENT_LOGO)}" alt="">
<div><h1>${title}</h1><p>${sub}</p><p class="by">GökOpen 2027 · påhittad demotävling</p></div>
<span class="sc"><img src="data:image/svg+xml;base64,${b64(SCOUTERNA_WHITE)}" alt="Scouterna"></span></div>`;
}

const PHONE_H = 844 + 120;
const sizes: [number, number][] = [[390, PHONE_H], [1350 + 390, PHONE_H], [390, PHONE_H], [1280, 810], [1280, 810]];
{
	const browser = await chromium.launch();
	for (const [i, [w, h]] of sizes.entries()) {
		const page = await browser.newPage({ viewport: { width: w, height: h } });
		await page.setContent(cardHtml(w, h, titles[i][0], titles[i][1]));
		await page.evaluate(() => document.fonts.ready);
		await page.screenshot({ path: join(WORK, `card-${i + 1}.png`) });
		await page.close();
	}
	await browser.close();
	// CARDS_ONLY=1 renders just the title cards (e2e/demo-results/_cut/card-*.png) to check the design.
	if (process.env.CARDS_ONLY) process.exit(0);
}

const rawVideo = (name: string) => {
	// Newest recording wins: Playwright adds a new page@<hash>.webm per run without removing old ones.
	const f = readdirSync(join(DIR, name))
		.filter((x) => x.endsWith('.webm'))
		.sort((x, y) => statSync(join(DIR, name, y)).mtimeMs - statSync(join(DIR, name, x)).mtimeMs)[0];
	if (!f) throw new Error(`no recording for ${name}`);
	return `/v/${name}/${f}`;
};

function wrap(text: string, maxChars: number): string[] {
	const lines: string[] = [];
	let line = '';
	for (const word of text.split(' ')) {
		if (line && (line + ' ' + word).length > maxChars) {
			lines.push(line);
			line = word;
		} else line = line ? `${line} ${word}` : word;
	}
	if (line) lines.push(line);
	return lines;
}

let fileNo = 0;
/** drawtext filters for one recording's captions, centred line by line in a band starting at y0. */
function captionFilters(name: string, o: { y0: number; band: number; size: number; maxChars: number; x0?: number; width?: string }) {
	const lh = Math.round(o.size * 1.3);
	const parts: string[] = [];
	const off = skip(name);
	for (const c of captions[name] ?? []) {
		const lines = wrap(c.text, o.maxChars);
		const top = o.y0 + Math.round((o.band - lines.length * lh) / 2);
		const start = Math.max(0, c.start - off);
		const end = c.end === null ? 99999 : c.end - off;
		lines.forEach((l, i) => {
			const file = `t${fileNo++}.txt`;
			writeFileSync(join(WORK, file), l);
			const x = o.width ? `${o.x0 ?? 0}+(${o.width}-text_w)/2` : '(w-text_w)/2';
			parts.push(
				`drawtext=fontfile=/w/font.woff:textfile=/w/${file}:fontcolor=white:fontsize=${o.size}:x=${x}:y=${top + i * lh}:enable='between(t,${start.toFixed(2)},${end.toFixed(2)})'`
			);
		});
	}
	return parts;
}

function ffmpeg(args: string[]) {
	execFileSync('docker', ['run', '--rm', '-v', `${DIR}:/v`, '-v', `${WORK}:/w`, FFMPEG_IMAGE, '-v', 'error', '-y', ...args], { stdio: 'inherit' });
}

/** Encode with increasing CRF until the file fits the budget. The filter ends in [body]; the clip's
 *  title card (the last input) is put in front of it. */
function encode(inputs: string[], filter: string, out: string, budget: number) {
	const target = join(DIR, 'final', out);
	const card = inputs.length;
	const n = clips.findIndex((c) => c.out === out);
	const full = `${filter};[${card}:v]fps=15,format=yuv420p,setsar=1[card];[body]format=yuv420p,setsar=1[main];[card][main]concat=n=2:v=1:a=0[out]`;
	for (const crf of [30, 32, 34, 36, 38]) {
		ffmpeg([
			...inputs.flatMap((i) => ['-i', i]),
			'-loop', '1', '-framerate', '15', '-t', String(CARD_SECONDS), '-i', `/w/card-${n + 1}.png`,
			'-filter_complex', full, '-map', '[out]',
			'-c:v', 'libx264', '-preset', 'veryslow', '-tune', 'stillimage', '-crf', String(crf),
			'-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', `/v/final/${out}`
		]);
		const size = statSync(target).size;
		console.log(`${out}: crf ${crf} → ${Math.round(size / 1024)} KB (budget ${Math.round(budget / 1024)} KB)`);
		if (size <= budget) return;
	}
	throw new Error(`${out} does not fit its budget even at crf 38`);
}

const PHONE_BAND = 120;
const phoneCaps = (name: string) => captionFilters(name, { y0: 844, band: PHONE_BAND, size: 19, maxChars: 30 });

// 1 and 3: phone recordings
for (const [name, clip] of [['demo-01-funktionar', clips[0]], ['demo-03-mal', clips[2]]] as const) {
	const f = [trim(name), `fps=15`, `pad=390:${844 + PHONE_BAND}:0:0:color=${BG}`, ...phoneCaps(name)].join(',');
	encode([rawVideo(name)], `[0:v]${f}[body]`, clip.out, clip.budget);
}

// 2: HQ (scaled to phone height) and phone side by side, each with its own caption band
{
	const hqW = 1350;
	const hq = [trim('demo-02-hq'), `fps=15`, `scale=${hqW}:844`, `pad=${hqW}:${844 + PHONE_BAND}:0:0:color=${BG}`,
		...captionFilters('demo-02-hq', { y0: 844, band: PHONE_BAND, size: 26, maxChars: 80 })].join(',');
	const ph = [trim('demo-02-phone'), `fps=15`, `pad=390:${844 + PHONE_BAND}:0:0:color=${BG}`, ...phoneCaps('demo-02-phone')].join(',');
	encode([rawVideo('demo-02-hq'), rawVideo('demo-02-phone')],
		`[0:v]${hq}[a];[1:v]${ph}[b];[a][b]hstack=inputs=2:shortest=1[body]`, clips[1].out, clips[1].budget);
}

// 4: ceremony on the big screen
{
	const band = 90;
	const f = [trim('demo-04-prisutdelning'), `fps=15`, `scale=1280:720`, `pad=1280:${720 + band}:0:0:color=${BG}`,
		...captionFilters('demo-04-prisutdelning', { y0: 720, band, size: 26, maxChars: 80 })].join(',');
	encode([rawVideo('demo-04-prisutdelning')], `[0:v]${f}[body]`, clips[3].out, clips[3].budget);
}

// 5: event branding. Desktop (settings + public page), phone (public pages), desktop (scorecards),
// each on the same 1280×810 canvas with captions below, played one after the other.
{
	const band = 90;
	const caps = (name: string) => captionFilters(name, { y0: 720, band, size: 26, maxChars: 80 });
	const desk = (name: string) => [trim(name), `fps=15`, `scale=1152:720`, `pad=1280:${720 + band}:64:0:color=${BG}`, ...caps(name), 'setsar=1', 'format=yuv420p'].join(',');
	const phone = (name: string) => [trim(name), `fps=15`, `scale=-2:720`, `pad=1280:${720 + band}:(ow-iw)/2:0:color=${BG}`, ...caps(name), 'setsar=1', 'format=yuv420p'].join(',');
	encode(
		[rawVideo('demo-05-utseende'), rawVideo('demo-05-telefon'), rawVideo('demo-05-utskrift')],
		`[0:v]${desk('demo-05-utseende')}[a];[1:v]${phone('demo-05-telefon')}[b];[2:v]${desk('demo-05-utskrift')}[c];[a][b][c]concat=n=3:v=1:a=0[body]`,
		clips[4].out, clips[4].budget
	);
}

console.log(`done → ${join(DIR, 'final')}`);

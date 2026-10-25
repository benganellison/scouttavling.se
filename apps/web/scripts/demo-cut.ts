/**
 * Turns the raw demo recordings (e2e/demo.e2e.ts) into the README clips:
 * captions from e2e/demo-results/captions.json are burned into a band BELOW
 * the screen (never covering the UI), encoded as small H.264 MP4s.
 *
 *   node scripts/demo-cut.ts          (from apps/web; needs Docker)
 *
 * Output: e2e/demo-results/final/*.mp4. Each clip is re-encoded with stronger
 * compression until it fits its byte budget, so the README videos never grow.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const FFMPEG_IMAGE = 'linuxserver/ffmpeg:9.0.2';
const ROOT = resolve(import.meta.dirname, '..');
const DIR = join(ROOT, 'e2e/demo-results');
const WORK = join(DIR, '_cut');
const FONT = resolve(ROOT, '../../node_modules/@fontsource/libre-franklin/files/libre-franklin-latin-700-normal.woff');
const BG = '0x003660'; // Scoutblå

interface Cap { start: number; end: number | null; text: string }
const captions: Record<string, Cap[]> = JSON.parse(readFileSync(join(DIR, 'captions.json'), 'utf8'));

/** Byte budgets = sizes of the previous README clips (2026-10-19). The new clips must not be bigger. */
const clips = [
	{ out: '01-funktionar-offline.mp4', budget: 434_371 },
	{ out: '02-ledningscentral-live.mp4', budget: 572_420 },
	{ out: '03-mal-alla-delar.mp4', budget: 178_204 },
	{ out: '04-prisutdelning.mp4', budget: 164_480 }
];

rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });
mkdirSync(join(DIR, 'final'), { recursive: true });
copyFileSync(FONT, join(WORK, 'font.woff'));

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
	for (const c of captions[name] ?? []) {
		const lines = wrap(c.text, o.maxChars);
		const top = o.y0 + Math.round((o.band - lines.length * lh) / 2);
		const end = c.end ?? 99999;
		lines.forEach((l, i) => {
			const file = `t${fileNo++}.txt`;
			writeFileSync(join(WORK, file), l);
			const x = o.width ? `${o.x0 ?? 0}+(${o.width}-text_w)/2` : '(w-text_w)/2';
			parts.push(
				`drawtext=fontfile=/w/font.woff:textfile=/w/${file}:fontcolor=white:fontsize=${o.size}:x=${x}:y=${top + i * lh}:enable='between(t,${c.start.toFixed(2)},${end.toFixed(2)})'`
			);
		});
	}
	return parts;
}

function ffmpeg(args: string[]) {
	execFileSync('docker', ['run', '--rm', '-v', `${DIR}:/v`, '-v', `${WORK}:/w`, FFMPEG_IMAGE, '-v', 'error', '-y', ...args], { stdio: 'inherit' });
}

/** Encode with increasing CRF until the file fits the budget. */
function encode(inputs: string[], filter: string, out: string, budget: number) {
	const target = join(DIR, 'final', out);
	for (const crf of [30, 32, 34, 36, 38]) {
		ffmpeg([
			...inputs.flatMap((i) => ['-i', i]),
			'-filter_complex', filter, '-map', '[out]',
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
	const f = [`fps=15`, `pad=390:${844 + PHONE_BAND}:0:0:color=${BG}`, ...phoneCaps(name)].join(',');
	encode([rawVideo(name)], `[0:v]${f}[out]`, clip.out, clip.budget);
}

// 2: HQ (scaled to phone height) and phone side by side, each with its own caption band
{
	const hqW = 1350;
	const hq = [`fps=15`, `scale=${hqW}:844`, `pad=${hqW}:${844 + PHONE_BAND}:0:0:color=${BG}`,
		...captionFilters('demo-02-hq', { y0: 844, band: PHONE_BAND, size: 26, maxChars: 80 })].join(',');
	const ph = [`fps=15`, `pad=390:${844 + PHONE_BAND}:0:0:color=${BG}`, ...phoneCaps('demo-02-phone')].join(',');
	encode([rawVideo('demo-02-hq'), rawVideo('demo-02-phone')],
		`[0:v]${hq}[a];[1:v]${ph}[b];[a][b]hstack=inputs=2:shortest=1[out]`, clips[1].out, clips[1].budget);
}

// 4: ceremony on the big screen
{
	const band = 90;
	const f = [`fps=15`, `scale=1280:720`, `pad=1280:${720 + band}:0:0:color=${BG}`,
		...captionFilters('demo-04-prisutdelning', { y0: 720, band, size: 26, maxChars: 80 })].join(',');
	encode([rawVideo('demo-04-prisutdelning')], `[0:v]${f}[out]`, clips[3].out, clips[3].budget);
}

console.log(`done → ${join(DIR, 'final')}`);

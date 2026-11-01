/**
 * Fails when committed files look like personal data: spreadsheets / CSV exports, or a Swedish
 * personnummer (or samordningsnummer) with a real date and a valid check digit. Runs in CI and with
 * `npm run check:personal-data`. Only tracked files are read (git ls-files), never local data.
 *
 * Tests that must contain a personnummer-like string (the import gate's own tests) use numbers with
 * an INVALID check digit, or mark the line with "pnr-check: ignore".
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const FORBIDDEN = /\.(xls|xlsx|xlsm|ods|numbers|csv)$/i;
const BINARY = /\.(png|jpe?g|gif|webp|avif|ico|svg|woff2?|ttf|otf|pdf|zip|gz|mp4|webm|mov|mp3|wav)$/i;
const PNR = /(?<![\d-])(?:(?:19|20)\d{2}|\d{2})(\d{2})(\d{2})(\d{2})[-+]?(\d{4})(?![\d-])/g;

/** Luhn over the 10-digit form (YYMMDDNNNC). */
function luhnOk(ten: string): boolean {
	let sum = 0;
	for (let i = 0; i < 10; i++) {
		let d = Number(ten[i]) * (i % 2 === 0 ? 2 : 1);
		if (d > 9) d -= 9;
		sum += d;
	}
	return sum % 10 === 0;
}

function looksReal(m: RegExpMatchArray): boolean {
	const [, yy, mm, dd, tail] = m;
	const month = Number(mm);
	const day = Number(dd);
	if (month < 1 || month > 12) return false;
	if (!((day >= 1 && day <= 31) || (day >= 61 && day <= 91))) return false; // 61–91: samordningsnummer
	return luhnOk(`${yy}${mm}${dd}${tail}`);
}

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const problems: string[] = [];
for (const f of files) {
	if (FORBIDDEN.test(f)) {
		problems.push(`${f}: spreadsheet/CSV files must not be committed (they are how participant lists leak)`);
		continue;
	}
	if (BINARY.test(f)) continue;
	let text: string;
	try {
		text = readFileSync(f, 'utf8');
	} catch {
		continue;
	}
	text.split('\n').forEach((line, i) => {
		if (line.includes('pnr-check: ignore')) return;
		for (const m of line.matchAll(PNR)) if (looksReal(m)) problems.push(`${f}:${i + 1}: looks like a personnummer (${m[0].slice(0, 4)}…)`);
	});
}
if (problems.length) {
	console.error(`Possible personal data in committed files:\n${problems.map((p) => `  ${p}`).join('\n')}`);
	process.exit(1);
}
console.log(`check-personal-data: ${files.length} tracked files, no personnummer or spreadsheets.`);

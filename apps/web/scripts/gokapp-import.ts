/**
 * Import one old gokapp year into a series' archive (docs/architecture/02 §9, 05 §5).
 * Dry run by default: prints what would be created and compares the ranking with gokapp's.
 *
 *   GOKAPP_SOURCE='mysql://user:pass@host:3306/gokapp' \
 *     npm run gokapp:import -- --series gokopen --year 2023 --owner 3000001 [--commit]
 *
 * Options:
 *   --series <slug>         series to add the year to (created with --series-name if missing)
 *   --series-name "<name>"  name for a new series, e.g. "Hajk-DM"
 *   --year <yyyy>           the edition year
 *   --owner <memberNo>      owner of the new edition (must have logged in once)
 *   --date <yyyy-mm-dd>     competition day (default: the day most scores were saved)
 *   --name "<name>"         default "<series name> <year>"
 *   --slug <slug>           default "<series>-<year>"
 *   --no-times              do not use gokapp's save times as visit times
 *   --commit                write it (one transaction; nothing is written on any error)
 *
 * The connection string is read from GOKAPP_SOURCE so the password never shows in the process
 * list or shell history. Only allowlisted columns are read (READS in gokappImport.ts): no members,
 * contacts, notes or payments. Production: run inside the app container (DATABASE_URL is set).
 */
import postgres from 'postgres';
import mysql from 'mysql2/promise';
import { userInfo } from 'node:os';
import { plan, readGokapp, writeImport } from '../src/lib/server/gokappImport.ts';

function fail(msg: string, code = 1): never {
	console.error(msg);
	process.exit(code);
}

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string) => {
	const i = args.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
	if (i < 0) return undefined;
	return args[i].includes('=') ? args[i].slice(args[i].indexOf('=') + 1) : args[i + 1];
};
if (opt('source')) fail('Pass the MySQL address in GOKAPP_SOURCE, not on the command line (it contains a password).', 2);

const source = process.env.GOKAPP_SOURCE;
const series = opt('series') ?? '';
const year = Number(opt('year'));
const owner = (opt('owner') ?? '').replace(/\s+/g, '');
const date = opt('date');
if (!source) fail('Set GOKAPP_SOURCE=mysql://user:pass@host:3306/gokapp', 2);
if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(series)) fail('--series <slug> (a–z, 0–9, -) is required.', 2);
if (!Number.isInteger(year) || year < 2000 || year > 2100) fail('--year <yyyy> is required.', 2);
if (!/^\d{3,12}$/.test(owner)) fail('--owner <memberNo> is required.', 2);
if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) fail('--date must be YYYY-MM-DD.', 2);
if (!process.env.DATABASE_URL) fail('DATABASE_URL is not set.', 2);

const operator = `cli:${process.env.SUDO_USER || (() => { try { return userInfo().username; } catch { return 'unknown'; } })()}`;
const opts = {
	series, seriesName: opt('series-name'), year, date, name: opt('name'), slug: opt('slug'),
	ownerMemberNo: owner, withTimes: !flag('no-times'), operator
};

// DATETIME columns are read as UTC; only differences between them are used (times between stations).
const my = await mysql.createConnection({ uri: source, timezone: 'Z', dateStrings: false });
const pg = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });
try {
	const data = await readGokapp(my);
	// The dry run shows what --commit writes: an existing series keeps its own name.
	const [existing] = await pg`select name from series where slug = ${series}`;
	if (!existing && !opts.seriesName) fail(`Serien "${series}" finns inte. Ange --series-name för att skapa den (gokapp kallar tävlingen "${data.configName ?? '?'}").`, 2);
	const p = plan(data, { ...opts, seriesName: existing?.name ?? opts.seriesName! }).plan;
	console.log(`\n${p.name}  →  /t/${series} (år ${year}), adress /r/${p.slug}`);
	console.log(`${existing ? 'Befintlig serie' : 'Ny serie'}: ${existing?.name ?? opts.seriesName} (/t/${series})`);
	console.log(`Datum: ${p.date ?? '(okänt, ange --date)'}${p.dateGuessed && p.date ? ' (gissat från när poängen sparades)' : ''}`);
	if (p.date && Number(p.date.slice(0, 4)) !== year) console.log(`VARNING: datumet ${p.date} är inte år ${year}. Stämmer --year? Ange annars --date.`);
	console.log(`${p.stations} kontroller, ${p.patrols} patruller, ${p.scores} poäng, ${p.timedScores} med tid`);
	for (const c of p.classes) {
		console.log(`  ${c.name}: ${c.patrols} patruller. ${c.podium.map((r) => `${r.place}. ${r.number} ${r.name} (${r.total})`).join(', ')}`);
	}
	if (p.offRule.length) {
		console.log(`\n${p.offRule.length} poäng följer inte kontrollens nuvarande regler (importeras som de är):`);
		for (const o of p.offRule.slice(0, 20)) console.log(`  patrull ${o.patrol}, ${o.station}: ${o.points} + ${o.style} (${o.why})`);
	}
	if (p.skipped.length) {
		console.log(`\nHoppas över / att känna till:`);
		for (const s of p.skipped.slice(0, 20)) console.log(`  ${s}`);
	}
	console.log(p.rankingDiffs.length ? `\nRANKING SKILJER SIG FRÅN GOKAPP:\n  ${p.rankingDiffs.join('\n  ')}` : '\nRankingen stämmer med gokapp (lika patruller delar plats här).');

	if (!flag('commit')) {
		console.log('\nTorrkörning: inget sparat. Lägg till --commit för att importera.');
	} else {
		const r = await writeImport(pg, data, opts);
		console.log(`\nImporterat och arkiverat: /r/${r.slug} (serien /t/${r.series}).`);
	}
} catch (e) {
	fail(`Avbrutet, inget sparat: ${(e as Error).message}`);
} finally {
	await my.end();
	await pg.end();
}

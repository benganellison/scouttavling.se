/**
 * FULL COMPETITION LIFECYCLE on ONE new competition ("Livscykelhajk 2027"), through the UI only.
 * The database is only read at the very end to verify what the UI did.
 *
 *   cd apps/web && npm run db:reset
 *   ORIGIN=http://localhost:5210 npx vite build
 *   PORT=5210 ORIGIN=http://localhost:5210 DEV_LOGIN=1 GRANT_SIGNING_KEY="$(cat .dev-grant-key.pem)" \
 *     node --env-file=.env build/index.js > .uat-server.log 2>&1 & echo $! > .uat-server.pid
 *   npx playwright test -c e2e/lifecycle.config.ts
 *   kill $(cat .uat-server.pid)
 *
 * Screenshots: e2e/lifecycle/NN-name.png. Videos: e2e/lifecycle-results/<actor>/ (copied to e2e/lifecycle/videos/).
 * All names and numbers are invented.
 */
import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

try {
	process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)));
} catch {
	/* env already set */
}

const BASE = 'http://localhost:5210';
const SHOTS = 'e2e/lifecycle';
const RESULTS = 'e2e/lifecycle-results';
mkdirSync(SHOTS, { recursive: true });
const NAME = 'Livscykelhajk 2027';
const SLUG = 'livscykelhajk-2027';
const ADMIN = `/admin/${SLUG}`;

const PHONE = { width: 390, height: 844 };
const TABLET = { width: 1194, height: 834 };
const DESKTOP = { width: 1440, height: 900 };

// ------------------------------------------------------------------ the plan (independent of the app)
type PS = [number, number];
interface Plan {
	nr: number;
	name: string;
	cls: 'Upptäckare' | 'Utmanare';
	troop: string;
	F1?: PS;
	F2?: PS;
	/** Day-2 start LS: scored item "Chiffer" (0–20 + style); the check-in item on LS gives no points. */
	LS?: PS;
	L1?: PS;
	L2?: PS;
	/** Nödbrev (0/20), Händighet (0–20), Orientering count (×2). */
	mal?: [number, number, number];
}
const PLAN: Plan[] = [
	{ nr: 101, name: 'Ekorrarna', cls: 'Upptäckare', troop: 'Påhittsby scoutkår', F1: [15, 3], F2: [12, 2], LS: [11, 3], L1: [14, 4], L2: [10, 2], mal: [20, 12, 6] },
	{ nr: 102, name: 'Mårdarna', cls: 'Upptäckare', troop: 'Hittepå scoutkår', F1: [15, 3], F2: [12, 2], LS: [11, 3], L1: [14, 4], L2: [10, 2], mal: [20, 12, 6] }, // designed tie with 101
	{ nr: 103, name: 'Grodorna', cls: 'Upptäckare', troop: 'Påhittsby scoutkår', F1: [18, 5], F2: [16, 4], LS: [16, 4], L1: [17, 5], L2: [15, 4], mal: [20, 15, 8] },
	{ nr: 104, name: 'Vargarna', cls: 'Utmanare', troop: 'Låtsasby scoutkår', F1: [19, 5], F2: [17, 4], LS: [18, 5], L1: [18, 3], L2: [16, 5], mal: [20, 18, 9] },
	{ nr: 105, name: 'Lodjuren', cls: 'Utmanare', troop: 'Hittepå scoutkår', F1: [14, 2], F2: [15, 3], LS: [9, 2], L1: [13, 2], L2: [12, 3], mal: [0, 14, 7] },
	{ nr: 106, name: 'Örnarna', cls: 'Utmanare', troop: 'Låtsasby scoutkår' }, // Återbud on day 2, never scored
	{ nr: 107, name: 'Sniglarna', cls: 'Upptäckare', troop: 'Snigelbo scoutkår', F1: [8, 1], F2: [9, 2], LS: [5, 1], L1: [7, 1], L2: [6, 1], mal: [0, 8, 3] } // added by hand
];
/** HQ correction in step 8: 107 L2 6 + 1 → 7 + 1. The conflict in step 7 is resolved with "Behåll" (keeps 105 F2 15 + 3). */
const CORRECTED: Record<number, Partial<Plan>> = { 107: { L2: [7, 1] } };
const plan = (nr: number) => ({ ...PLAN.find((p) => p.nr === nr)!, ...(CORRECTED[nr] ?? {}) });

function expected(nr: number) {
	const p = plan(nr);
	let points = 0;
	let style = 0;
	for (const k of ['F1', 'F2', 'LS', 'L1', 'L2'] as const) if (p[k]) ((points += p[k]![0]), (style += p[k]![1]));
	if (p.mal) points += p.mal[0] + p.mal[1] + p.mal[2] * 2;
	return { points, style, total: points + style };
}
/**
 * Hand-written expected results (FM/LS check-ins add 0 points):
 * Upptäckare 103 Grodorna 155 (1), 101 Ekorrarna 120 (2), 102 Mårdarna 120 (2, exact tie), 107 Sniglarna 56 (4);
 * Utmanare 104 Vargarna 166 (1), 105 Lodjuren 103 (2); 106 Örnarna Återbud, never scored.
 */
const EXPECTED_TOTALS: Record<number, number> = { 103: 155, 101: 120, 102: 120, 107: 56, 104: 166, 105: 103 };
const EXPECTED_PLACES: Record<number, number> = { 103: 1, 101: 2, 102: 2, 107: 4, 104: 1, 105: 2 };

// ------------------------------------------------------------------ helpers
const shot = (page: Page, name: string, fullPage = false) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage });
const beat = (page: Page, ms = 500) => page.waitForTimeout(ms);
const open: BrowserContext[] = [];
const findings: string[] = [];

async function actor(browser: Browser, name: string, viewport: { width: number; height: number }, touch = false) {
	const ctx = await browser.newContext({
		viewport,
		locale: 'sv-SE',
		timezoneId: 'Europe/Stockholm',
		baseURL: BASE,
		isMobile: touch && viewport.width < 600,
		hasTouch: touch,
		acceptDownloads: true,
		recordVideo: { dir: `${RESULTS}/${name}`, size: viewport }
	});
	open.push(ctx);
	return { ctx, page: await ctx.newPage() };
}

async function join(p: Page, link: string, name: string) {
	await p.goto(link);
	await p.getByLabel('Vad heter du?').pressSequentially(name, { delay: 50 });
	await p.getByRole('button', { name: 'Öppna min kontroll' }).click();
	await expect(p).toHaveURL(/\/f\/livscykelhajk-2027(\/desk)?$/);
}

async function toScan(p: Page, nr: number) {
	const scanLink = p.getByRole('link', { name: /Skanna patrull/ });
	if (await scanLink.isVisible().catch(() => false)) await scanLink.click();
	await p.getByRole('tab', { name: 'Nummer' }).click();
	for (const d of String(nr)) await p.getByRole('button', { name: d, exact: true }).click();
	await p.getByRole('button', { name: new RegExp(`^${nr}`) }).click();
	await p.getByRole('button', { name: /Ja, sätt poäng|Ändra poäng/ }).click();
}

/** Scores one RANGE station with style; leaves the phone on the "Sparat!" screen → next scan. */
async function scoreStation(p: Page, nr: number, [pts, st]: PS, shotName?: string) {
	await toScan(p, nr);
	await p.getByRole('button', { name: String(pts), exact: true }).click();
	await p.getByRole('button', { name: `Stil ${st}` }).click();
	await beat(p, 250);
	if (shotName) await shot(p, shotName);
	await p.getByRole('button', { name: `Spara ${pts} + ${st} = ${pts + st} p` }).click();
	await expect(p.getByText('Sparat!')).toBeVisible();
	await beat(p, 300);
	await p.getByRole('link', { name: 'Skanna nästa patrull' }).click();
}

async function scoreMal(p: Page, nr: number, [nod, hand, count]: [number, number, number], shotName?: string) {
	await toScan(p, nr);
	await expect(p.getByText('Målregistrering')).toBeVisible();
	await p.getByRole('button', { name: nod === 20 ? 'Oöppnat · 20 p' : '0 p', exact: true }).click();
	await p.getByRole('button', { name: String(hand), exact: true }).click();
	for (let i = 0; i < count; i++) await p.getByRole('button', { name: 'Öka Orientering' }).click();
	await expect(p.getByText(`→ ${count * 2} p`)).toBeVisible();
	if (shotName) await shot(p, shotName);
	await p.getByRole('button', { name: `Spara ${nod + hand + count * 2} p` }).click();
	await expect(p.getByText('Sparat!')).toBeVisible();
	await beat(p, 300);
	await p.getByRole('link', { name: 'Skanna nästa patrull' }).click();
}

async function home(p: Page) {
	await p.getByRole('link', { name: 'Stäng' }).click();
	await expect(p.getByRole('link', { name: /Skanna patrull/ })).toBeVisible();
}

async function goOnline(ctx: BrowserContext, p: Page, pill: string | RegExp = 'Synkad') {
	await ctx.setOffline(false);
	await p.evaluate(() => dispatchEvent(new Event('online')));
	await expect(p.getByTestId('sync-pill')).toContainText(pill, { timeout: 40_000 });
}

const nav = (p: Page, name: string) => p.getByRole('navigation', { name: 'Tävlingsmeny' }).getByRole('link', { name, exact: true }).click();

// ------------------------------------------------------------------ shared state across the serial steps
let bengt: Page;
const links: Record<string, string> = {};
const phones: Record<string, { ctx: BrowserContext; page: Page }> = {};

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ browser }) => {
	const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
	await sql`delete from competition where slug = ${SLUG}`; // repeatable runs (and the 5/day creation limit)
	await sql.end();
	bengt = (await actor(browser, '00-bengt-organiser', DESKTOP)).page;
});

test.afterEach(async ({}, info) => {
	if (info.status !== info.expectedStatus) {
		let i = 0;
		for (const c of open) for (const p of c.pages()) await p.screenshot({ path: info.outputPath(`failure-${i++}.png`) }).catch(() => undefined);
	}
});

test.afterAll(async () => {
	for (const c of open.splice(0)) await c.close().catch(() => undefined);
	if (findings.length) console.log('FINDINGS\n- ' + findings.join('\n- '));
});

// ------------------------------------------------------------------ 1
test('1 organiser creates the competition and shapes the stations', async () => {
	const p = bengt;
	await p.goto('/login');
	await p.getByRole('button', { name: /Logga in som Bengt/ }).click();
	await p.waitForURL(/\/admin$/);
	await p.getByRole('link', { name: 'Ny tävling' }).click();
	await p.getByLabel('Namn', { exact: true }).pressSequentially(NAME, { delay: 40 });
	await expect(p.getByText(new RegExp(`^[\\w.:-]+/${SLUG}$`)).first()).toBeVisible();
	await p.getByRole('radio', { name: /Flera dagar/ }).check();
	await p.getByLabel('Första dagen').fill('2027-06-11');
	await p.getByLabel('Sista dagen').fill('2027-06-12');
	await expect(p.getByText('2 dagar skapas')).toBeVisible();
	await p.getByLabel('Plats').fill('Påhittsskogen');
	await p.getByLabel('Telefon till tävlingsledningen under dagen').fill('070-111 22 33');
	for (const t of ['Spårare', 'Äventyrare']) await p.locator('label.chip', { hasText: t }).click();
	await p.getByLabel('Antal kontroller').fill('4');
	await expect(p.getByText('Poäng 0–20 + stil 0–5')).toBeVisible();
	await shot(p, '01-wizard', true);
	await p.getByRole('button', { name: `Skapa ${NAME}` }).click();
	await expect(p).toHaveURL(new RegExp(`${ADMIN}$`));

	await nav(p, 'Kontroller');
	const list = p.getByRole('navigation', { name: 'Kontroller' });
	await expect(list.locator('.code')).toHaveCount(8);
	const codes = (await list.locator('.code').allTextContents()).map((c) => c.trim());
	console.log('WIZARD codes: ' + codes.join(' '));
	expect(codes).toEqual(['FS', 'F1', 'F2', 'FM', 'LS', 'L1', 'L2', 'LM']);
	const names = (await list.locator('.nm').allTextContents()).map((c) => c.trim());
	console.log('WIZARD names: ' + names.join(' | '));
	await shot(p, '02-stations-from-wizard');

	const select = async (code: string) => {
		await list.locator('a.pick', { has: p.locator('.code', { hasText: new RegExp(`^${code}$`) }) }).click();
		await expect(p.locator('#ed-title .code')).toHaveText(code);
		await p.waitForLoadState('networkidle');
	};
	const save = async () => {
		await p.getByRole('button', { name: 'Spara kontrollen' }).click();
		await expect(p.getByRole('status').filter({ hasText: 'Sparat' })).toBeVisible();
	};
	for (const [code, name] of [['F1', 'Eldstaden'], ['F2', 'Knopar'], ['L1', 'Kanoten'], ['L2', 'Första hjälpen']] as const) {
		await select(code);
		await p.locator('#st-name').fill(name);
		await p.locator('#it-0-name').fill(name);
		await save();
		await expect(list.getByText(name, { exact: true })).toBeVisible();
	}

	// Day-2 start keeps its check-in item and gets a scored item "Chiffer" (style on, like the competition default).
	await select('LS');
	await p.getByRole('button', { name: '+ Lägg till del' }).click();
	await p.locator('#it-1-name').fill('Chiffer');
	const chiffer = p.locator('li.item').nth(1);
	await expect(chiffer.locator('input[name="mode-1"][value="RANGE"]')).toBeChecked();
	await chiffer.getByText('Stilpoäng', { exact: true }).click();
	await expect(chiffer.locator('#it-1-smax')).toHaveValue('5');
	await shot(p, '03a-ls-chiffer-editor', true);
	await save();
	await expect(p.locator('#ed-title .code')).toHaveText('LS');
	await expect(list.locator('a.pick', { hasText: 'Lördag start' })).toContainText('2 delar');

	// Day 2 finish → "Mål" with 4 items.
	await select('LM');
	await p.locator('#st-name').fill('Mål');
	await p.locator('#it-0-name').fill('Målregistrering');
	await p.locator('input[name="mode-0"][value="AUTO_ON_SCAN"]').check({ force: true });
	await p.getByRole('button', { name: '+ Lägg till del' }).click();
	await p.locator('#it-1-name').fill('Nödbrev');
	await p.locator('input[name="mode-1"][value="DISTINCT"]').check({ force: true });
	for (const v of [5, 10, 15]) await p.getByRole('button', { name: `Ta bort värdet ${v}` }).click();
	await p.locator('#it-1-nv').fill('20');
	await p.locator('#it-1-nl').fill('Oöppnat');
	await p.getByRole('button', { name: '+ värde' }).click();
	await expect(p.getByRole('list', { name: 'Tillåtna poäng för Nödbrev' }).getByRole('listitem')).toHaveCount(2);
	await p.getByRole('button', { name: '+ Lägg till del' }).click();
	await p.locator('#it-2-name').fill('Händighet');
	await p.getByRole('button', { name: '+ Lägg till del' }).click();
	await p.locator('#it-3-name').fill('Orientering');
	await p.locator('input[name="mode-3"][value="COUNT"]').check({ force: true });
	await p.locator('#it-3-max').fill('10');
	await p.locator('#it-3-mult').fill('2');
	await shot(p, '03-mal-editor', true);
	await save();
	const finalCodes = (await list.locator('.code').allTextContents()).map((c) => c.trim());
	expect(finalCodes).toEqual(['FS', 'F1', 'F2', 'FM', 'LS', 'L1', 'L2', 'LM']);
	await expect(list.getByText('4 delar', { exact: false })).toBeVisible();
	await p.evaluate(() => scrollTo(0, 0));
	await shot(p, '04-stations-final');
});

// ------------------------------------------------------------------ 2
test('2 patrols: import with a blocked Personnummer column, add one by hand, edit it', async () => {
	const p = bengt;
	const imported = PLAN.filter((x) => x.nr <= 106);
	const csv = [
		'Patrullnamn;Klass;Kår;Kontaktperson;Mobil;Personnummer;Medlemmar',
		...imported.map((x, i) => `${x.name};${x.cls};${x.troop};Kontakt ${x.name};070-555 00 0${i};2012010${i}-123${i};"Alva ${x.name}\nBo ${x.name}"`)
	].join('\n');
	await nav(p, 'Importera');
	await p.waitForLoadState('networkidle');
	await p.locator('input[type=file]').setInputFiles({ name: 'anmalan.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf-8') });
	await expect(p.locator('section.never').getByText('Personnummer', { exact: true })).toBeVisible();
	await shot(p, '05-import-columns');
	await p.getByRole('button', { name: 'Granska', exact: true }).click();
	const commit = p.waitForRequest((r) => r.method() === 'POST' && r.url().includes('commit'));
	await p.getByRole('button', { name: /^Importera 6 patruller/ }).click();
	const body = (await commit).postData() ?? '';
	expect(body).not.toMatch(/2012010\d-123/);
	expect(body.toLowerCase()).not.toContain('personnummer');
	await expect(p.getByText('6 patruller importerade.')).toBeVisible();
	await shot(p, '06-import-done');

	await nav(p, 'Patruller');
	await p.getByRole('link', { name: '+ Lägg till patrull' }).click();
	await p.locator('#name').fill('Snigeln');
	await expect(p.locator('#number')).toHaveValue('107');
	await p.locator('#trackId').selectOption({ label: 'Utmanare' });
	await p.locator('#troop').fill('Snigelbo scoutkår');
	await shot(p, '07-patrol-new', true);
	await p.getByRole('button', { name: 'Lägg till patrull' }).click();
	await expect(p).toHaveURL(/patrols\?saved=107/);
	await p.getByRole('link', { name: 'Snigeln', exact: true }).click();
	await p.locator('#name').fill('Sniglarna');
	await p.locator('#trackId').selectOption({ label: 'Upptäckare' });
	await p.getByRole('button', { name: 'Spara ändringar' }).click();
	await expect(p.getByRole('link', { name: 'Sniglarna', exact: true })).toBeVisible();
	await shot(p, '08-patrols', true);
});

// ------------------------------------------------------------------ 3
test('3 distribute start stations and print', async () => {
	const p = bengt;
	await nav(p, 'Fördela start');
	await p.waitForLoadState('networkidle');
	await p.getByRole('button', { name: 'Spara fördelning' }).click();
	await expect(p.getByText(/Fördelningen är sparad för 7 patruller/)).toBeVisible();
	await shot(p, '09-distribution');
	await nav(p, 'Utskrifter');
	await p.getByRole('link', { name: 'Öppna poängkort' }).click();
	await expect(p.locator('section.scard')).toHaveCount(7);
	await shot(p, '10-scorecards');
	await p.pdf({ path: `${SHOTS}/scorecards.pdf`, format: 'A4', printBackground: true });
	await p.goto(`${ADMIN}/print/protocol`);
	await shot(p, '11-protocol');
	await p.goto(`${ADMIN}/print`);
});

// ------------------------------------------------------------------ 4
test('4 invites through the UI, then go live', async () => {
	const p = bengt;
	await nav(p, 'Funktionärer');
	for (const name of ['Fredag start', 'Eldstaden', 'Knopar', 'Fredag mål', 'Lördag start', 'Kanoten', 'Första hjälpen', 'Mål']) {
		await p.getByRole('link', { name: new RegExp(`^\\w+ ${name}$`) }).click();
		await expect(p.getByRole('heading', { name: new RegExp(`· ${name}$`) })).toBeVisible();
		await p.getByRole('button', { name: 'Skapa inbjudan' }).click();
		await expect(p.locator('#invlink')).toHaveValue(/\/j\//);
		links[name] = await p.locator('#invlink').inputValue();
		expect(links[name].startsWith(`${BASE}/j/`)).toBe(true);
	}
	await shot(p, '12-invite-mal');
	await p.getByRole('navigation', { name: 'Roll' }).getByRole('link', { name: 'Start & mål' }).click();
	await expect(p.getByRole('heading', { name: 'Start & mål', exact: true })).toBeVisible();
	await p.getByRole('button', { name: 'Skapa inbjudan' }).click();
	links.desk = await p.locator('#invlink').inputValue();
	await shot(p, '13-invite-desk');

	await nav(p, 'Översikt');
	await p.getByRole('button', { name: 'Gör tävlingen live' }).click();
	await expect(p.locator('.status.live').first()).toBeVisible();
	await shot(p, '14-overview-live');
});

// ------------------------------------------------------------------ 5
test('5 day 1: desk starts patrols, two volunteers score, one offline', async ({ browser }) => {
	const desk = await actor(browser, '01-per-desk', TABLET, true);
	phones.per = desk;
	await join(desk.page, links.desk, 'Per');
	await expect(desk.page.getByTestId('row-101')).toBeVisible();
	for (const x of PLAN) {
		await desk.page.getByLabel('Patrullnummer').fill(String(x.nr));
		await desk.page.getByRole('button', { name: 'Registrera' }).click();
		await expect(desk.page.getByTestId('last-scan')).toContainText(`${x.nr} · ${x.name}`);
		await expect(desk.page.getByTestId('last-scan')).toContainText('PÅ BANAN');
	}
	await shot(desk.page, '15-desk-day1');

	// Fredag start: Hugo checks every team in at the start of day 1.
	const hugo = await actor(browser, '11-hugo-FS-checkin', PHONE, true);
	await join(hugo.page, links['Fredag start'], 'Hugo');
	await expect(hugo.page.getByRole('heading', { name: 'FS · Fredag start' })).toBeVisible();
	for (const x of PLAN.filter((y) => y.F1)) {
		await toScan(hugo.page, x.nr);
		await hugo.page.getByRole('button', { name: `Checka in ${x.name}` }).click();
		await expect(hugo.page.getByText('Sparat!')).toBeVisible();
		await hugo.page.getByRole('link', { name: 'Skanna nästa patrull' }).click();
	}
	await home(hugo.page);
	await expect(hugo.page.getByTestId('sync-pill')).toContainText('Synkad', { timeout: 30_000 });
	await shot(hugo.page, '15a-fs-home');

	phones.anna = await actor(browser, '02-anna-F1', PHONE, true);
	phones.bo = await actor(browser, '03-bo-F2', PHONE, true);
	phones.cia = await actor(browser, '04-cia-F2-second-device', PHONE, true);
	await join(phones.anna.page, links.Eldstaden, 'Anna');
	await join(phones.bo.page, links.Knopar, 'Bo');
	await join(phones.cia.page, links.Knopar, 'Cia');
	await expect(phones.cia.page.getByTestId('sync-pill')).toContainText('Synkad');
	await expect(phones.anna.page.getByRole('heading', { name: 'F1 · Eldstaden' })).toBeVisible();
	await shot(phones.anna.page, '16-anna-home');
	// Cia's phone loses coverage now, with a pack that has no Knopar scores yet (stale base for step 7).
	await phones.cia.ctx.setOffline(true);

	const scorers = PLAN.filter((x) => x.F1);
	// Bo scores F2 for everyone, online.
	for (const [i, x] of scorers.entries()) await scoreStation(phones.bo.page, x.nr, x.F2!, i === 0 ? '17-bo-score' : undefined);
	await home(phones.bo.page);
	// Anna: two online, then no coverage for the rest.
	const a = phones.anna;
	await scoreStation(a.page, 101, plan(101).F1!);
	await scoreStation(a.page, 102, plan(102).F1!);
	await home(a.page);
	await expect(a.page.getByTestId('sync-pill')).toContainText('Synkad', { timeout: 30_000 });
	await a.ctx.setOffline(true);
	for (const x of scorers.slice(2)) await scoreStation(a.page, x.nr, x.F1!);
	await home(a.page);
	await expect(a.page.getByTestId('sync-pill')).toContainText('4 väntar', { timeout: 30_000 });
	await a.page.getByRole('link', { name: 'Logg' }).click();
	await expect(a.page.getByText('4 rapporter väntar')).toBeVisible();
	await shot(a.page, '18-anna-offline-log');
	// Anna stays without coverage until after Fredag mål: her Friday reports arrive late (below).

	// Fredag mål: Fia checks in every patrol that finishes day 1 (checkpoint, no points).
	const fia = await actor(browser, '09-fia-FM-checkin', PHONE, true);
	phones.fia = fia;
	await join(fia.page, links['Fredag mål'], 'Fia');
	await expect(fia.page.getByRole('heading', { name: 'FM · Fredag mål' })).toBeVisible();
	for (const [i, x] of scorers.entries()) {
		await toScan(fia.page, x.nr);
		await expect(fia.page.getByText('Checkpoint · inga poäng')).toBeVisible();
		if (i === 0) await shot(fia.page, '19a-fm-checkin');
		await fia.page.getByRole('button', { name: `Checka in ${x.name}` }).click();
		await expect(fia.page.getByText('Sparat!')).toBeVisible();
		if (i === 0) await shot(fia.page, '19b-fm-checked-in');
		await fia.page.getByRole('link', { name: 'Skanna nästa patrull' }).click();
	}
	await home(fia.page);
	await expect(fia.page.getByTestId('sync-pill')).toContainText('Synkad', { timeout: 30_000 });
	await shot(fia.page, '19c-fm-home');

	// Day 1 is over for them: the FM check-in puts every patrol "I läger" (not I mål, not På banan).
	const d = desk.page;
	for (const x of scorers) {
		await expect(d.getByTestId(`row-${x.nr}`).getByRole('radio', { name: 'I läger' })).toHaveAttribute('aria-checked', 'true', { timeout: 40_000 });
	}
	await expect(d.getByTestId('row-106').getByRole('radio', { name: 'På banan' })).toHaveAttribute('aria-checked', 'true');
	await expect(d.getByTestId('row-101')).toContainText(/Klar \d\d:\d\d/);
	await shot(d, '19d-desk-i-lager');

	// HQ: KPI and no "inte sedd" alarm for a patrol in camp (live.test.ts covers the 45-minute rule itself).
	const hq = bengt;
	await hq.goto(`${ADMIN}/live`);
	await expect(hq.locator('.kpi', { hasText: 'I läger' }).locator('.v')).toHaveText(String(scorers.length));
	await expect(hq.locator('.kpi', { hasText: 'På banan' }).locator('.v')).toHaveText('1'); // 106, never scored
	for (const x of scorers) await expect(hq.getByText(new RegExp(`^${x.nr} .* inte sedd`))).toHaveCount(0);
	await shot(hq, '19e-hq-i-lager');

	// Anna's late Friday reports (scored before FM, synced after) must not send anyone back "På banan".
	await goOnline(a.ctx, a.page);
	await shot(a.page, '19-anna-synced');
	await a.page.getByRole('link', { name: 'Kontroll' }).click();
	await beat(d, 1500);
	for (const x of scorers) {
		await expect(d.getByTestId(`row-${x.nr}`).getByRole('radio', { name: 'I läger' })).toHaveAttribute('aria-checked', 'true', { timeout: 20_000 });
	}
	await hq.reload();
	await expect(hq.locator('.kpi', { hasText: 'I läger' }).locator('.v')).toHaveText(String(scorers.length));
});

// ------------------------------------------------------------------ 6/7 conflict
test('6 (step 7) conflict: a stale offline device scores 105 at Knopar differently; HQ keeps the first value', async () => {
	const c = phones.cia;
	await scoreStation(c.page, 105, [13, 1], '20-cia-offline-stale-score');
	await home(c.page);
	await goOnline(c.ctx, c.page, 'Konflikt'); // the phone tells Cia that HQ must decide
	await shot(c.page, '21-cia-after-sync');
	await c.page.getByRole('link', { name: 'Logg' }).click();
	await shot(c.page, '21b-cia-log-conflict');

	const p = bengt;
	await p.goto(`${ADMIN}/conflicts`);
	const card = p.getByTestId('conflict').first();
	await expect(card).toContainText('105 Lodjuren', { timeout: 30_000 });
	await expect(card).toContainText('15 + 3');
	await expect(card).toContainText('13 + 1');
	await shot(p, '22-conflict');
	await card.getByRole('button', { name: 'Behåll' }).click();
	await expect(p.getByTestId('conflict')).toHaveCount(0);
	await shot(p, '23-conflict-resolved');
});

// ------------------------------------------------------------------ 6 day 2 (+ HQ live)
test('7 (step 6) day 2: volunteers score, HQ sees it live, Mål sets I mål, desk finishes and marks Återbud', async ({ browser }) => {
	const p = bengt;
	await p.goto(`${ADMIN}/live`);
	await expect(p.getByTestId('live-status')).toHaveAttribute('data-status', 'open', { timeout: 20_000 });
	const navs: string[] = [];
	p.on('framenavigated', (f) => f === p.mainFrame() && navs.push(f.url()));

	// Lördag start: Gus registers each patrol at the day-2 start and scores Chiffer on the same screen.
	const gus = await actor(browser, '10-gus-LS-chiffer', PHONE, true);
	phones.gus = gus;
	await join(gus.page, links['Lördag start'], 'Gus');
	await expect(gus.page.getByRole('heading', { name: 'LS · Lördag start' })).toBeVisible();
	for (const [i, x] of PLAN.filter((y) => y.LS).entries()) await scoreStation(gus.page, x.nr, x.LS!, i === 0 ? '23a-ls-chiffer-phone' : undefined);
	await home(gus.page);
	await expect(gus.page.getByTestId('sync-pill')).toContainText('Synkad', { timeout: 30_000 });
	// Day 2 has begun: the LS check-in + Chiffer brings them back "På banan".
	const d = phones.per.page;
	for (const x of PLAN.filter((y) => y.LS)) {
		await expect(d.getByTestId(`row-${x.nr}`).getByRole('radio', { name: 'På banan' })).toHaveAttribute('aria-checked', 'true', { timeout: 40_000 });
	}
	await expect(p.locator('.kpi', { hasText: 'I läger' }).locator('.v')).toHaveText('0', { timeout: 20_000 });

	phones.dan = await actor(browser, '05-dan-L1', PHONE, true);
	phones.eva = await actor(browser, '06-eva-L2', PHONE, true);
	phones.lena = await actor(browser, '07-lena-mal', PHONE, true);
	await join(phones.dan.page, links.Kanoten, 'Dan');
	await join(phones.eva.page, links['Första hjälpen'], 'Eva');
	await join(phones.lena.page, links['Mål'], 'Lena');

	const scorers = PLAN.filter((x) => x.F1);
	await scoreStation(phones.dan.page, 101, plan(101).L1!);
	const feed = p.getByTestId('feed').locator('li').first();
	await expect(feed).toContainText('101 Ekorrarna');
	await expect(feed).toContainText(`${plan(101).L1![0]} + ${plan(101).L1![1]}`);
	expect(navs, 'HQ updated without reload').toHaveLength(0);
	await shot(p, '24-hq-live');
	for (const x of scorers.slice(1)) await scoreStation(phones.dan.page, x.nr, x.L1!);
	await home(phones.dan.page);
	for (const x of scorers) await scoreStation(phones.eva.page, x.nr, PLAN.find((y) => y.nr === x.nr)!.L2!); // as entered (107 corrected later by HQ)
	await home(phones.eva.page);

	// Desk: 106 drops out; 107 arrives at the desk before Mål.
	await d.getByTestId('row-106').getByRole('radio', { name: 'Återbud' }).click();
	await d.getByLabel('Patrullnummer').fill('107');
	await d.getByRole('button', { name: 'Registrera' }).click();
	await expect(d.getByTestId('last-scan')).toContainText('I MÅL');

	for (const [i, x] of scorers.entries()) await scoreMal(phones.lena.page, x.nr, x.mal!, i === 0 ? '25-mal-score' : undefined);
	await home(phones.lena.page);
	await shot(phones.lena.page, '26-mal-home');
	// The desk sees Mål's automatic I mål arrive.
	await expect(d.getByTestId('row-103').getByRole('radio', { name: 'I mål' })).toHaveAttribute('aria-checked', 'true', { timeout: 40_000 });
	await expect(d.getByTestId('row-106').getByRole('radio', { name: 'Återbud' })).toHaveAttribute('aria-checked', 'true');
	await shot(d, '27-desk-day2');
	await shot(p, '28-hq-after-day2');
});

// ------------------------------------------------------------------ 8 HQ
test('8 HQ: correction with reason, message with read receipt, backup mode on/off', async () => {
	const p = bengt;
	await p.goto(`${ADMIN}/patrol/107`);
	await expect(p.getByRole('heading', { name: 'Sniglarna' })).toBeVisible();
	await expect(async () => {
		if (!(await p.locator('form.item').count())) await p.locator('button.cell[data-code="L2"]').click();
		await expect(p.locator('form.item').first()).toBeVisible({ timeout: 1000 });
	}).toPass({ timeout: 15_000 });
	const form = p.locator('form.item').first();
	await form.locator('label.chip', { hasText: /^\s*7\s*$/ }).first().click();
	await form.getByLabel('Anledning').fill('fel siffra på lappen');
	await form.getByRole('button', { name: 'Spara ändring' }).click();
	await expect(p.getByTestId('timeline')).toContainText('L2 ändrad av Bengt · var 6 + 1 → 7 + 1');
	await expect(p.getByTestId('timeline')).toContainText('fel siffra på lappen');
	await shot(p, '29-patrol-correction', true);

	await nav(p, 'Meddelanden');
	await p.waitForLoadState('networkidle');
	await p.getByLabel('Rubrik').fill('Lunch vid Mål kl 12');
	await p.getByRole('textbox', { name: 'Meddelande' }).fill('Ta med egen mugg.');
	await p.getByRole('button', { name: 'Skicka meddelande' }).click();
	const sent = p.getByTestId('sent-message').first();
	await expect(sent).toContainText(/0 av \d+/);
	const total = Number((await sent.locator('.receipt strong').textContent())!.split(' av ')[1]);
	const bo = phones.bo.page;
	await expect(bo.getByText('Nytt från ledningen:')).toBeVisible({ timeout: 40_000 });
	await bo.getByRole('navigation', { name: 'Huvudmeny' }).getByRole('link', { name: /Meddelanden/ }).click();
	await bo.getByRole('button', { name: /Lunch vid Mål/ }).click();
	await expect(bo.getByText('Ta med egen mugg.')).toBeVisible();
	await shot(bo, '30-bo-message');
	await expect(sent).toContainText(`1 av ${total}`, { timeout: 30_000 });
	await shot(p, '31-messages-receipt');

	await nav(p, 'Ledningscentral');
	await p.getByRole('button', { name: 'Starta reservläge' }).click();
	await expect(p.getByRole('button', { name: 'Avsluta reservläge' })).toBeVisible();
	await shot(p, '32-hq-backup-on');
	const eva = phones.eva.page;
	await expect(eva.getByText('Reservläge:')).toBeVisible({ timeout: 40_000 });
	await shot(eva, '33-eva-backup-banner');
	await p.getByRole('button', { name: 'Avsluta reservläge' }).click();
	await expect(p.getByRole('button', { name: 'Starta reservläge' })).toBeVisible();
	await expect(eva.getByText('Reservläge:')).toHaveCount(0, { timeout: 40_000 });
});

// ------------------------------------------------------------------ 9 after
test('9 results vs independent calculation, public page, ceremony, close, CSV', async ({ browser }) => {
	const p = bengt;
	await nav(p, 'Resultat');
	for (const cls of ['Upptäckare', 'Utmanare'] as const) {
		await p.getByRole('link', { name: new RegExp(`^${cls}`) }).click();
		for (const x of PLAN.filter((y) => y.cls === cls && y.F1)) {
			const row = p.locator(`[data-testid="result-row"][data-number="${x.nr}"]`);
			await expect(row).toHaveAttribute('data-place', String(EXPECTED_PLACES[x.nr]));
			const e = expected(x.nr);
			expect(e.total, `independent total for ${x.nr}`).toBe(EXPECTED_TOTALS[x.nr]);
			await expect(row).toContainText(String(e.total));
			await expect(row, 'every station visited: FS, F1, F2, FM, LS, L1, L2, LM').toContainText('8/8');
			console.log(`RESULT ${cls} ${x.nr}: ` + (await row.innerText()).replace(/\s+/g, ' '));
			await expect(row).toContainText(`${e.points} + ${e.style} stil`);
		}
		if (cls === 'Upptäckare') await expect(p.locator('[data-testid="result-row"][data-number="101"]')).toContainText('Delad plats med 102');
		await shot(p, `34-results-${cls === 'Upptäckare' ? 'upptackare' : 'utmanare'}`, true);
	}
	const resignedRow = p.locator('[data-testid="result-row"][data-number="106"]');
	console.log('106 rows in results: ' + (await resignedRow.count()));

	// Publish → public page on a phone.
	await p.getByRole('button', { name: 'Publicera resultat' }).click();
	await expect(p.getByText('Publicerat', { exact: true })).toBeVisible();
	const pub = await actor(browser, '08-public-phone', PHONE, true);
	await pub.page.goto(`/r/${SLUG}`);
	await expect(async () => {
		await pub.page.getByRole('button', { name: 'Upptäckare' }).click();
		await expect(pub.page.locator('[data-testid="public-list"] li[data-number="101"]')).toHaveAttribute('data-place', '2', { timeout: 1000 });
	}).toPass({ timeout: 15_000 });
	await expect(pub.page.locator('[data-testid="public-list"] li[data-number="103"]')).toHaveAttribute('data-place', '1');
	expect(await pub.page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
	await shot(pub.page, '35-public-results', true);

	// Ceremony.
	await p.getByRole('link', { name: /^Upptäckare/ }).click();
	await nav(p, 'Prisutdelning'); // sidebar → class picker
	await shot(p, '36a-ceremony-pick');
	await p.getByRole('link', { name: /Upptäckare/ }).click();
	await expect(p.getByTestId('reveal-card')).toContainText('Strax dags');
	for (let i = 0; i < 5 && !(await p.getByRole('button', { name: 'Avslöja vinnaren' }).isVisible()); i++) {
		await p.keyboard.press('ArrowRight');
		await beat(p, 600);
	}
	await p.getByRole('button', { name: 'Avslöja vinnaren' }).click();
	await expect(p.getByTestId('reveal-name')).toHaveText('Grodorna');
	await shot(p, '36b-ceremony-winner');

	// Close the competition.
	await p.goto(ADMIN);
	await p.getByRole('button', { name: 'Avsluta' }).click();
	await expect(p.locator('.status.closed').first()).toHaveText('Avslutad');
	await shot(p, '37-overview-closed');

	// A volunteer tries to change a score after the competition is closed: it must not reach the results (step 10 checks totals),
	// but it is kept for HQ's review instead of being dropped (step 10 checks that too).
	const bo = phones.bo.page;
	await bo.getByRole('navigation', { name: 'Huvudmeny' }).getByRole('link', { name: 'Kontroll' }).click();
	await toScan(bo, 101);
	await bo.getByRole('button', { name: '13', exact: true }).click();
	await bo.getByRole('button', { name: 'Stil 2' }).click();
	await bo.getByRole('button', { name: 'Spara 13 + 2 = 15 p' }).click();
	await expect(bo.getByText('Sparat!')).toBeVisible();
	await bo.getByRole('link', { name: 'Skanna nästa patrull' }).click();
	await home(bo);
	await expect(bo.getByTestId('sync-pill')).not.toContainText('väntar', { timeout: 30_000 });
	await beat(bo, 1500);
	console.log('AFTER-CLOSE pill: ' + (await bo.getByTestId('sync-pill').textContent()));
	await shot(bo, '38-bo-after-close');
	await bo.getByRole('link', { name: 'Logg' }).click();
	await shot(bo, '39-bo-log-after-close');

	// CSV export.
	await nav(p, 'Resultat');
	const dl = p.waitForEvent('download');
	await p.getByRole('link', { name: /Exportera CSV/ }).click();
	const file = await (await dl).path();
	const text = readFileSync(file!, 'utf8').replace(/^﻿/, '');
	const [head, ...rows] = text.trim().split(/\r?\n/).map((l) => l.split(';'));
	expect(head.slice(0, 8)).toEqual(['Klass', 'Placering', 'Nummer', 'Patrull', 'Kår', 'Totalt', 'Poäng', 'Stil']);
	for (const x of PLAN.filter((y) => y.F1)) {
		const r = rows.find((c) => c[2] === String(x.nr));
		expect(r, `CSV row for ${x.nr}`).toBeTruthy();
		const e = expected(x.nr);
		expect([r![0], r![1], r![5], r![6], r![7]]).toEqual([x.cls, String(EXPECTED_PLACES[x.nr]), String(e.total), String(e.points), String(e.style)]);
	}
	console.log('CSV\n' + text);
});

// ------------------------------------------------------------------ 10 DB verification only
test('10 database agrees with what the UI did', async () => {
	const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
	try {
		const [c] = await sql`select id, status, public_results from competition where slug = ${SLUG}`;
		expect(c.status).toBe('closed');
		const st = await sql`select number, status from patrol where competition_id = ${c.id} order by number`;
		expect(Object.fromEntries(st.map((r) => [r.number, r.status]))).toEqual({ 101: 'finished', 102: 'finished', 103: 'finished', 104: 'finished', 105: 'finished', 106: 'resigned', 107: 'finished' });
		const sc = await sql`select p.number, count(*)::int n, sum(s.points)::int pts, sum(s.style_points)::int sty
			from score s join patrol p on p.id = s.patrol_id where s.competition_id = ${c.id} and s.state = 'active' group by p.number order by p.number`;
		for (const r of sc) {
			const e = expected(r.number);
			expect([r.number, r.pts, r.sty]).toEqual([r.number, e.points, e.style]);
			expect(r.n).toBe(12); // FS check-in, F1, F2, FM check-in, LS check-in + Chiffer, L1, L2, 4 Mål items
		}
		expect(sc.map((r) => r.number)).toEqual([101, 102, 103, 104, 105, 107]);
		const open = await sql`select kind, incoming->>'reason' as reason from score_conflict where competition_id = ${c.id} and status = 'open'`;
		expect(open.map((r) => [r.kind, r.reason])).toEqual([['quarantine', 'Tävlingen är avslutad']]);
	} finally {
		await sql.end();
	}
});

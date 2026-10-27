/**
 * UAT: real user journeys on the PRODUCTION build, recorded as videos.
 *
 *   cd apps/web && npm run db:reset && ORIGIN=http://localhost:5210 npx vite build
 *   PORT=5210 ORIGIN=http://localhost:5210 DEV_LOGIN=1 BODY_SIZE_LIMIT=3M GRANT_SIGNING_KEY="$(cat .dev-grant-key.pem)" node --env-file=.env build/index.js > .uat-server.log 2>&1 & echo $! > .uat-server.pid
 *   npx playwright test -c e2e/uat.config.ts
 *   kill $(cat .uat-server.pid)
 *
 * Screenshots: e2e/uat/NN-name.png. Videos: e2e/uat-results/** (copied to e2e/uat/videos/ afterwards).
 * Scenarios run in order on one seed: 2 and 5 score 112 and 137 equally, so their tie in 6 holds.
 * All data is invented.
 */
import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { SLUG, clearScores, createInvite, scoresFor, setStatus, sql, statusOf } from './field-db.ts';

const BASE = 'http://localhost:5210';
const SHOTS = 'e2e/uat';
const RESULTS = 'e2e/uat-results';
mkdirSync(SHOTS, { recursive: true });

const PHONE = { width: 390, height: 844 };
const TABLET = { width: 1194, height: 834 };
const DESKTOP = { width: 1440, height: 900 };

const shot = (page: Page, name: string, fullPage = false) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage });
const beat = (page: Page, ms = 700) => page.waitForTimeout(ms);

const open: BrowserContext[] = [];
/** Each actor gets its own context and a video at its own viewport size (`video` in config can't vary per test). */
async function actor(browser: Browser, name: string, viewport: { width: number; height: number }, touch = false) {
	const ctx = await browser.newContext({
		viewport,
		locale: 'sv-SE',
		timezoneId: 'Europe/Stockholm',
		baseURL: BASE,
		isMobile: touch && viewport.width < 600,
		hasTouch: touch,
		recordVideo: { dir: `${RESULTS}/${name}`, size: viewport }
	});
	open.push(ctx);
	return { ctx, page: await ctx.newPage() };
}

test.afterEach(async ({}, info) => {
	if (info.status !== info.expectedStatus) {
		let i = 0;
		for (const c of open) for (const p of c.pages()) await p.screenshot({ path: info.outputPath(`failure-${i++}.png`) }).catch(() => undefined);
	}
	for (const c of open.splice(0)) await c.close().catch(() => undefined);
});

async function loginBengt(page: Page) {
	await page.goto('/login');
	await beat(page, 400);
	await page.getByRole('button', { name: /Logga in som Bengt/ }).click();
	await page.waitForURL(/\/admin$/);
}

async function join(p: Page, secret: string, name: string) {
	await p.goto(`/j/${secret}`);
	await beat(p);
	await p.getByLabel('Vad heter du?').pressSequentially(name, { delay: 60 });
	await beat(p, 400);
	await p.getByRole('button', { name: 'Öppna min kontroll' }).click();
}

async function pickByNumber(p: Page, nr: number) {
	await p.getByRole('link', { name: /Skanna patrull/ }).click();
	await p.getByRole('tab', { name: 'Nummer' }).click();
	for (const d of String(nr)) {
		await p.getByRole('button', { name: d, exact: true }).click();
		await beat(p, 250);
	}
	await p.getByRole('button', { name: new RegExp(`^${nr}`) }).click();
	await beat(p, 500);
}

async function scoreRange(p: Page, nr: number, points: number, style: number, name?: string) {
	await pickByNumber(p, nr);
	await p.getByRole('button', { name: /Ja, sätt poäng|Ändra poäng/ }).click();
	await beat(p, 400);
	await p.getByRole('button', { name: String(points), exact: true }).click();
	await beat(p, 300);
	await p.getByRole('button', { name: `Stil ${style}` }).click();
	await beat(p, 400);
	if (name) await shot(p, name);
	await p.getByRole('button', { name: `Spara ${points} + ${style} = ${points + style} p` }).click();
	await expect(p.getByText('Sparat!')).toBeVisible();
	await beat(p, 600);
}

async function backHome(p: Page) {
	await p.getByRole('link', { name: 'Skanna nästa patrull' }).click();
	await p.getByRole('link', { name: 'Stäng' }).click();
	await beat(p, 400);
}

test.afterAll(async () => {
	await sql.end();
});

// ---------------------------------------------------------------- 1
test.describe('1 organiser prepares', () => {

	test('organiser prepares a 2-day competition', async ({ browser }) => {
		const { page } = await actor(browser, '01-organiser', DESKTOP, false);
		await sql`delete from competition where slug like 'uat-%'`;
		await loginBengt(page);
		await expect(page.getByRole('heading', { name: 'Mina tävlingar' })).toBeVisible();
		await shot(page, '01-admin-start');

		// Wizard
		await page.getByRole('link', { name: 'Ny tävling' }).click();
		await page.getByLabel('Namn', { exact: true }).pressSequentially('UAT Vårhajk', { delay: 50 });
		await expect(page.locator('#name-help')).toContainText(/[\w.:-]+\/uat-varhajk/);
		await page.getByRole('radio', { name: /Flera dagar/ }).check();
		await page.getByLabel('Första dagen').fill('2027-05-15');
		await page.getByLabel('Sista dagen').fill('2027-05-16');
		await expect(page.getByText('2 dagar skapas')).toBeVisible();
		await page.getByLabel('Plats').fill('Påhittsskogen');
		await page.getByLabel('Telefon till tävlingsledningen under dagen').fill('070-111 22 33');
		await beat(page);
		// Classes: keep Upptäckare + Utmanare only.
		for (const t of ['Spårare', 'Äventyrare']) await page.locator('label.chip', { hasText: t }).click();
		await beat(page);
		await page.getByLabel('Antal kontroller').fill('6');
		await expect(page.getByText('Poäng 0–20 + stil 0–5')).toBeVisible(); // style on
		await shot(page, '02-wizard', true);
		await page.getByRole('button', { name: /^Skapa UAT Vårhajk/ }).click();
		await expect(page).toHaveURL(/\/admin\/uat-varhajk$/);
		await expect(page.getByRole('heading', { name: 'Att göra innan tävlingsdagen' })).toBeVisible();
		await beat(page);
		await shot(page, '03-overview');
		const tracks = await sql`select t.name from track t join competition c on c.id = t.competition_id where c.slug = 'uat-varhajk' order by t.sort`;
		expect(tracks.map((t) => t.name).sort()).toEqual(['Upptäckare', 'Utmanare']);

		// Stations: one with two items (0–20 and fixed 0/20 "Nödbrev").
		await page.getByRole('navigation', { name: 'Tävlingsmeny' }).getByRole('link', { name: 'Kontroller' }).click();
		const list = page.getByRole('navigation', { name: 'Kontroller' });
		for (const code of ['LS', 'L1', 'LM', 'SS', 'SM']) await expect(list.getByText(code, { exact: true })).toBeVisible();
		await beat(page);
		await page.getByRole('button', { name: '+ Ny kontroll' }).first().click();
		await expect(list.getByText('Ny kontroll', { exact: true })).toBeVisible();
		await page.waitForLoadState('networkidle');
		await beat(page);
		await page.getByLabel('Namn', { exact: true }).fill('Hemligt uppdrag');
		await page.getByLabel('Namn på del 1').fill('Uppdraget');
		await beat(page, 400);
		await page.getByRole('button', { name: '+ Lägg till del' }).click();
		await page.getByLabel('Namn på del 2').fill('Nödbrev');
		await page.getByRole('radio', { name: /Fasta värden/ }).nth(1).check({ force: true });
		const vals = page.getByRole('list', { name: 'Tillåtna poäng för Nödbrev' });
		await expect(vals).toBeVisible();
		for (const v of [5, 10, 15]) {
			await page.getByRole('button', { name: `Ta bort värdet ${v}` }).click();
			await beat(page, 250);
		}
		await expect(vals.getByRole('listitem')).toHaveCount(2);
		await beat(page);
		await shot(page, '04-station-editor', true);
		await page.getByRole('button', { name: 'Spara kontrollen' }).click();
		await expect(page.getByRole('status').filter({ hasText: 'Sparat' })).toBeVisible();
		await expect(list.getByText('2 delar · Alla')).toBeVisible();
		await expect(list.getByText('Hemligt uppdrag')).toBeVisible();
		await page.evaluate(() => scrollTo(0, 0));
		await beat(page);
		await shot(page, '05-stations');

		// Import a generated fake CSV with a sensitive column.
		const csv = [
			'Patrullnamn;Klass;Kår;Kontaktperson;Mobil;Personnummer;Medlemmar',
			'Stormfåglarna;Utmanare;Påhittsby scoutkår;Kim Testsson;070-123 45 67;20120314-9876;"Alva Testberg\nBo Påhittsson\nCleo Exempel"',
			'Molnhopparna;Upptäckare;Påhittsby scoutkår;Lo Låtsas;070-765 43 21;20130505-1111;"Dan Fiktiv\nEva Uppdikt"',
			'Mossarna;Upptäckare;Hittepå scoutkår;Mo Tänkt;073-999 88 77;20130909-2222;"Fia Fantasi\nGus Gissad\nHux Hittepå"',
			'Bergsgetterna;Utmanare;Hittepå scoutkår;No Påhitt;070-000 00 00;20120101-3333;"Iris Inbillad\nJon Låtsasson"'
		].join('\n');
		await page.getByRole('navigation', { name: 'Tävlingsmeny' }).getByRole('link', { name: 'Importera' }).click();
		await page.waitForLoadState('networkidle');
		await beat(page);
		await page.locator('input[type=file]').setInputFiles({ name: 'anmalan-uat.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf-8') });
		const never = page.locator('section.never');
		await expect(never.getByRole('heading', { name: 'Läses aldrig in' })).toBeVisible();
		await expect(never.getByText('Personnummer', { exact: true })).toBeVisible();
		await beat(page, 1200);
		await shot(page, '06-import-columns', true);
		await page.getByRole('button', { name: 'Granska', exact: true }).click();
		await beat(page, 1000);
		await shot(page, '07-import-review', true);
		const commit = page.waitForRequest((r) => r.method() === 'POST' && r.url().includes('commit'));
		await page.getByRole('button', { name: /^Importera 4 patruller/ }).click();
		const body = (await commit).postData() ?? '';
		for (const pnr of ['20120314', '9876', '20130505', '3333']) expect(body).not.toContain(pnr);
		await expect(page.getByText('4 patruller importerade.')).toBeVisible();
		await beat(page);
		await shot(page, '08-import-done');

		// Distribute start stations.
		await page.getByRole('link', { name: 'Fördela startkontroller' }).click();
		await expect(page.getByRole('heading', { name: 'Fördela startkontroller' })).toBeVisible();
		await page.waitForLoadState('networkidle');
		await beat(page);
		await page.getByRole('button', { name: 'Slumpa om' }).click();
		await beat(page);
		await page.getByRole('button', { name: 'Spara fördelning' }).click();
		await expect(page.getByText(/Fördelningen är sparad för 4 patruller/)).toBeVisible();
		await beat(page);
		await shot(page, '09-distribution', true);

		// Station invite + the /j/ link (must point at the UAT origin, not .env's 5173).
		await page.getByRole('navigation', { name: 'Tävlingsmeny' }).getByRole('link', { name: 'Funktionärer' }).click();
		await page.getByRole('link', { name: /Hemligt uppdrag/ }).click();
		await expect(page.getByRole('heading', { name: /Hemligt uppdrag/ })).toBeVisible();
		await beat(page);
		await page.getByRole('button', { name: 'Skapa inbjudan' }).click();
		await expect(page.locator('.panel .qr svg')).toBeVisible();
		const link = await page.locator('#invlink').inputValue();
		expect(link).toMatch(/^http:\/\/localhost:5210\/j\/[A-Za-z0-9_-]{22}$/);
		await beat(page, 1200);
		await shot(page, '10-invite');
		test.info().annotations.push({ type: 'invite-link', description: link });
	});
});

// ---------------------------------------------------------------- 2
test.describe('2 volunteer offline', () => {

	test('volunteer scores at a station, including offline', async ({ browser }) => {
		const { page, ctx: context } = await actor(browser, '02-volunteer-offline', PHONE, true);
		await clearScores([104, 108, 112, 137], 'Repstegen');
		await sql`delete from invite where station_id = (select s.id from station s join competition c on c.id = s.competition_id where c.slug = ${SLUG} and s.name = 'Repstegen')`;
		// Bengt creates the invite through the UI in their own context.
		const bengt = await browser.newContext({ viewport: DESKTOP, baseURL: BASE });
		const ep = await bengt.newPage();
		await loginBengt(ep);
		await ep.goto(`/admin/${SLUG}/invites`);
		await ep.getByRole('link', { name: /Repstegen/ }).click();
		await expect(ep.getByRole('heading', { name: 'K8 · Repstegen' })).toBeVisible();
		await ep.getByRole('button', { name: 'Skapa inbjudan' }).click();
		const link = await ep.locator('#invlink').inputValue();
		expect(link.startsWith(`${BASE}/j/`)).toBe(true);
		await bengt.close();

		await page.goto(link);
		await expect(page.getByText('Bengt i tävlingsledningen bjuder in dig till')).toBeVisible();
		await page.getByLabel('Vad heter du?').pressSequentially('Anna', { delay: 80 });
		await beat(page);
		await shot(page, '11-join');
		await page.getByRole('button', { name: 'Öppna min kontroll' }).click();
		await expect(page).toHaveURL(new RegExp(`/f/${SLUG}$`));
		await expect(page.getByRole('heading', { name: 'K8 · Repstegen' })).toBeVisible();
		await expect(page.getByTestId('sync-pill')).toContainText('Synkad');
		await beat(page, 1000);
		await shot(page, '12-field-home');

		// 104: 17 + 3, save, undo, save again.
		await page.getByRole('link', { name: /Skanna patrull/ }).click();
		await page.getByRole('tab', { name: 'Nummer' }).click();
		for (const d of '104') {
			await page.getByRole('button', { name: d, exact: true }).click();
			await beat(page, 300);
		}
		await shot(page, '13-numpad');
		await page.getByRole('button', { name: /^104/ }).click();
		await expect(page.getByRole('heading', { name: 'Älgarna' })).toBeVisible();
		await beat(page);
		await shot(page, '14-found');
		await page.getByRole('button', { name: 'Ja, sätt poäng' }).click();
		await beat(page, 500);
		await page.getByRole('button', { name: '17', exact: true }).click();
		await beat(page, 400);
		await page.getByRole('button', { name: 'Stil 3' }).click();
		await beat(page, 500);
		await shot(page, '15-score');
		await page.getByRole('button', { name: 'Spara 17 + 3 = 20 p' }).click();
		await expect(page.getByText('Sparat!')).toBeVisible();
		await beat(page, 600);
		await shot(page, '16-saved');
		await page.getByRole('button', { name: /Ångra \(\d+ s\)/ }).click();
		await expect(page.getByText('Ångrat — inget sparades')).toBeVisible();
		await beat(page, 1500);
		await page.getByRole('button', { name: '17', exact: true }).click();
		await page.getByRole('button', { name: 'Stil 3' }).click();
		await beat(page, 400);
		await page.getByRole('button', { name: 'Spara 17 + 3 = 20 p' }).click();
		await expect(page.getByText('Sparat!')).toBeVisible();
		await backHome(page);
		await expect.poll(async () => (await scoresFor(104, 'Repstegen')).length, { timeout: 20_000 }).toBe(1);

		// Offline: 108 and 112.
		await context.setOffline(true);
		await beat(page, 500);
		await scoreRange(page, 108, 12, 4);
		await backHome(page);
		await scoreRange(page, 112, 17, 3);
		await backHome(page);
		await expect(page.getByTestId('sync-pill')).toContainText('2 väntar', { timeout: 20_000 });
		await beat(page, 800);
		await shot(page, '17-offline-pending');
		expect(await scoresFor(108, 'Repstegen')).toHaveLength(0);

		// Reload while offline: the service worker must serve /f from cache.
		await page.reload();
		await expect(page.getByRole('heading', { name: 'K8 · Repstegen' })).toBeVisible({ timeout: 20_000 });
		await expect(page.getByTestId('sync-pill')).toContainText('2 väntar');
		await beat(page, 800);
		await shot(page, '18-offline-reloaded');
		await page.getByRole('link', { name: 'Logg' }).click();
		await expect(page.getByText('2 rapporter väntar')).toBeVisible();
		await expect(page.getByTestId('sync-108')).toHaveAttribute('data-sync', 'pending');
		await beat(page, 800);
		await shot(page, '19-log-offline');

		// Online again → sync.
		await context.setOffline(false);
		await page.evaluate(() => dispatchEvent(new Event('online')));
		await expect(page.getByTestId('sync-pill')).toContainText('Synkad', { timeout: 30_000 });
		await expect(page.getByTestId('sync-112')).toHaveAttribute('data-sync', 'synced');
		await beat(page, 1000);
		await shot(page, '20-log-synced');

		for (const [nr, p, s] of [[104, 17, 3], [108, 12, 4], [112, 17, 3]]) {
			const rows = await scoresFor(nr, 'Repstegen');
			expect(rows, `score for ${nr}`).toHaveLength(1);
			expect(rows[0]).toMatchObject({ points: p, style_points: s, state: 'active', origin: 'device' });
		}
	});
});

// ---------------------------------------------------------------- 3
test.describe('3 mal', () => {

	test('Mål station with four items on one screen', async ({ browser }) => {
		const { page } = await actor(browser, '03-mal-station', PHONE, true);
		await clearScores([119], 'Mål');
		await setStatus(119, 'active');
		const secret = await createInvite('Mål');
		await join(page, secret, 'Lena');
		await expect(page.getByRole('heading', { name: 'K14 · Mål' })).toBeVisible();
		await beat(page);
		await pickByNumber(page, 119);
		await page.getByRole('button', { name: 'Ja, sätt poäng' }).click();
		await expect(page.getByText('Målregistrering')).toBeVisible();
		await beat(page);
		await page.getByRole('button', { name: 'Oöppnat · 20 p' }).click();
		await beat(page, 400);
		await page.getByRole('button', { name: '14', exact: true }).click();
		await beat(page, 400);
		for (let i = 0; i < 7; i++) {
			await page.getByRole('button', { name: 'Öka Orientering' }).click();
			await beat(page, 150);
		}
		await expect(page.getByText('→ 14 p')).toBeVisible();
		await shot(page, '21-mal-top');
		await shot(page, '22-mal-full', true);
		await page.getByRole('button', { name: 'Spara 48 p' }).click();
		await expect(page.getByText('Sparat!')).toBeVisible();
		await beat(page, 1000);
		await shot(page, '23-mal-saved');
		await expect.poll(async () => (await scoresFor(119, 'Mål')).length, { timeout: 20_000 }).toBe(4);
		expect(await statusOf(119)).toBe('finished');
	});
});

// ---------------------------------------------------------------- 4
test.describe('4 desk', () => {

	test('start and finish desk', async ({ browser }) => {
		const { page } = await actor(browser, '04-start-finish-desk', TABLET, true);
		await setStatus(144, 'registered');
		await sql`delete from status_event where patrol_id = (select p.id from patrol p join competition c on c.id = p.competition_id where c.slug = ${SLUG} and p.number = 144)`;
		const secret = await createInvite(null);
		await join(page, secret, 'Per');
		await expect(page).toHaveURL(new RegExp(`/f/${SLUG}/desk$`));
		await expect(page.getByTestId('row-144')).toBeVisible();
		await beat(page, 1000);
		const counts = page.locator('.counts');
		const read = async () => (await counts.locator('.cn').allTextContents()).map(Number);
		const [reg0, act0, camp0, fin0] = await read(); // Anmälda, På banan, I läger, I mål, Återbud
		await shot(page, '24-desk');
		await page.getByLabel('Patrullnummer').pressSequentially('144', { delay: 120 });
		await page.getByRole('button', { name: 'Registrera' }).click();
		await expect(page.getByTestId('last-scan')).toContainText('PÅ BANAN');
		await expect.poll(read).toEqual([reg0 - 1, act0 + 1, camp0, fin0, expect.any(Number)]);
		await beat(page, 1200);
		await shot(page, '25-desk-active');
		await page.getByLabel('Patrullnummer').pressSequentially('144', { delay: 120 });
		await page.getByRole('button', { name: 'Registrera' }).click();
		await expect(page.getByTestId('last-scan')).toContainText('I MÅL');
		await expect(page.getByTestId('row-144').getByRole('radio', { name: 'I mål' })).toHaveAttribute('aria-checked', 'true');
		await expect.poll(read).toEqual([reg0 - 1, act0, camp0, fin0 + 1, expect.any(Number)]);
		await beat(page, 1200);
		await shot(page, '26-desk-finished');
		await expect.poll(() => statusOf(144), { timeout: 20_000 }).toBe('finished');
	});
});

// ---------------------------------------------------------------- 5
test.describe('5 hq live', () => {

	test('HQ sees a score live, edits it and messages the volunteer', async ({ browser }) => {
		const { page } = await actor(browser, '05-hq-live', DESKTOP, false);
		await clearScores([137], 'Repstegen');
		await loginBengt(page);
		await page.goto(`/admin/${SLUG}/live`);
		await expect(page.getByRole('heading', { name: 'Ledningscentralen' })).toBeVisible();
		await expect(page.getByTestId('live-status')).toHaveAttribute('data-status', 'open', { timeout: 15_000 });
		await beat(page, 1000);
		await shot(page, '27-hq-live');
		const navs: string[] = [];
		page.on('framenavigated', (f) => f === page.mainFrame() && navs.push(f.url()));

		// Volunteer phone saves 137 → 17 + 3 at Repstegen.
		const vol = await actor(browser, '05-hq-live-volunteer', PHONE, true);
		const vp = vol.page;
		await join(vp, await createInvite('Repstegen'), 'Omar');
		await expect(vp.getByRole('heading', { name: 'K8 · Repstegen' })).toBeVisible();
		await scoreRange(vp, 137, 17, 3);
		await backHome(vp);

		const feedRow = page.getByTestId('feed').locator('li').first();
		await expect(feedRow).toContainText('137 Hackspettarna', { timeout: 20_000 });
		await expect(feedRow).toContainText('17 + 3');
		expect(navs, 'HQ must update without a reload').toHaveLength(0);
		await beat(page, 1200);
		await shot(page, '28-hq-live-new-score');

		// Patrol detail: edit 104's Repstegen score with a reason.
		await page.goto(`/admin/${SLUG}/patrol/104`);
		await expect(page.getByRole('heading', { name: 'Älgarna' })).toBeVisible();
		await beat(page);
		await expect(async () => {
			if (!(await page.locator('form.item').count())) await page.locator('button.cell[data-code="K8"]').click();
			await expect(page.locator('form.item').first()).toBeVisible({ timeout: 1000 });
		}).toPass({ timeout: 15_000 });
		const form = page.locator('form.item').first();
		await beat(page);
		await form.locator('label.chip', { hasText: /^\s*16\s*$/ }).first().click();
		await beat(page, 400);
		await form.getByLabel('Anledning').pressSequentially('fel siffra på lappen', { delay: 40 });
		await shot(page, '29-patrol-edit');
		await form.getByRole('button', { name: 'Spara ändring' }).click();
		await expect(form.getByRole('status')).toContainText('sparad');
		await expect(page.getByTestId('timeline')).toContainText('K8 ändrad av Bengt · var 17 + 3 → 16 + 3');
		await expect(page.getByTestId('timeline')).toContainText('fel siffra på lappen');
		await beat(page, 1000);
		await shot(page, '30-patrol-history', true);

		// Message → volunteer phone → read receipt.
		await page.getByRole('navigation', { name: 'Tävlingsmeny' }).getByRole('link', { name: 'Meddelanden' }).click();
		await page.waitForLoadState('networkidle');
		await page.getByLabel('Rubrik').pressSequentially('Fika vid Mål kl 14', { delay: 40 });
		await page.getByRole('textbox', { name: 'Meddelande' }).pressSequentially('Kanelbullar finns vid målet. Ta med en kollega.', { delay: 20 });
		await beat(page);
		await page.getByRole('button', { name: 'Skicka meddelande' }).click();
		const sent = page.getByTestId('sent-message').first();
		await expect(sent).toContainText('Fika vid Mål kl 14');
		await expect(sent).toContainText(/0 av \d+/);
		const total = Number((await sent.locator('.receipt strong').textContent())!.split(' av ')[1]);
		await beat(page);
		await shot(page, '31-messages-sent');

		await expect(vp.getByText('Nytt från ledningen:')).toBeVisible({ timeout: 30_000 });
		await beat(vp);
		await shot(vp, '32-field-message-banner');
		await vp.getByRole('navigation', { name: 'Huvudmeny' }).getByRole('link', { name: /Meddelanden/ }).click();
		await vp.getByRole('button', { name: /Fika vid Mål kl 14/ }).click();
		await expect(vp.getByText('Kanelbullar finns vid målet.')).toBeVisible();
		await beat(vp, 800);
		await shot(vp, '33-field-message-open');

		// Receipt must move without reloading the HQ page.
		await expect(sent).toContainText(`1 av ${total}`, { timeout: 20_000 });
		await beat(page, 1000);
		await shot(page, '34-messages-read');
		await vol.ctx.close();
	});
});

// ---------------------------------------------------------------- 6
test.describe('6 results', () => {

	test('results, public page and prize ceremony', async ({ browser }) => {
		const { page } = await actor(browser, '06-results-ceremony', DESKTOP, false);
		await loginBengt(page);
		const [upp] = await sql`select t.id from track t join competition c on c.id = t.competition_id where c.slug = ${SLUG} and t.name = 'Upptäckare'`;
		await page.goto(`/admin/${SLUG}/results?class=${upp.id}`);
		await expect(page.getByRole('heading', { name: 'Resultat' })).toBeVisible();
		const r112 = page.locator('[data-testid="result-row"][data-number="112"]');
		const r137 = page.locator('[data-testid="result-row"][data-number="137"]');
		await expect(r112).toBeVisible();
		const place = await r112.getAttribute('data-place');
		expect(place, '112 and 137 share a place').toBe(await r137.getAttribute('data-place'));
		await expect(r112).toContainText('Delad plats med 137');
		await beat(page, 1500);
		await shot(page, '35-results', true);

		const pub = await actor(browser, '06-results-public-phone', PHONE, true);
		await pub.page.goto(`/r/${SLUG}`);
		await expect(pub.page.getByText('Preliminärt · live')).toBeVisible();
		await expect(async () => {
			await pub.page.getByRole('button', { name: 'Upptäckare' }).click();
			await expect(pub.page.locator('[data-testid="public-list"] li[data-number="112"]')).toHaveAttribute('data-place', place!, { timeout: 1000 });
		}).toPass({ timeout: 15_000 });
		await beat(pub.page, 1000);
		await shot(pub.page, '36-public-results');
		await shot(pub.page, '37-public-results-full', true);
		expect(await pub.page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
		await pub.ctx.close();

		// Ceremony at 1600×900.
		await page.setViewportSize({ width: 1600, height: 900 });
		await page.goto(`/r/${SLUG}/ceremony`);
		await expect(page.getByRole('heading', { name: 'Prisutdelning' })).toBeVisible();
		await beat(page);
		await shot(page, '38-ceremony-pick');
		await page.getByRole('link', { name: /Upptäckare/ }).click();
		await expect(page.getByTestId('reveal-card')).toContainText('Strax dags');
		await beat(page, 1200);
		await shot(page, '39-ceremony-start');
		const count = await page.getByTestId('place-item').count();
		for (let i = 0; i < count - 1; i++) {
			const btn = page.getByRole('button', { name: 'Avslöja vinnaren' });
			if (await btn.isVisible()) break;
			await page.keyboard.press('ArrowRight');
			await beat(page, 1100);
			if (i === 1) await shot(page, '40-ceremony-mid');
		}
		await page.getByRole('button', { name: 'Avslöja vinnaren' }).click();
		await expect(page.getByTestId('reveal-card')).toContainText('Första plats');
		await expect(page.getByTestId('reveal-name')).toHaveText('Ugglorna');
		await beat(page, 2000);
		await shot(page, '41-ceremony-winner');
	});
});

// ---------------------------------------------------------------- 7
test.describe('7 print', () => {

	test('scorecards and reserve protocol', async ({ browser }) => {
		const { page } = await actor(browser, '07-print', DESKTOP, false);
		await loginBengt(page);
		// The seed gives gokhajk-2027 no patrols, so its scorecards are an empty state;
		// the multi-day cards with patrols are shown for UAT Vårhajk (imported in scenario 1).
		await page.goto('/admin/gokhajk-2027/print/scorecards');
		await beat(page, 800);
		await shot(page, '42-scorecards-gokhajk-empty');
		await page.goto('/admin/uat-varhajk/print');
		await expect(page.getByRole('heading', { name: 'Utskrifter' })).toBeVisible();
		await beat(page);
		await shot(page, '43-print-hub');
		await page.getByRole('link', { name: 'Öppna poängkort' }).click();
		await expect(page.locator('section.scard').first()).toBeVisible();
		await beat(page, 1200);
		await shot(page, '44-scorecards');
		await page.pdf({ path: `${SHOTS}/scorecards.pdf`, format: 'A4', printBackground: true });
		await page.goto(`/admin/${SLUG}/print/protocol`);
		await beat(page, 1200);
		await shot(page, '45-protocol');
		await page.emulateMedia({ media: 'print' });
		await beat(page, 500);
		await shot(page, '46-protocol-print-media');
		await page.emulateMedia({ media: 'screen' });
	});
});

// ---------------------------------------------------------------- 8
test.describe('8 accessibility smoke', () => {

	const audit = (page: Page) =>
		page.evaluate(() => {
			const name = (el: Element) => {
				const aria = el.getAttribute('aria-label') ?? '';
				const by = el.getAttribute('aria-labelledby');
				const byText = by ? by.split(' ').map((id) => document.getElementById(id)?.textContent ?? '').join(' ') : '';
				const imgAlt = [...el.querySelectorAll('img[alt]')].map((i) => i.getAttribute('alt')).join(' ');
				return (aria + byText + (el.textContent ?? '') + imgAlt + (el.getAttribute('title') ?? '')).trim();
			};
			const visible = (el: Element) => (el as HTMLElement).offsetParent !== null || getComputedStyle(el).position === 'fixed';
			const unnamed = [...document.querySelectorAll('button, a[href], [role=button], [role=tab], [role=radio]')]
				.filter((el) => visible(el) && !name(el))
				.map((el) => el.outerHTML.slice(0, 120));
			const inputs = [...document.querySelectorAll('input:not([type=hidden]), select, textarea')]
				.filter((el) => visible(el) && !(el as HTMLInputElement).labels?.length && !el.getAttribute('aria-label') && !el.getAttribute('aria-labelledby'))
				.map((el) => el.outerHTML.slice(0, 120));
			const small = [...document.querySelectorAll('button, a[href], [role=button]')]
				.filter((el) => visible(el))
				.map((el) => ({ el, r: el.getBoundingClientRect() }))
				.filter(({ r }) => r.width > 0 && (r.height < 44 || r.width < 44))
				.map(({ el, r }) => `${Math.round(r.width)}×${Math.round(r.height)} ${(el.textContent ?? el.getAttribute('aria-label') ?? '').trim().slice(0, 30)}`);
			return { h1: document.querySelectorAll('h1').length, title: document.title, unnamed, inputs, small, lang: document.documentElement.lang };
		});

	test('every page has an h1, named controls; keyboard through the score screen', async ({ browser }) => {
		const { page } = await actor(browser, '08-a11y', PHONE, true);
		const report: Record<string, unknown> = {};
		const bengt = await browser.newContext({ viewport: DESKTOP, baseURL: BASE });
		const ep = await bengt.newPage();
		await loginBengt(ep);
		const adminPages = ['/admin', '/admin/new', `/admin/${SLUG}`, `/admin/${SLUG}/stations`, `/admin/${SLUG}/patrols`, `/admin/${SLUG}/import`, `/admin/${SLUG}/distribution`, `/admin/${SLUG}/invites`, `/admin/${SLUG}/print`, `/admin/${SLUG}/settings`, `/admin/${SLUG}/live`, `/admin/${SLUG}/messages`, `/admin/${SLUG}/conflicts`, `/admin/${SLUG}/results`, `/admin/${SLUG}/patrol/112`, `/admin/${SLUG}/live/paper`, '/admin/uat-varhajk/print/scorecards', `/admin/${SLUG}/print/protocol`];
		for (const p of adminPages) {
			await ep.goto(p);
			await ep.waitForLoadState('networkidle').catch(() => undefined);
			report[p] = await audit(ep);
		}
		await bengt.close();

		for (const p of ['/', '/login', `/r/${SLUG}`, `/r/${SLUG}/ceremony`]) {
			await page.goto(p);
			report[p] = await audit(page);
		}
		const secret = await createInvite('Kojbygge');
		await page.goto(`/j/${secret}`);
		report['/j/[secret]'] = await audit(page);
		await page.getByLabel('Vad heter du?').fill('Tove');
		await page.getByRole('button', { name: 'Öppna min kontroll' }).click();
		await expect(page).toHaveURL(new RegExp(`/f/${SLUG}$`)); // the join page shows the same heading
		await expect(page.getByRole('heading', { name: /Kojbygge/ })).toBeVisible();
		for (const p of ['', '/scan', '/log', '/messages', '/score/115']) {
			await page.goto(`/f/${SLUG}${p}`);
			await page.waitForLoadState('networkidle').catch(() => undefined);
			await beat(page, 500);
			report[`/f/[slug]${p}`] = await audit(page);
		}

		// Keyboard through the score screen (115 at Kojbygge).
		await page.goto(`/f/${SLUG}/score/115`);
		await expect(page.getByRole('button', { name: '17', exact: true })).toBeVisible();
		await page.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => undefined);
		const order: string[] = [];
		for (let i = 0; i < 40; i++) {
			await page.keyboard.press('Tab');
			const d = await page.evaluate(() => {
				const a = document.activeElement as HTMLElement | null;
				if (!a) return null;
				const cs = getComputedStyle(a);
				return { t: (a.getAttribute('aria-label') ?? a.textContent ?? '').trim().slice(0, 24), ring: cs.outlineStyle !== 'none' || cs.boxShadow !== 'none' };
			});
			order.push(`${d?.t}${d?.ring ? '' : ' (NO RING)'}`);
			if (d?.t === '17') {
				await beat(page, 300);
				await shot(page, '47-keyboard-focus');
				await page.keyboard.press('Enter');
			}
			if (d?.t === 'Stil 3') await page.keyboard.press('Space');
			if (d?.t?.startsWith('Spara 17')) break;
			await beat(page, 120);
		}
		report['keyboard-order /f/score/115'] = order;
		await expect(page.getByRole('button', { name: 'Spara 17 + 3 = 20 p' })).toBeFocused();
		await shot(page, '48-keyboard-save-focused');
		console.log('A11Y_REPORT ' + JSON.stringify(report, null, 1));
		await test.info().attach('a11y.json', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
		const missingH1 = Object.entries(report).filter(([k, v]) => !k.includes('/print/')).filter(([, v]) => typeof v === 'object' && v && 'h1' in v && (v as { h1: number }).h1 !== 1);
		const unnamed = Object.entries(report).filter(([, v]) => typeof v === 'object' && v && 'unnamed' in v && (v as { unnamed: string[] }).unnamed.length);
		expect.soft(missingH1.map(([k, v]) => `${k}: ${(v as { h1: number }).h1}`), 'pages without exactly one h1').toEqual([]);
		expect.soft(unnamed.map(([k, v]) => `${k}: ${(v as { unnamed: string[] }).unnamed.join(' | ')}`), 'unnamed controls').toEqual([]);
	});
});

/**
 * Field e2e: join → score → undo → offline queue → Mål multi-item → desk.
 * Run: (in apps/web) PORT=5203 scripts/dev-server.sh start && npx playwright test -c e2e/field.config.ts
 */
import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { SLUG, clearScores, createInvite, scoresFor, setStatus, sql, statusOf } from './field-db.ts';

test.describe.configure({ mode: 'serial' });

const shot = (page: Page, name: string) => page.screenshot({ path: `e2e/screenshots/field-${name}.png` });

let ctx: BrowserContext;
let page: Page;
let k6Secret: string;

async function join(p: Page, secret: string, name: string) {
	await p.goto(`/j/${secret}`);
	await p.getByLabel('Vad heter du?').fill(name);
	await p.getByRole('button', { name: 'Öppna min kontroll' }).click();
}

async function pickByNumber(p: Page, nr: number) {
	await p.getByRole('link', { name: /Skanna patrull/ }).click();
	await p.getByRole('tab', { name: 'Nummer' }).click();
	for (const d of String(nr)) await p.getByRole('button', { name: d, exact: true }).click();
	await p.getByRole('button', { name: new RegExp(`^${nr}`) }).click();
}

async function scoreK6(p: Page, nr: number, points: number, style: number) {
	await pickByNumber(p, nr);
	await p.getByRole('button', { name: /Ja, sätt poäng|Ändra poäng/ }).click();
	await p.getByRole('button', { name: String(points), exact: true }).click();
	await p.getByRole('button', { name: `Stil ${style}` }).click();
	await p.getByRole('button', { name: `Spara ${points} + ${style} = ${points + style} p` }).click();
	await expect(p.getByText('Sparat!')).toBeVisible();
}

test.beforeAll(async ({ browser }: { browser: Browser }) => {
	await clearScores([127, 128, 133], 'Första hjälpen');
	await clearScores([127], 'Mål');
	await setStatus(127, 'active');
	await setStatus(108, 'registered');
	await sql`delete from status_event where patrol_id in (select p.id from patrol p join competition c on c.id = p.competition_id where c.slug = ${SLUG} and p.number in (108, 127))`;
	k6Secret = await createInvite('Första hjälpen');
	ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
	page = await ctx.newPage();
});

test.afterAll(async () => {
	await ctx?.close();
	await sql.end();
});

test('1–2: join a station as Anna', async () => {
	await page.goto(`/j/${k6Secret}`);
	await expect(page.getByText('Bengt i tävlingsledningen bjuder in dig till')).toBeVisible();
	await expect(page.getByRole('heading', { name: 'K6 · Första hjälpen' })).toBeVisible();
	await page.getByLabel('Vad heter du?').fill('Anna Berg');
	await expect(page.getByRole('button', { name: 'Öppna min kontroll' })).toBeEnabled();
	await shot(page, 'join');
	await page.getByRole('button', { name: 'Öppna min kontroll' }).click();
	await expect(page).toHaveURL(new RegExp(`/f/${SLUG}$`));
	await expect(page.getByText('Hej Anna · GökOpen 2027')).toBeVisible();
	await expect(page.getByRole('heading', { name: 'K6 · Första hjälpen' })).toBeVisible();
	await expect(page.getByTestId('sync-pill')).toContainText('Synkad');
	await shot(page, 'home');
});

test('3: number pad → 127 → 17 + 3 → save → undo', async () => {
	await page.getByRole('link', { name: /Skanna patrull/ }).click();
	await page.getByRole('tab', { name: 'Nummer' }).click();
	for (const d of '127') await page.getByRole('button', { name: d, exact: true }).click();
	await expect(page.getByTestId('typed')).toContainText('127');
	await shot(page, 'numpad');
	await page.getByRole('button', { name: /^127/ }).click();
	await expect(page.getByRole('heading', { name: 'Uttrarna' })).toBeVisible();
	await expect(page.getByRole('dialog', { name: 'Uttrarna' }).getByText('Spårare · Ekbackens scoutkår')).toBeVisible();
	await shot(page, 'found');
	await page.getByRole('button', { name: 'Ja, sätt poäng' }).click();

	await expect(page.getByRole('button', { name: 'Välj poäng' })).toBeDisabled();
	await page.getByRole('button', { name: '17', exact: true }).click();
	await page.getByRole('button', { name: 'Stil 3' }).click();
	await shot(page, 'score');
	await page.getByRole('button', { name: 'Spara 17 + 3 = 20 p' }).click();
	await expect(page.getByText('Sparat!')).toBeVisible();
	await expect(page.getByText('Sparad i telefonen · skickas automatiskt')).toBeVisible();
	await shot(page, 'saved');
	await page.getByRole('button', { name: /Ångra \(\d+ s\)/ }).click();
	await expect(page.getByText('Ångrat — inget sparades')).toBeVisible();
	// Undone inside the 3 s flush window: nothing ever reaches the server.
	await page.waitForTimeout(4500);
	expect(await scoresFor(127, 'Första hjälpen')).toHaveLength(0);
});

test('4: score again, two more offline, then sync with versions', async () => {
	await page.getByRole('button', { name: '17', exact: true }).click();
	await page.getByRole('button', { name: 'Stil 3' }).click();
	await page.getByRole('button', { name: 'Spara 17 + 3 = 20 p' }).click();
	await expect(page.getByText('Sparat!')).toBeVisible();
	await page.getByRole('link', { name: 'Skanna nästa patrull' }).click();
	await page.getByRole('link', { name: 'Stäng' }).click();
	await expect.poll(async () => (await scoresFor(127, 'Första hjälpen')).length, { timeout: 15_000 }).toBe(1);

	// Visit the log once while online (the dev server serves route chunks lazily; a build precaches them).
	await page.getByRole('link', { name: 'Logg' }).click();
	await expect(page.getByTestId('sync-127')).toHaveAttribute('data-sync', 'synced');
	await page.getByRole('link', { name: 'Kontroll' }).click();

	await ctx.setOffline(true);
	await scoreK6(page, 128, 12, 4);
	await page.getByRole('link', { name: 'Skanna nästa patrull' }).click();
	await page.getByRole('link', { name: 'Stäng' }).click();
	await scoreK6(page, 133, 9, 2);
	await page.getByRole('link', { name: 'Skanna nästa patrull' }).click();
	await page.getByRole('link', { name: 'Stäng' }).click();
	await page.getByRole('link', { name: 'Logg' }).click();
	await expect(page.getByText('Ingen täckning just nu')).toBeVisible({ timeout: 20_000 });
	await expect(page.getByText('2 rapporter väntar')).toBeVisible();
	await expect(page.getByTestId('sync-pill')).toContainText('2 väntar');
	await expect(page.getByTestId('sync-128')).toHaveAttribute('data-sync', 'pending');
	await shot(page, 'log-offline');
	expect(await scoresFor(128, 'Första hjälpen')).toHaveLength(0);

	await ctx.setOffline(false);
	await page.evaluate(() => dispatchEvent(new Event('online')));
	await expect(page.getByTestId('sync-pill')).toContainText('Synkad', { timeout: 20_000 });
	await expect(page.getByTestId('sync-133')).toHaveAttribute('data-sync', 'synced');
	await shot(page, 'log-synced');

	for (const [nr, p, s] of [[127, 17, 3], [128, 12, 4], [133, 9, 2]]) {
		const rows = await scoresFor(nr, 'Första hjälpen');
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ points: p, style_points: s, version: 1, state: 'active', origin: 'device' });
	}

	// Edit through the log: re-opens score entry with current values and baseVersion → version 2.
	await page.getByRole('button', { name: /Uttrarna 127/ }).click();
	await page.getByRole('button', { name: 'Ändra poäng' }).click();
	await expect(page.getByRole('button', { name: 'Spara 17 + 3 = 20 p' })).toBeEnabled();
	await page.getByRole('button', { name: '18', exact: true }).click();
	await page.getByRole('button', { name: 'Spara 18 + 3 = 21 p' }).click();
	await expect(page.getByText('Sparat!')).toBeVisible();
	await expect.poll(async () => (await scoresFor(127, 'Första hjälpen'))[0]?.version, { timeout: 15_000 }).toBe(2);
});

test('5: Mål station with all four items on one screen', async ({ browser }) => {
	const secret = await createInvite('Mål');
	const c = await browser.newContext({ viewport: { width: 390, height: 844 } });
	const p = await c.newPage();
	await join(p, secret, 'Lena');
	await expect(p.getByRole('heading', { name: 'K14 · Mål' })).toBeVisible();
	await pickByNumber(p, 127);
	await p.getByRole('button', { name: 'Ja, sätt poäng' }).click();
	await expect(p.getByText('Målregistrering')).toBeVisible();
	await p.getByRole('button', { name: 'Oöppnat · 20 p' }).click();
	await p.getByRole('button', { name: '15', exact: true }).click();
	for (let i = 0; i < 8; i++) await p.getByRole('button', { name: 'Öka Orientering' }).click();
	await expect(p.getByText('→ 16 p')).toBeVisible();
	await shot(p, 'mal');
	await p.getByRole('button', { name: 'Spara 51 p' }).click();
	await expect(p.getByText('Sparat!')).toBeVisible();
	await expect.poll(async () => (await scoresFor(127, 'Mål')).length, { timeout: 15_000 }).toBe(4);
	const rows = await scoresFor(127, 'Mål');
	expect(rows.map((r) => r.points).sort((a, b) => a - b)).toEqual([0, 15, 16, 20]);
	expect(await statusOf(127)).toBe('finished'); // C10: AUTO_ON_SCAN sets I mål
	await c.close();
});

test('6: start & mål desk advances a patrol to I mål', async ({ browser }) => {
	const secret = await createInvite(null);
	const c = await browser.newContext({ viewport: { width: 1194, height: 834 } });
	const p = await c.newPage();
	await join(p, secret, 'Per');
	await expect(p).toHaveURL(new RegExp(`/f/${SLUG}/desk$`));
	await expect(p.getByTestId('row-108')).toBeVisible();
	await p.getByLabel('Patrullnummer').fill('108');
	await p.getByRole('button', { name: 'Registrera' }).click();
	await expect(p.getByTestId('last-scan')).toContainText('PÅ BANAN');
	await p.getByLabel('Patrullnummer').fill('108');
	await p.getByRole('button', { name: 'Registrera' }).click();
	await expect(p.getByTestId('last-scan')).toContainText('I MÅL');
	await expect(p.getByTestId('last-scan')).toContainText('108 · Bävrarna');
	await expect(p.getByTestId('row-108').getByRole('radio', { name: 'I mål' })).toHaveAttribute('aria-checked', 'true');
	await expect.poll(() => statusOf(108), { timeout: 15_000 }).toBe('finished');
	const events = await sql`select status from status_event where patrol_id = (select id from patrol where number = 108 and competition_id = (select id from competition where slug = ${SLUG})) order by at`;
	expect(events.map((e) => e.status)).toEqual(['active', 'finished']);
	await shot(p, 'desk');
	await c.close();
});

test('7: HQ disconnects a phone, and a new code disconnects the phones that joined with the old one', async ({ browser }) => {
	const [k6] = await sql`select s.id from station s join competition c on c.id = s.competition_id where c.slug = ${SLUG} and s.name = 'Första hjälpen'`;
	const phone = async (name: string) => {
		const c = await browser.newContext({ viewport: { width: 390, height: 844 } });
		const p = await c.newPage();
		await join(p, await createInvite('Första hjälpen'), name);
		await expect(p.getByTestId('sync-pill')).toContainText('Synkad', { timeout: 15_000 });
		return { c, p };
	};
	const cutOff = async (p: Page) => {
		await p.reload();
		await expect(p.getByText('Telefonen är inte längre kopplad till kontrollen. Skanna inbjudan igen.').first()).toBeVisible({ timeout: 15_000 });
	};
	const lisa = await phone('Lisa');
	const hqCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
	const hq = await hqCtx.newPage();
	await hq.goto('/login');
	await hq.getByRole('button', { name: /Logga in som Bengt/ }).click();
	await hq.waitForURL(/\/admin/);

	// 1. One phone, from the Telefoner list.
	await hq.goto(`/admin/${SLUG}/invites?s=${k6.id}`);
	const row = hq.getByTestId('phone').filter({ hasText: 'Lisa' });
	await expect(row).toBeVisible();
	await shot(hq, 'phones');
	// The confirmation needs the page to be hydrated: click until it appears.
	await expect(async () => {
		if (!(await row.getByRole('button', { name: 'Ja, koppla från Lisa' }).count())) await row.getByRole('button', { name: 'Koppla från Lisa' }).click();
		await expect(row.getByRole('button', { name: 'Ja, koppla från Lisa' })).toBeVisible({ timeout: 1000 });
	}).toPass({ timeout: 15_000 });
	await row.getByRole('button', { name: 'Ja, koppla från Lisa' }).click();
	await expect(hq.getByTestId('phone').filter({ hasText: 'Lisa' })).toHaveCount(0);
	await cutOff(lisa.p);

	// 2. "Skapa ny kod": every phone that joined with an older code is cut off.
	const olle = await phone('Olle');
	await hq.goto(`/admin/${SLUG}/invites?s=${k6.id}`);
	await hq.getByRole('button', { name: /Skapa ny kod/ }).first().click();
	const confirm = hq.getByRole('button', { name: 'Ja, skapa ny kod' });
	if (await confirm.count()) await confirm.click();
	await expect(hq.getByTestId('phone').filter({ hasText: 'Olle' })).toContainText('Gammal kod');
	await cutOff(olle.p);

	for (const x of [lisa, olle]) await x.c.close();
	await hqCtx.close();
});

test('8: "Ta bort tävlingen från telefonen" leaves nothing about the competition on the phone', async ({ browser }) => {
	const c = await browser.newContext({ viewport: { width: 390, height: 844 } });
	const p = await c.newPage();
	await join(p, await createInvite('Första hjälpen'), 'Kim');
	await expect(p.getByTestId('sync-pill')).toContainText('Synkad', { timeout: 15_000 });
	const counts = () =>
		p.evaluate(
			(slug) =>
				new Promise<Record<string, number>>((resolve) => {
					const req = indexedDB.open('st-field');
					req.onsuccess = () => {
						const db = req.result;
						const stores = ['grants', 'packs', 'outbox', 'scores', 'statuses', 'reads'];
						const tx = db.transaction(stores, 'readonly');
						const out: Record<string, number> = {};
						let left = stores.length;
						for (const s of stores) {
							const all = tx.objectStore(s).getAll();
							all.onsuccess = () => {
								out[s] = (all.result as { slug?: string }[]).filter((r) => r.slug === slug).length;
								if (--left === 0) resolve(out);
							};
						}
					};
				}),
			SLUG
		);
	expect((await counts()).packs).toBe(1);
	await p.getByRole('link', { name: 'Logg' }).click();
	await p.getByRole('button', { name: 'Ta bort tävlingen från telefonen' }).click();
	await expect(p.getByText('Allt är skickat.')).toBeVisible();
	await shot(p, 'forget');
	await p.getByRole('button', { name: 'Ja, ta bort' }).click();
	await p.waitForURL((u) => u.pathname === '/');
	expect(await counts()).toEqual({ grants: 0, packs: 0, outbox: 0, scores: 0, statuses: 0, reads: 0 });
	await c.close();
});

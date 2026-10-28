import { expect, test, type Page } from '@playwright/test';
import { login } from './support.ts';
import { readFileSync } from 'node:fs';
import postgres from 'postgres';

/*
 * Statistics: the organiser's page and the public page. Run:
 *   cd apps/web && PORT=5204 scripts/dev-server.sh start
 *   npm run db:seed && npx playwright test -c e2e/stats.config.ts
 */
const shot = (page: Page, name: string) => page.screenshot({ path: `e2e/screenshots/stats-${name}.png`, fullPage: true });
const PHONE = { width: 390, height: 844 };

function databaseUrl() {
	if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
	const env = readFileSync(new URL('../.env', import.meta.url), 'utf8');
	return /^DATABASE_URL=(.*)$/m.exec(env)![1].trim().replace(/^["']|["']$/g, '');
}

test.describe.configure({ mode: 'serial' });

test('1. organiser: participation, points per station, registrations and payments (GökOpen 2027, live)', async ({ page }) => {
	await login(page);
	await page.goto('/admin/gokopen-2027');
	await page.getByRole('link', { name: 'Statistik', exact: true }).click();
	await expect(page.getByRole('heading', { level: 1, name: 'Statistik' })).toBeVisible();
	const part = page.getByTestId('participation');
	await expect(part.locator('[data-k="registered"] dd')).toHaveText('14');
	// Points per station are always visible to organisers; 2027 has only HQ-entered scores, so no times.
	const lager = page.getByTestId('station-stats').locator('li', { hasText: 'Lägerplatsen' });
	await expect(lager).toContainText('Median');
	await expect(lager.getByRole('img')).toHaveAttribute('aria-label', /Fördelning för Lägerplatsen: 8 patruller/);
	await expect(page.getByText('Inga tider ännu.')).toBeVisible();
	// Registrations and payments (seed: 150 kr, 11 of 14 paid).
	await expect(page.getByRole('table', { name: /Anmälningar per dag, totalt 14/ })).toContainText('2026-09-03');
	const pay = page.getByTestId('payments');
	await expect(pay).toContainText('150 kr');
	await expect(pay.locator('[data-k="paid"] dd')).toHaveText('11');
	await expect(pay).toContainText('1 650 kr inbetalt');
	await expect(pay).toContainText('450 kr kvar att få in');
	await shot(page, 'admin-desktop');

	// Class tab: only that class's patrols and stations.
	await expect(async () => {
		await page.getByRole('button', { name: 'Spårare' }).click();
		await expect(part.locator('[data-k="registered"] dd')).toHaveText('4', { timeout: 1000 });
	}).toPass({ timeout: 15_000 });
	await expect(page.getByTestId('station-stats').locator('li', { hasText: 'Kanoten' })).toHaveCount(0);

	await page.setViewportSize(PHONE);
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(PHONE.width);
	await shot(page, 'admin-phone');
});

test('2. ticking "Betald" counts as a payment with today\'s date', async ({ page }) => {
	const sql = postgres(databaseUrl(), { max: 1 });
	try {
		await login(page);
		await page.goto('/admin/gokopen-2027/patrols');
		const unpaid = page.getByRole('button', { name: 'Betald: Hjortarna' });
		await expect(unpaid).toHaveAttribute('aria-pressed', 'false');
		await expect(async () => {
			if ((await unpaid.getAttribute('aria-pressed')) !== 'true') await unpaid.click();
			await expect(unpaid).toHaveAttribute('aria-pressed', 'true', { timeout: 1000 });
		}).toPass({ timeout: 15_000 });
		const [row] = await sql`select paid_at from patrol p join competition c on c.id = p.competition_id where c.slug = 'gokopen-2027' and p.name = 'Hjortarna'`;
		expect(Date.now() - new Date(row.paid_at).getTime()).toBeLessThan(60_000);
		await page.goto('/admin/gokopen-2027/stats');
		await expect(page.getByTestId('payments').locator('[data-k="paid"] dd')).toHaveText('12');
		await expect(page.getByTestId('payments')).toContainText('300 kr kvar att få in');
	} finally {
		await sql`update patrol set paid = false, paid_at = null where name = 'Hjortarna' and competition_id = (select id from competition where slug = 'gokopen-2027')`;
		await sql.end();
	}
});

test('3. public page while live: participation only, nothing about registrations or payments', async ({ browser }) => {
	const ctx = await browser.newContext({ viewport: PHONE });
	const page = await ctx.newPage();
	await page.goto('/r/gokopen-2027');
	await page.getByRole('link', { name: 'Statistik' }).click();
	await expect(page.getByRole('heading', { level: 1, name: 'Statistik' })).toBeVisible();
	await expect(page.getByTestId('participation')).toContainText('14');
	await expect(page.getByTestId('stations-hidden')).toHaveText('Poäng per kontroll och tider visas när tävlingen är avslutad.');
	await expect(page.getByTestId('station-stats')).toHaveCount(0);
	await expect(page.getByText(/Betalningar|Anmälningar per dag|kr inbetalt/)).toHaveCount(0);
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(PHONE.width);
	await shot(page, 'public-live-phone');
	await ctx.close();
});

test('4. public page for the archived year: points per station and times between stations', async ({ browser }) => {
	for (const [name, viewport] of [['desktop', { width: 1280, height: 900 }], ['phone', PHONE]] as const) {
		const ctx = await browser.newContext({ viewport });
		const page = await ctx.newPage();
		await page.goto('/r/gokopen-2026/statistik');
		await expect(page.getByTestId('participation').locator('[data-k="resigned"] dd')).toHaveText('1');
		await expect(page.getByTestId('station-stats').locator('li', { hasText: 'Kojbygge' })).toContainText('Median');
		await expect(page.getByTestId('course-times')).toContainText('Median');
		await expect(page.getByTestId('leg-times').locator('tbody tr').first()).toBeVisible();
		await expect(page.getByText('Från funktionärernas telefoner: 13 patruller med tider.')).toBeVisible();
		await expect(page.getByText(/Betalningar|kr inbetalt/)).toHaveCount(0);
		if (name === 'desktop') {
			// Times per class too: 3 Spårare patrols walked the course (one withdrew).
			await expect(async () => {
				await page.getByRole('button', { name: 'Spårare' }).click();
				await expect(page.getByText('Från funktionärernas telefoner: 3 patruller med tider.')).toBeVisible({ timeout: 1000 });
			}).toPass({ timeout: 15_000 });
			await expect(page.getByTestId('leg-times')).not.toContainText('Pilbågsskytte');
			await shot(page, 'public-archive-sparare');
			await page.getByRole('button', { name: 'Alla klasser' }).click();
		}
		if (name === 'phone') expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(PHONE.width);
		await shot(page, `public-archive-${name}`);
		await ctx.close();
	}
});

test('5. the fee is set in Inställningar → Anmälan', async ({ page }) => {
	const sql = postgres(databaseUrl(), { max: 1 });
	try {
		await login(page);
		await page.goto('/admin/gokopen-2027/settings');
		const fee = page.getByLabel('Avgift per patrull (kr)');
		await expect(fee).toHaveValue('150');
		await fee.fill('12x');
		await page.locator('#anmalan').getByRole('button', { name: /Spara/ }).click();
		await expect(page.getByText('Skriv ett belopp i hela kronor')).toBeVisible();
		await fee.fill('175 kr');
		await page.locator('#anmalan').getByRole('button', { name: /Spara/ }).click();
		await expect(page.locator('#anmalan').getByRole('status')).toContainText('Sparat');
		const [c] = await sql`select fee_per_patrol from competition where slug = 'gokopen-2027'`;
		expect(c.fee_per_patrol).toBe(175);
	} finally {
		await sql`update competition set fee_per_patrol = 150 where slug = 'gokopen-2027'`;
		await sql.end();
	}
});

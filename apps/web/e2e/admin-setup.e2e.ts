import { expect, test } from '@playwright/test';
import postgres from 'postgres';
import { readFileSync } from 'node:fs';

/*
 * Smoke: log in as Bengt → create a 3-day competition → add a station with two
 * items → see FS/F1… codes → overview checklist renders.
 * Run: PORT=5201 scripts/dev-server.sh start && npx playwright test -c e2e/admin-setup.config.ts
 */
const SHOTS = 'e2e/screenshots';

function dbUrl() {
	if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
	const env = readFileSync(new URL('../.env', import.meta.url), 'utf8');
	return /^DATABASE_URL=(.*)$/m.exec(env)?.[1]?.replace(/^["']|["']$/g, '') ?? '';
}

test.beforeAll(async () => {
	// Remove earlier runs so the per-user rate limit (5/day) never trips.
	const sql = postgres(dbUrl(), { max: 1 });
	await sql`delete from competition where slug like 'e2e-hajk%'`;
	await sql.end();
});

test('organiser creates a multi-day competition and edits a station', async ({ page }) => {
	await page.goto('/login');
	await page.getByRole('button', { name: /Logga in som Bengt/ }).click();
	await expect(page).toHaveURL(/\/admin$/);
	await expect(page.getByRole('heading', { name: 'Mina tävlingar' })).toBeVisible();

	await page.getByRole('link', { name: 'Ny tävling' }).click();
	await page.getByLabel('Namn', { exact: true }).fill('E2E Hajk');
	// Addresses show the deployment's own domain (from ORIGIN), whatever the test server uses.
	await expect(page.locator('#name-help')).toContainText(/[\w.:-]+\/e2e-hajk/);
	await page.getByRole('radio', { name: /Flera dagar/ }).check();
	await page.getByLabel('Första dagen').fill('2027-06-11');
	await page.getByLabel('Sista dagen').fill('2027-06-13');
	await expect(page.getByText('3 dagar skapas')).toBeVisible();
	await page.getByLabel('Plats').fill('Testskogen');
	await page.getByLabel('Telefon till tävlingsledningen under dagen').fill('070-000 00 00');
	await page.getByLabel('Antal kontroller').fill('6');
	await page.screenshot({ path: `${SHOTS}/admin-setup-wizard.png`, fullPage: true });
	await page.getByRole('button', { name: /^Skapa E2E Hajk/ }).click();

	await expect(page).toHaveURL(/\/admin\/e2e-hajk$/);
	await expect(page.getByRole('heading', { name: 'Att göra innan tävlingsdagen' })).toBeVisible();
	await expect(page.getByText('Fördela startkontroller')).toBeVisible();

	await page.getByRole('navigation', { name: 'Tävlingsmeny' }).getByRole('link', { name: 'Kontroller' }).click();
	const list = page.getByRole('navigation', { name: 'Kontroller' });
	for (const code of ['FS', 'F1', 'F2', 'FM', 'LS', 'L1', 'LM', 'SS', 'SM']) {
		await expect(list.getByText(code, { exact: true })).toBeVisible();
	}

	// New station on the selected day (Fredag) with two items.
	await page.getByRole('button', { name: '+ Ny kontroll' }).first().click();
	await expect(page.getByRole('heading', { name: /Ny kontroll/ }).first()).toBeVisible();
	await page.getByLabel('Namn', { exact: true }).fill('Orientering');
	await page.getByLabel('Namn på del 1').fill('Orientering');
	await page.getByRole('button', { name: '+ Lägg till del' }).click();
	await page.getByLabel('Namn på del 2').fill('Nödbrev');
	await page
		.getByRole('radio', { name: /Fasta värden/ })
		.nth(1)
		.check({ force: true });
	await expect(page.getByRole('list', { name: 'Tillåtna poäng för Nödbrev' })).toBeVisible();
	await page.getByRole('button', { name: 'Spara kontrollen' }).click();
	await expect(page.getByRole('status').filter({ hasText: 'Sparat' })).toBeVisible();
	await expect(list.getByText('2 delar · Alla')).toBeVisible();
	await expect(list.getByText('F3', { exact: true })).toBeVisible();
	await page.evaluate(() => window.scrollTo(0, 0));
	await page.screenshot({ path: `${SHOTS}/admin-setup-stations.png`, fullPage: true });

	await page.getByRole('navigation', { name: 'Tävlingsmeny' }).getByRole('link', { name: 'Översikt' }).click();
	await expect(page.getByText('Kontroller & poängregler')).toBeVisible();
	await page.screenshot({ path: `${SHOTS}/admin-setup-overview.png`, fullPage: true });

	await page.getByRole('navigation', { name: 'Tävlingsmeny' }).getByRole('link', { name: 'Inställningar' }).click();
	await expect(page.getByRole('heading', { name: 'Dagar' })).toBeVisible();
	await page.getByLabel('Bjud in med medlemsnummer').fill('9999999');
	await page.getByRole('button', { name: 'Lägg till arrangör' }).click();
	await expect(page.getByText(/måste logga in en gång först/)).toBeVisible();
	await page.getByRole('button', { name: 'Spara grundinfo' }).click();
	await expect(page.getByRole('status').filter({ hasText: 'Sparat' })).toBeVisible();

	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto('/admin/e2e-hajk/stations');
	await page.screenshot({ path: `${SHOTS}/admin-setup-stations-mobile.png`, fullPage: true });
});

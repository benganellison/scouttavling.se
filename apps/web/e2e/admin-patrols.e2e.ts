import { expect, test } from '@playwright/test';

/**
 * admin-patrols flow: import (browser-side parsing, sensitive columns never sent),
 * fix issues, distribute, invite QR, scorecards.
 * Run: cd apps/web && PORT=5202 scripts/dev-server.sh start && npx playwright test -c e2e/admin-patrols.config.ts
 * All data below is invented.
 */

const SHOTS = 'e2e/screenshots/admin-patrols';
const SLUG = 'gokhajk-2027';
const FAKE_PNR = '20120314-9876';

function scoutnetHtml(): string {
	const pre = 'Anmälan till GökHajk 2027 - ';
	const headers = ['Medlemsnummer', 'Förnamn', 'Efternamn', 'Personnummer', 'Anmäld', 'Kår', `${pre}Patrullnamn`, `${pre}Vilken klass`, `${pre}Scoutkår`, `${pre}Alla i patrullen`, 'Mobilnummer', 'E-post', 'Betalda skulder'];
	const rows = [
		['3900101', 'Kim', 'Testsson', FAKE_PNR, 'Ja', 'Påhittsby scoutkår', 'Tjädrarna', 'Utmanare', 'Påhittsby scoutkår', 'Alva Testberg, 2012<br>Bo Påhittsson<br>Cleo Exempel', '0701234567', 'kim@example.org', 'Betald'],
		['3900102', 'Lo', 'Låtsas', '20110505-1111', 'Ja', 'Hittepå scoutkår', 'Järvarna', 'Ledare/Rover', 'Hittepå Scoutkår', 'Dan Fiktiv<br>Eva Uppdikt<br>+ en till?', '070-765 43 21', 'lo@example.org', '-'],
		['3900103', 'Mo', 'Tänkt', '20100909-2222', 'Ja', 'Hittepå scoutkår', 'Ormvråkarna', 'Äventyrare', 'hittepå scoutkår', 'Fia Fantasi<br>Gus Gissad', '0739998877', 'mo@example.org', 'Betald'],
		['3900104', 'No', 'Påhitt', '20100101-3333', 'Nej', 'Påhittsby scoutkår', 'Spökena', 'Utmanare', 'Påhittsby scoutkår', 'Ingen Alls', '0700000000', 'no@example.org', '-']
	];
	const tr = (cells: string[], tag: 'th' | 'td') => `<tr>${cells.map((c) => `<${tag}>${c}</${tag}>`).join('')}</tr>`;
	return `<html><head><meta charset="utf-8"></head><body><table>${tr(headers, 'th')}${rows.map((r) => tr(r, 'td')).join('')}</table></body></html>`;
}

test('import, distribute, invite and print', async ({ page }) => {
	// 1. Log in as Erik (dev login)
	await page.goto('/login');
	await page.getByRole('button', { name: /Logga in som Erik/ }).click();
	await page.waitForURL(/\/admin/);

	// 2. Import a fake Scoutnet export
	await page.goto(`/admin/${SLUG}/import`);
	await page.waitForLoadState('networkidle'); // wait for hydration before using the file input
	await page.locator('input[type=file]').setInputFiles({ name: 'hajkanmalan.xls', mimeType: 'application/vnd.ms-excel', buffer: Buffer.from(scoutnetHtml(), 'utf-8') });

	// 3. Sensitive column is listed under "Läses aldrig in"
	const never = page.locator('section.never');
	await expect(never.getByRole('heading', { name: 'Läses aldrig in' })).toBeVisible();
	await expect(never.getByText('Personnummer', { exact: true })).toBeVisible();
	await expect(page.getByText('Scoutnet-export', { exact: true })).toBeVisible();
	await expect(page.locator('select#map3')).toHaveCount(0); // the personnummer column cannot be mapped
	await page.screenshot({ path: `${SHOTS}-import-columns.png`, fullPage: true });

	// 4. Review and fix issues
	await page.getByRole('button', { name: 'Granska', exact: true }).click();
	await expect(page.getByText(/Klassen ”Äventyrare” finns inte/)).toBeVisible();
	await page.getByRole('button', { name: /^Lägg i / }).click();
	await expect(page.getByText('Läggs i Utmanare.')).toBeVisible();
	await page.getByRole('button', { name: /^Slå ihop/ }).click();
	await page.getByRole('button', { name: 'Visa och rätta' }).click();
	await page.getByRole('button', { name: 'Godkänn resten (utan anteckningar)' }).click();
	await expect(page.getByText('Medlemslistorna är granskade.')).toBeVisible();
	await expect(page.getByText(/1 rad hoppas över/)).toBeVisible();
	await page.screenshot({ path: `${SHOTS}-import-review.png`, fullPage: true });

	const commit = page.waitForRequest((r) => r.method() === 'POST' && r.url().includes('commit'));
	await page.getByRole('button', { name: /^Importera 3 patruller/ }).click();
	const req = await commit;
	const body = req.postData() ?? '';
	expect(body).toContain('Tjädrarna');
	expect(body.toLowerCase()).not.toContain('personnummer');
	for (const pnr of [FAKE_PNR, '20110505', '20100909', '1111', '3333']) expect(body).not.toContain(pnr);
	await expect(page.getByText('3 patruller importerade.')).toBeVisible();
	await page.screenshot({ path: `${SHOTS}-import-done.png`, fullPage: true });

	// 5. Distribution
	await page.getByRole('link', { name: 'Fördela startkontroller' }).click();
	await page.waitForURL(/distribution/);
	await expect(page.getByRole('heading', { name: 'Fördela startkontroller' })).toBeVisible();
	await page.getByText('Alla tillsammans').click();
	await page.getByText('Jämnt & smart').click();
	await page.getByRole('button', { name: 'Slumpa om' }).click();
	await page.getByRole('button', { name: 'Spara fördelning' }).click();
	await expect(page.getByText(/Fördelningen är sparad för \d+ patruller/)).toBeVisible();
	await page.screenshot({ path: `${SHOTS}-distribution.png`, fullPage: true });

	// 6. Invite with QR
	await page.goto(`/admin/${SLUG}/invites`);
	await page.getByRole('link', { name: /Lägerbygge/ }).click();
	await expect(page.getByRole('heading', { name: /Lägerbygge/ })).toBeVisible();
	const create = page.getByRole('button', { name: /Skapa inbjudan|Skapa ny kod$/ });
	if (await create.isVisible()) await create.click();
	await expect(page.locator('.panel .qr svg')).toBeVisible();
	await expect(page.locator('#invlink')).toHaveValue(/\/j\/[A-Za-z0-9_-]{22}$/);
	await page.screenshot({ path: `${SHOTS}-invites.png`, fullPage: true });

	// 7. Scorecards for the multi-day competition use paper codes
	await page.goto(`/admin/${SLUG}/print/scorecards`);
	const first = page.locator('section.scard').first();
	await expect(first.locator('.cell strong', { hasText: /^FS$/ })).toBeVisible();
	await expect(first.locator('.cell strong', { hasText: /^F1$/ })).toBeVisible();
	await expect(first.locator('.dlabel', { hasText: 'Fredag' })).toBeVisible();
	await expect(first.locator('.qr svg')).toBeVisible();
	await page.screenshot({ path: `${SHOTS}-scorecards.png`, fullPage: true });

	// Extra screenshots for layout review
	for (const [path, name] of [
		[`/admin/${SLUG}/patrols`, 'patrols'],
		[`/admin/gokopen-2027/distribution`, 'distribution-open'],
		[`/admin/${SLUG}/print`, 'print'],
		[`/admin/${SLUG}/print/signs`, 'signs'],
		[`/admin/gokopen-2027/print/protocol`, 'protocol'],
		[`/admin/gokopen-2027/print/scorecards?names=1`, 'scorecards-open'],
		[`/admin/${SLUG}/print/startlists`, 'startlists'],
		[`/admin/gokopen-2027/patrols/112/edit`, 'patrol-edit']
	] as const) {
		await page.goto(path);
		await page.screenshot({ path: `${SHOTS}-${name}.png`, fullPage: !path.includes('/print/') });
	}
});

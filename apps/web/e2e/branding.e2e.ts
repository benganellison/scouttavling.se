/**
 * Event branding: uploads (event logo, organiser logo, cover), accent colour, where it shows
 * (/t, /m, /folj, volunteer phone, scorecards), the SVG-disguised-as-PNG rejection and
 * Scouterna as sender (blue logo on light, white on dark). Images are generated; no real files.
 * Run: (in apps/web) PORT=5205 scripts/dev-server.sh start && npx playwright test -c e2e/branding.config.ts
 */
import { test, expect, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { encodePng } from '../src/lib/server/pngEncode.ts';
import { SLUG, compId, createInvite, sql } from './field-db.ts';

test.describe.configure({ mode: 'serial' });

const PHONE = { width: 390, height: 844 };
const shot = (p: Page, n: string) => p.screenshot({ path: `e2e/screenshots/branding-${n}.png`, fullPage: true });
const sha = (t: string) => createHash('sha256').update(t).digest('base64url');
const TOKEN_M = 'brandingManageToken012';
const TOKEN_F = 'brandingFollowToken012';

const png = (w: number, h: number, rgb: [number, number, number]) =>
	Buffer.from(encodePng(w, h, (x, y) => ((x + y) % 7 === 0 ? [255, 255, 255, 255] : [...rgb, 255]), { Author: 'Testperson', GPS: '59.3N 18.0E' }));

let origAccent: string | null = null;

async function upload(page: Page, kind: string, file: { name: string; mimeType: string; buffer: Buffer }) {
	const box = page.getByTestId(`img-${kind}`);
	await box.locator('input[type=file]').setInputFiles(file);
	await box.getByRole('button', { name: /Ladda upp|Byt bild/ }).click();
}

test.beforeAll(async () => {
	const cid = await compId();
	[{ accent_color: origAccent }] = await sql`select accent_color from competition where id = ${cid}`;
	await sql`update competition set follow_enabled = true, cover_fit = null where id = ${cid}`;
	await sql`update patrol set manage_token_hash = ${sha(TOKEN_M)}, follow_token_hash = ${sha(TOKEN_F)} where competition_id = ${cid} and number = 112`;
});

test.afterAll(async () => {
	const cid = await compId();
	await sql`update competition set accent_color = ${origAccent} where id = ${cid}`;
	await sql`delete from asset where competition_id = ${cid} and kind in ('organiser_logo', 'cover')`;
	await sql.end();
});

test('organiser uploads logos and cover, sets the accent; SVG in disguise is rejected', async ({ page }) => {
	await page.goto('/login');
	// Scouterna as sender on the login page: white logo on Scoutblå.
	await expect(page.locator('[data-scouterna-logo="white"] img[alt="Scouterna"]')).toBeVisible();
	await page.getByRole('button', { name: /Logga in som Erik/ }).click();
	await page.waitForURL(/\/admin/);
	await page.goto(`/admin/${SLUG}/settings#utseende`);
	await expect(page.getByRole('heading', { name: 'Utseende' })).toBeVisible();
	// Admin sidebar footer: white Scouterna logo on Scoutblå.
	await expect(page.locator('aside.sidebar [data-scouterna-logo="white"] img')).toHaveCount(1);

	// A script-carrying SVG named and typed as PNG is refused by content.
	const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script></svg>');
	await upload(page, 'event_logo', { name: 'logo.png', mimeType: 'image/png', buffer: svg });
	await expect(page.getByTestId('img-event_logo').getByRole('alert')).toContainText('Bara PNG, JPEG och WebP');
	// HTML behind a PNG signature too.
	const fake = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('<html><script>alert(1)</script></html>')]);
	await upload(page, 'cover', { name: 'cover.png', mimeType: 'image/png', buffer: fake });
	await expect(page.getByTestId('img-cover').getByRole('alert')).toContainText('skadad');

	await upload(page, 'event_logo', { name: 'event.png', mimeType: 'image/png', buffer: png(120, 120, [0, 54, 96]) });
	await expect(page.getByTestId('img-event_logo').getByText('Uppladdad')).toBeVisible();
	await upload(page, 'organiser_logo', { name: 'kar.png', mimeType: 'image/png', buffer: png(160, 80, [65, 166, 42]) });
	await expect(page.getByTestId('img-organiser_logo').getByText('Uppladdad')).toBeVisible();
	// A wide banner (3:1): shown whole by default.
	await upload(page, 'cover', { name: 'banner.png', mimeType: 'image/png', buffer: png(600, 200, [30, 90, 60]) });
	await expect(page.getByTestId('img-cover').getByText('Uppladdad')).toBeVisible();

	// Accent: Utmanarrosa, live contrast note, saved.
	await page.getByRole('button', { name: 'Utmanarrosa' }).first().click();
	await expect(page.locator('input[name=accentColor]')).toHaveValue('#da005e');
	await expect(page.getByTestId('contrast-note')).toContainText('Vit text på färgen');
	await page.getByRole('button', { name: 'Spara utseende' }).click();
	await expect.poll(async () => (await sql`select accent_color from competition where slug = ${SLUG}`)[0].accent_color).toBe('#da005e');
	await expect(page.getByTestId('preview-public')).toBeVisible();
	await expect(page.getByTestId('preview-phone')).toBeVisible();

	// Stored bytes were stripped of the PNG text chunks and are served safely.
	const [a] = await sql`select a.id, a.data from asset a join competition c on c.id = a.competition_id where c.slug = ${SLUG} and a.kind = 'cover'`;
	expect(Buffer.from(a.data).includes(Buffer.from('Testperson'))).toBe(false);
	const res = await page.request.get(`/media/${a.id}`);
	expect(res.headers()['content-type']).toBe('image/png');
	expect(res.headers()['x-content-type-options']).toBe('nosniff');
	expect(res.headers()['content-security-policy']).toContain("default-src 'none'");
	expect(res.headers()['cache-control']).toContain('immutable');
	await shot(page, 'settings');

	// Admin sidebar shows the small event logo.
	await expect(page.locator('aside.sidebar img[alt="GökOpen 2027"]')).toBeVisible();

	// Scorecards carry the event logo, the class colour and Scouterna.
	await page.goto(`/admin/${SLUG}/print/scorecards`);
	await expect(page.getByTestId('print-event-logo').first()).toBeVisible();
	await expect(page.locator('.scard[data-track-color]').first()).toBeVisible();
	await expect(page.locator('.scard [data-scouterna-logo="blue"]').first()).toBeVisible();
	await shot(page, 'scorecards');
});

test('public pages show cover, event and organiser logos and Scouterna (blue on light)', async ({ browser }) => {
	const ctx = await browser.newContext({ viewport: PHONE, isMobile: true, hasTouch: true });
	const page = await ctx.newPage();
	await page.goto(`/t/${SLUG}`);
	const cover = page.getByTestId('cover');
	await expect(cover).toBeVisible();
	await expect(cover).toHaveAttribute('data-fit', 'contain');
	await expect(cover).toHaveAttribute('alt', 'GökOpen 2027');
	// Never upscaled beyond 2× and never wider than the screen.
	const w = await cover.evaluate((el) => el.getBoundingClientRect().width);
	expect(w).toBeLessThanOrEqual(390);
	await expect(page.locator('header img[alt="GökOpen 2027"]')).toBeVisible();
	await expect(page.getByRole('heading', { level: 1, name: 'GökOpen 2027' })).toBeVisible();
	const sender = page.getByRole('contentinfo', { name: 'Avsändare' });
	await expect(sender.locator('img[alt="Granlidens scoutkår"]')).toBeVisible();
	await expect(sender).toContainText('Arrangeras av Granlidens scoutkår · Scouterna');
	await expect(sender.locator('[data-scouterna-logo="blue"] img[alt="Scouterna"]')).toBeVisible();
	await expect(page.locator('.shell')).toHaveAttribute('data-accent', '#da005e');
	await expect(page.locator('[data-track-color]').first()).toBeVisible();
	await shot(page, 't');

	await page.goto(`/m/${TOKEN_M}`);
	await expect(page.getByTestId('patrol-pass')).toBeVisible();
	await expect(page.locator('header img[alt="GökOpen 2027"]')).toBeVisible();
	await expect(page.locator('[data-scouterna-logo="blue"]')).toBeVisible();
	await shot(page, 'm');

	await page.goto(`/folj/${TOKEN_F}`);
	await expect(page.getByTestId('follow-summary')).toBeVisible();
	await expect(page.locator('header img[alt="GökOpen 2027"]')).toBeVisible();
	await expect(page.locator('[data-scouterna-logo="blue"]')).toBeVisible();
	await shot(page, 'folj');

	await page.goto(`/r/${SLUG}`);
	await expect(page.locator('[data-scouterna-logo="blue"]')).toBeVisible();
	await ctx.close();
});

test('volunteer phone header shows the event logo and accent', async ({ browser }) => {
	const ctx = await browser.newContext({ viewport: PHONE, isMobile: true, hasTouch: true });
	const page = await ctx.newPage();
	await page.goto(`/j/${await createInvite('Kojbygge')}`);
	await page.getByLabel('Vad heter du?').fill('Anna Berg');
	await page.getByRole('button', { name: 'Öppna min kontroll' }).click();
	await expect(page.getByText(/Hej Anna/)).toBeVisible();
	const head = page.locator('header.fhead');
	await expect(head.locator('img[alt="GökOpen 2027"]')).toBeVisible();
	const stripe = await head.evaluate((el) => getComputedStyle(el).borderTopColor);
	expect(stripe).toBe('rgb(218, 0, 94)');
	await shot(page, 'phone');
	await ctx.close();
});

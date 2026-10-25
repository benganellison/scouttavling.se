/**
 * Event branding: uploads (event logo, organiser logo, cover), accent colour, where it shows
 * (/t, /m, /folj, volunteer phone, scorecards), the SVG-disguised-as-PNG rejection and
 * Scouterna as sender (blue logo on light, white on dark). The uploads are the invented seed images
 * (scripts/seed-assets/, rendered by scripts/make-seed-assets.ts); the metadata check uses a generated PNG.
 * Run: (in apps/web) PORT=5205 scripts/dev-server.sh start && npx playwright test -c e2e/branding.config.ts
 */
import { test, expect, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
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

/** An invented seed image, with text chunks added so the metadata stripping is still tested. */
const seedAsset = (file: string) => {
	const b = readFileSync(`scripts/seed-assets/${file}`);
	// Insert a tEXt chunk right after IHDR (8-byte signature + 25-byte IHDR chunk).
	const text = Buffer.from('Author\0Testperson');
	const chunk = Buffer.alloc(12 + text.length);
	chunk.writeUInt32BE(text.length, 0);
	chunk.write('tEXt', 4, 'latin1');
	text.copy(chunk, 8);
	chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + text.length)), 8 + text.length);
	return { name: file, mimeType: 'image/png', buffer: Buffer.concat([b.subarray(0, 33), chunk, b.subarray(33)]) };
};
function crc32(b: Uint8Array) {
	let c = ~0;
	for (const x of b) {
		c ^= x;
		for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
	}
	return ~c >>> 0;
}

let origAccent: string | null = null;
let origFit: string | null = null;
let origSeriesFit: string | null = null;

async function upload(page: Page, kind: string, file: { name: string; mimeType: string; buffer: Buffer }) {
	const box = page.getByTestId(`img-${kind}`);
	await box.locator('input[type=file]').setInputFiles(file);
	await box.getByRole('button', { name: /Ladda upp|Byt bild|Egen bild i år/ }).click();
}

test.beforeAll(async () => {
	const cid = await compId();
	[{ accent_color: origAccent, cover_fit: origFit }] = await sql`select accent_color, cover_fit from competition where id = ${cid}`;
	await sql`update competition set follow_enabled = true, cover_fit = null where id = ${cid}`;
	// Automatic cover fit is tested, so the series (which the edition inherits from) must not force one either.
	[{ cover_fit: origSeriesFit }] = await sql`select s.cover_fit from series s join competition c on c.series_id = s.id where c.id = ${cid}`;
	await sql`update series set cover_fit = null where id = (select series_id from competition where id = ${cid})`;
	await sql`update patrol set manage_token_hash = ${sha(TOKEN_M)}, follow_token_hash = ${sha(TOKEN_F)} where competition_id = ${cid} and number = 112`;
});

test.afterAll(async () => {
	const cid = await compId();
	// The uploads became this edition's own images (the seed keeps them on the series): drop them and restore the settings.
	await sql`delete from asset where competition_id = ${cid}`;
	await sql`update series set cover_fit = ${origSeriesFit} where id = (select series_id from competition where id = ${cid})`;
	await sql`update competition set accent_color = ${origAccent}, cover_fit = ${origFit} where id = ${cid}`;
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

	// A generated image is accepted too (its metadata is stripped, checked below), then replaced by the real logo.
	await upload(page, 'event_logo', { name: 'event.png', mimeType: 'image/png', buffer: png(120, 120, [0, 54, 96]) });
	await expect(page.getByTestId('img-event_logo').getByText('Uppladdad')).toBeVisible();
	const [gen] = await sql`select a.data from asset a join competition c on c.id = a.competition_id where c.slug = ${SLUG} and a.kind = 'event_logo'`;
	expect(Buffer.from(gen.data).includes(Buffer.from('Testperson'))).toBe(false);
	expect(Buffer.from(gen.data).includes(Buffer.from('59.3N'))).toBe(false);

	await upload(page, 'event_logo', seedAsset('gokopen-logo.png'));
	await expect(page.getByTestId('img-event_logo').getByText('Uppladdad')).toBeVisible();
	await upload(page, 'organiser_logo', seedAsset('granliden-logo.png'));
	await expect(page.getByTestId('img-organiser_logo').getByText('Uppladdad')).toBeVisible();
	// A wide banner (1600×560, wider than 2.5:1): shown whole by default.
	await upload(page, 'cover', seedAsset('gokopen-cover.png'));
	await expect(page.getByTestId('img-cover').getByText('Uppladdad')).toBeVisible();

	// Accent: Utmanarrosa, live contrast note, saved.
	// (Retried: the last upload's page data may still be refreshing when the swatch is first tapped.)
	await page.waitForLoadState('networkidle');
	await expect(async () => {
		await page.getByRole('button', { name: 'Utmanarrosa' }).first().click();
		await expect(page.locator('input[name=accentColor]')).toHaveValue('#da005e', { timeout: 1500 });
	}).toPass({ timeout: 15_000 });
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

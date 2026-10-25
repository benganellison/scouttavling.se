/**
 * Competition series: the public archive (/t/gokopen), "Skapa GökOpen 2028" from 2027, closing an
 * edition and "Ta bort personuppgifter" (old /m and /folj links show the archived page, results are
 * unchanged, no names left), and hiding a year from the archive. Runs on the seeded demo data and
 * cleans up after itself (GökOpen 2028 is deleted). All names are invented.
 * Run: (in apps/web) npm run db:seed && PORT=5205 scripts/dev-server.sh start && npx playwright test -c e2e/series.config.ts
 */
import { test, expect, type Page, type Browser } from '@playwright/test';
import { createHash } from 'node:crypto';
import { sql } from './field-db.ts';

test.describe.configure({ mode: 'serial' });

const PHONE = { width: 390, height: 844 };
const shot = (p: Page, n: string) => p.screenshot({ path: `e2e/screenshots/series-${n}.png`, fullPage: true });
const sha = (t: string) => createHash('sha256').update(t).digest('base64url');
const NEW = 'gokopen-2028';
const TOKEN_M = 'seriesManageToken01234';
const TOKEN_F = 'seriesFollowToken01234';
const NAMES = ['Tindra Testsson', 'Kontakt Påhittad', 'Volontär Exempelsson'];

async function login(page: Page) {
	await page.goto('/login');
	await page.getByRole('button', { name: /Logga in som Erik/ }).click();
	await page.waitForURL(/\/admin/);
}

async function cleanup() {
	await sql`delete from competition where slug = ${NEW}`;
	await sql`update competition set archive_public = true where slug = 'gokopen-2026'`;
}

test.beforeAll(cleanup);
test.afterAll(async () => {
	await cleanup();
	await sql.end();
});

test('1. the GökOpen series page shows this year and 2026 in the archive', async ({ browser }) => {
	for (const [name, viewport] of [['desktop', { width: 1280, height: 900 }], ['phone', PHONE]] as const) {
		const ctx = await browser.newContext({ viewport });
		const page = await ctx.newPage();
		await page.goto('/t/gokopen');
		await expect(page.getByRole('heading', { level: 1, name: 'GökOpen' })).toBeVisible();
		await expect(page.getByTestId('series-current')).toContainText('GökOpen 2027');
		await expect(page.getByTestId('series-current').getByRole('link', { name: 'Anmäl en patrull' })).toHaveAttribute('href', '/t/gokopen-2027/anmal');
		const y = page.getByTestId('archive-2026');
		await expect(y).toContainText('GökOpen 2026');
		await expect(y).toContainText('13 patruller');
		await expect(y.getByRole('list', { name: 'Vinnare 2026' }).getByRole('listitem')).toHaveCount(4);
		await expect(y.getByRole('link', { name: 'Resultat 2026' })).toHaveAttribute('href', '/r/gokopen-2026');
		// Branding comes from the series (cover image + accent).
		await expect(page.getByTestId('cover')).toBeVisible();
		await expect(page.locator('.shell')).toHaveAttribute('data-accent', '#00a8e1');
		if (name === 'phone') expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
		await shot(page, `public-${name}`);
		await ctx.close();
	}
	// The frozen results of 2026 are public, and the old edition URL still works.
	const ctx = await browser.newContext();
	const page = await ctx.newPage();
	await page.goto('/r/gokopen-2026');
	await expect(page.getByTestId('final')).toHaveText('Slutresultat');
	await expect(page.getByText('Myrorna').first()).toBeVisible();
	await page.goto('/t/gokopen-2027');
	await expect(page.getByTestId('series-link')).toHaveAttribute('href', '/t/gokopen');
	await ctx.close();
});

test('2. create GökOpen 2028 from 2027: stations and classes copied, no patrols', async ({ page }) => {
	await login(page);
	await page.goto('/admin');
	await expect(page.getByTestId('group-gokopen')).toContainText('GökOpen 2026');
	await expect(page.getByTestId('group-gokopen')).toContainText('GökOpen 2027');
	await shot(page, 'admin-list');

	await page.getByTestId('group-gokopen').getByRole('link', { name: 'Serien' }).click();
	await page.waitForURL('/admin/series/gokopen');
	await expect(page.getByTestId('edition-2026')).toContainText('Arkiverad');
	await shot(page, 'admin-series');
	await page.getByTestId('series-next').click();
	await page.waitForURL(`/admin/gokopen-2027/next-edition`);
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Skapa GökOpen 2028');
	// Saturday 15 May 2027 → Saturday 13 May 2028.
	await expect(page.locator('#date_0')).toHaveValue('2028-05-13');
	await expect(page.getByText('lördag · förra året lör 15 maj')).toBeVisible();
	await shot(page, 'new-year-form');
	await page.getByRole('button', { name: 'Skapa GökOpen 2028' }).click();
	await page.waitForURL(`/admin/${NEW}?ny=1`);

	const [c] = await sql`select *, start_date::text sd from competition where slug = ${NEW}`;
	expect(c).toMatchObject({ name: 'GökOpen 2028', edition_year: 2028, status: 'draft', registration_open: false, sd: '2028-05-13', hq_phone: null });
	const [src] = await sql`select id, series_id, patrol_code_key from competition where slug = 'gokopen-2027'`;
	expect(c.series_id).toBe(src.series_id);
	expect(c.patrol_code_key).not.toBe(src.patrol_code_key);
	const count = async (q: Promise<{ n: number }[]>) => (await q)[0].n;
	expect(await count(sql`select count(*)::int n from station where competition_id = ${c.id}`)).toBe(14);
	expect(await count(sql`select count(*)::int n from station where competition_id = ${c.id} and role = 'finish'`)).toBe(1);
	expect(await count(sql`select count(*)::int n from score_item i join station s on s.id = i.station_id where s.competition_id = ${c.id}`)).toBe(17);
	expect(await count(sql`select count(*)::int n from station_track st join station s on s.id = st.station_id where s.competition_id = ${c.id}`)).toBe(6);
	expect(await count(sql`select count(*)::int n from track where competition_id = ${c.id}`)).toBe(5);
	expect(await count(sql`select count(*)::int n from patrol where competition_id = ${c.id}`)).toBe(0);
	expect(await count(sql`select count(*)::int n from score where competition_id = ${c.id}`)).toBe(0);
	expect(await count(sql`select count(*)::int n from message where competition_id = ${c.id}`)).toBe(0);
	// Branding is inherited from the series, not copied.
	expect(await count(sql`select count(*)::int n from asset where competition_id = ${c.id}`)).toBe(0);
	// The series page now offers 2029, not 2028.
	await page.goto('/admin/series/gokopen');
	await expect(page.getByTestId('series-next')).toHaveText('Skapa GökOpen 2029');
});

/** Invented personal data in 2028: patrols with members, contacts and links, a device, a message, scores. */
async function fillEdition() {
	const [c] = await sql`select id from competition where slug = ${NEW}`;
	const tracks = await sql`select id, name from track where competition_id = ${c.id} order by sort`;
	const items = await sql`select i.id from score_item i join station s on s.id = i.station_id where s.competition_id = ${c.id} and i.mode = 'RANGE' and s.all_tracks order by s.sort limit 3`;
	const T = Object.fromEntries(tracks.map((t) => [t.name, t.id]));
	const defs: [number, string, string, number[]][] = [
		[201, 'Spillkråkorna', 'Upptäckare', [18, 15, 12]], [202, 'Sälarna', 'Upptäckare', [14, 19, 16]], [203, 'Lärkorna', 'Spårare', [11, 9, 13]], [204, 'Mårdarna', 'Spårare', [11, 9, 13]]
	];
	for (const [nr, name, track, pts] of defs) {
		const [p] = await sql`insert into patrol (competition_id, number, name, track_id, troop, status, contact_name, contact_phone, contact_email, manage_token_hash, follow_token_hash)
			values (${c.id}, ${nr}, ${name}, ${T[track]}, 'Granlidens scoutkår', 'finished', ${NAMES[1]}, '070-000 00 99', 'kontakt@example.org',
				${nr === 201 ? sha(TOKEN_M) : null}, ${nr === 201 ? sha(TOKEN_F) : null}) returning id`;
		await sql`insert into member (patrol_id, first_name, last_name) values (${p.id}, 'Tindra', 'Testsson'), (${p.id}, 'Ebbe', 'Exempel')`;
		for (const [i, v] of pts.entries()) {
			const [sc] = await sql`insert into score (competition_id, patrol_id, item_id, points, style_points, raw, origin, note)
				values (${c.id}, ${p.id}, ${items[i].id}, ${v}, 3, ${sql.json({ value: v, style: 3 })}, 'admin', ${'Rättat av ' + NAMES[0]}) returning id`;
			await sql`insert into score_revision (score_id, version, points, style_points, state, origin, reason) values (${sc.id}, 1, ${v}, 3, 'active', 'admin', ${'Enligt ' + NAMES[0]})`;
		}
	}
	const [inv] = await sql`select id from invite where competition_id = ${c.id} limit 1`;
	const inviteId = inv?.id ?? (await sql`insert into invite (competition_id, role, secret_hash) values (${c.id}, 'startfinish', ${sha('seriesInvite' + Date.now())}) returning id`)[0].id;
	await sql`insert into device (competition_id, invite_id, role, display_name, public_jwk) values (${c.id}, ${inviteId}, 'startfinish', ${NAMES[2]}, ${sql.json({ kty: 'EC' })})`;
	await sql`insert into message (competition_id, title, body) values (${c.id}, 'Hej', ${'Ring ' + NAMES[2]})`;
	await sql`update station set contact_name = ${NAMES[2]}, contact_phone = '070-123' where competition_id = ${c.id} and name = 'Kojbygge'`;
	await sql`update competition set hq_phone = '070-555 55 55', public_results = true, follow_enabled = true where id = ${c.id}`;
	return c.id as string;
}

const resultsText = async (browser: Browser) => {
	const ctx = await browser.newContext();
	const p = await ctx.newPage();
	await p.goto(`/r/${NEW}`);
	await expect(p.getByText('Lärkorna').first()).toBeVisible();
	// Every class tab, in order.
	const out: string[] = [];
	const tabs = p.getByRole('navigation', { name: 'Klasser' }).getByRole('button');
	for (let i = 0; i < (await tabs.count()); i++) {
		const name = (await tabs.nth(i).innerText()).trim();
		await expect(async () => {
			await tabs.nth(i).click();
			await expect(p.getByRole('heading', { level: 1 })).toHaveText(`Resultat ${name}`, { timeout: 1000 });
		}).toPass();
		out.push(await p.locator('main').innerText());
	}
	await ctx.close();
	expect(out.join('\n')).toContain('Spillkråkorna');
	return out;
};

test('3. close 2028, remove personal data: links archived, results unchanged, no names left', async ({ page, browser }) => {
	const cid = await fillEdition();
	await login(page);
	await page.goto(`/admin/${NEW}`);
	await page.getByRole('button', { name: 'Gör tävlingen live' }).click();
	await page.getByRole('button', { name: 'Avsluta' }).click();
	const reminder = page.getByTestId('personal-data-reminder');
	await expect(reminder).toContainText('Personuppgifter finns kvar för 4 patruller – ta bort när resultaten är klara');
	await expect(page.getByTestId('next-edition')).toContainText('Skapa GökOpen 2029');
	await shot(page, 'closed-overview');
	const before = await resultsText(browser);

	await reminder.getByRole('link', { name: 'Ta bort personuppgifter' }).click();
	await page.waitForURL(`/admin/${NEW}/anonymise`);
	await expect(page.getByText('Det går inte att ångra.')).toBeVisible();
	const go = page.getByRole('button', { name: 'Ta bort personuppgifter permanent' });
	await expect(go).toBeDisabled();
	await page.getByLabel(/Skriv tävlingens namn/).fill('GökOpen 2028');
	await shot(page, 'remove-confirm');
	await go.click();
	await page.waitForURL(`/admin/${NEW}?arkiverad=1`);
	await expect(page.getByTestId('archived-note')).toContainText('Tävlingen är skrivskyddad');
	await expect(page.getByTestId('personal-data-reminder')).toHaveCount(0);
	await expect(page.getByRole('button', { name: /Öppna/ })).toHaveCount(0);
	await shot(page, 'anonymised-overview');

	// Old patrol links land on the archived page.
	for (const link of [`/m/${TOKEN_M}`, `/folj/${TOKEN_F}`]) {
		await page.goto(link);
		await page.waitForURL(`/arkiverad/${NEW}`);
		await expect(page.getByTestId('archived')).toContainText('Tävlingen är avslutad och arkiverad');
	}
	// Results are identical.
	expect(await resultsText(browser)).toEqual(before);
	// The admin patrol view shows no names.
	await page.goto(`/admin/${NEW}/patrols`);
	await expect(page.getByText('Spillkråkorna').first()).toBeVisible();
	const text = await page.locator('main').innerText();
	for (const n of [...NAMES, 'Tindra', 'Ebbe', 'kontakt@example.org']) expect(text).not.toContain(n);
	// Read-only: a write is refused.
	const r = await page.request.post(`/admin/${NEW}?/status`, { form: { to: 'live' }, headers: { origin: new URL(page.url()).origin } });
	expect(r.status()).toBe(409);
	// Nothing personal is left in the database.
	const left = await sql`select
		(select count(*)::int from member m join patrol p on p.id = m.patrol_id where p.competition_id = ${cid}) members,
		(select count(*)::int from patrol where competition_id = ${cid} and (contact_name is not null or contact_email is not null or manage_token_hash is not null or follow_token_hash is not null)) contacts,
		(select count(*)::int from device where competition_id = ${cid}) devices,
		(select count(*)::int from message where competition_id = ${cid}) messages,
		(select count(*)::int from score where competition_id = ${cid} and note is not null) notes,
		(select count(*)::int from station where competition_id = ${cid} and contact_name is not null) station_contacts`;
	expect(left[0]).toEqual({ members: 0, contacts: 0, devices: 0, messages: 0, notes: 0, station_contacts: 0 });
});

test('4. hide a year from the public archive', async ({ page }) => {
	await login(page);
	await page.goto('/admin/series/gokopen');
	await page.getByRole('button', { name: 'Dölj 2026 i det publika arkivet' }).click();
	await expect(page.getByTestId('hidden-2026')).toBeVisible();
	await page.goto('/t/gokopen');
	await expect(page.getByTestId('archive-2028')).toBeVisible();
	await expect(page.getByTestId('archive-2026')).toHaveCount(0);
	await page.goto('/admin/series/gokopen');
	await page.getByRole('button', { name: 'Visa 2026 i det publika arkivet' }).click();
	await expect(page.getByTestId('hidden-2026')).toHaveCount(0);
	await page.goto('/t/gokopen');
	await expect(page.getByTestId('archive-2026')).toBeVisible();
});

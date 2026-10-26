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
	await page.getByRole('button', { name: /Logga in som Bengt/ }).click();
	await page.waitForURL(/\/admin/);
}

async function cleanup() {
	await sql`delete from competition where slug = ${NEW} or slug like 'e2e-varcup%'`;
	await sql`delete from series where slug like 'e2e-varcup%'`;
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
	// A closed (here archived) year always shows points per station.
	const first = page.locator('[data-testid="public-list"] li').first();
	await expect(async () => {
		const btn = first.getByRole('button');
		if ((await btn.count()) && (await btn.getAttribute('aria-expanded')) !== 'true') await btn.click();
		await expect(first.getByTestId('station-breakdown')).toBeVisible({ timeout: 1000 });
	}).toPass({ timeout: 15_000 });
	await expect(first.getByTestId('station-breakdown')).toContainText('Lägerplatsen');
	await shot(page, 'archive-stations');
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
	await expect(page.getByTestId('roles-note')).toHaveText(/Ägare och arrangörer följer med.*ledningscentral och start & mål gör det inte/);
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

	// Only owners may remove personal data: an organiser sees who to ask, and gets 403 on the page and the action.
	const actx = await browser.newContext({ baseURL: new URL(page.url()).origin });
	const anna = await actx.newPage();
	await anna.goto('/login');
	await anna.getByRole('button', { name: /Logga in som Anna/ }).click();
	await anna.waitForURL(/\/admin/);
	await sql`insert into competition_member (competition_id, user_id, role) select ${cid}, id, 'organiser' from app_user where member_no = '3000002' on conflict do nothing`;
	await anna.goto(`/admin/${NEW}`);
	const annaCard = anna.getByTestId('personal-data-reminder');
	await expect(annaCard.getByTestId('ask-owner')).toHaveText(/Be ägaren \(Bengt Ellison\) ta bort personuppgifterna/);
	await expect(annaCard.getByRole('link', { name: 'Ta bort personuppgifter' })).toHaveCount(0);
	await shot(anna, 'organiser-reminder');
	await anna.setViewportSize(PHONE);
	await shot(anna, 'organiser-reminder-phone');
	expect((await anna.goto(`/admin/${NEW}/anonymise`))?.status()).toBe(403);
	const denied = await anna.request.post(`/admin/${NEW}/anonymise`, { form: { confirm: 'GökOpen 2028' }, headers: { origin: new URL(page.url()).origin } });
	expect(denied.status()).toBe(403);
	const [{ n: stillThere }] = await sql`select count(*)::int n from member m join patrol p on p.id = m.patrol_id where p.competition_id = ${cid}`;
	expect(stillThere).toBeGreaterThan(0);
	await actx.close();

	await reminder.getByRole('link', { name: 'Ta bort personuppgifter' }).click();
	await page.waitForURL(`/admin/${NEW}/anonymise`);
	await expect(page.getByText('Det går inte att ångra.')).toBeVisible();
	await expect(page.getByTestId('backup-note')).toContainText('rör inte serverns schemalagda säkerhetskopior');
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

test('3b. archived edition: the next-year form shows validation errors instead of the read-only 409', async ({ page }) => {
	await login(page);
	await page.goto(`/admin/${NEW}/next-edition`);
	await page.locator('#name').fill('');
	const [res] = await Promise.all([
		page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes('/next-edition')),
		page.getByRole('button', { name: /Skapa/ }).last().click()
	]);
	expect(res.status()).not.toBe(409);
	await expect(page.locator('#name')).toHaveAttribute('aria-invalid', 'true');
	await expect(page.getByText('Tävlingen är arkiverad och kan inte ändras')).toHaveCount(0);
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

test('5. "Ny tävling": standalone, new series or a new year in an existing series', async ({ page, browser }) => {
	// The newest GökOpen year depends on whether tests 2–4 ran (2028) or not (2027).
	const [latest] = await sql`select slug, name, edition_year y from competition where series_id = (select id from series where slug = 'gokopen') order by edition_year desc limit 1`;
	const nextName = `GökOpen ${latest.y + 1}`;
	await login(page);
	await page.goto('/admin/new');
	await expect(page.getByRole('radio', { name: /Fristående tävling/ })).toBeChecked();

	// New year in an existing series → summary with inherited branding → the next-year flow.
	await page.getByRole('radio', { name: /Nytt år i en befintlig serie/ }).check();
	await page.getByRole('radio', { name: /^GökOpen/ }).check();
	const sum = page.getByTestId('series-summary');
	await expect(sum).toContainText(nextName);
	await expect(sum).toContainText(`från ${latest.name}`);
	await expect(sum.getByTestId('inherited-branding')).toContainText('Färg #00a8e1, logga och omslagsbild');
	await expect(page.locator('#grund')).toHaveCount(0);
	await shot(page, 'wizard-existing-desktop');
	await expect(sum.getByTestId('series-continue')).toHaveAttribute('href', `/admin/${latest.slug}/next-edition`);
	await sum.getByTestId('series-continue').click();
	await expect(page.getByRole('heading', { level: 1 })).toHaveText(`Skapa ${nextName}`);

	const phone = await browser.newContext({ viewport: PHONE, baseURL: new URL(page.url()).origin });
	const pp = await phone.newPage();
	await login(pp);
	await pp.goto('/admin/new');
	await pp.getByRole('radio', { name: /Nytt år i en befintlig serie/ }).check();
	await pp.getByRole('radio', { name: /^GökOpen/ }).check();
	await expect(pp.getByTestId('series-summary')).toContainText(nextName);
	expect(await pp.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
	await shot(pp, 'wizard-existing-phone');
	await pp.goto('/admin/new');
	await pp.getByRole('radio', { name: /Ny tävlingsserie/ }).check();
	await pp.getByLabel('Namn', { exact: true }).fill('E2E Vårcup 2027');
	await expect(pp.getByLabel('Seriens namn')).toHaveValue('E2E Vårcup');
	expect(await pp.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
	await shot(pp, 'wizard-new-series-phone');
	await phone.close();

	// New series: name and slug suggested, year from the date; a clash with an existing series is refused.
	await page.goto('/admin/new');
	await page.getByRole('radio', { name: /Ny tävlingsserie/ }).check();
	await page.getByLabel('Namn', { exact: true }).fill('E2E Vårcup 2027');
	await expect(page.getByLabel('Seriens namn')).toHaveValue('E2E Vårcup');
	await expect(page.locator('#series-help')).toContainText('scouttavling.se/t/e2e-varcup');
	await page.getByLabel('Datum').fill('2027-04-17');
	await expect(page.getByTestId('wizard-summary')).toContainText('upplaga 2027');
	await shot(page, 'wizard-new-series-desktop');
	await page.getByRole('button', { name: 'Ändra adress' }).first().click();
	await page.getByLabel('Seriens adress').fill('gokopen');
	await page.getByRole('button', { name: /^Skapa E2E Vårcup/ }).click();
	await expect(page.getByText('Adressen scouttavling.se/t/gokopen är upptagen')).toBeVisible();
	await page.getByLabel('Seriens adress').fill('gokopen-2027');
	await page.getByRole('button', { name: /^Skapa E2E Vårcup/ }).click();
	await expect(page.getByText('Adressen scouttavling.se/t/gokopen-2027 är upptagen')).toBeVisible();
	await page.getByLabel('Seriens adress').fill('e2e-varcup');
	await page.getByRole('button', { name: /^Skapa E2E Vårcup/ }).click();
	await page.waitForURL('/admin/e2e-varcup-2027');
	const [row] = await sql`select c.edition_year, s.slug, s.name from competition c join series s on s.id = c.series_id where c.slug = 'e2e-varcup-2027'`;
	expect(row).toEqual({ edition_year: 2027, slug: 'e2e-varcup', name: 'E2E Vårcup' });
});

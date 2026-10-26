/**
 * Owners manage owners, and the site admin (platform operator):
 * 1. an owner adds a co-owner and transfers ownership; the last owner cannot leave;
 * 2. the CLI makes Bengt site admin, who replaces the owner of a competition whose owner is gone,
 *    suspends and reopens it (the public page says so), takes temporary access (the owner sees
 *    the notice) and reads the audit log;
 * 3. a non-admin (and a logged-out visitor) gets 404 on /site-admin.
 * Runs on throwaway competitions next to the demo data and cleans up (audit rows stay: append-only).
 * Run: (in apps/web) PORT=5205 scripts/dev-server.sh start && npx playwright test -c e2e/site-admin.config.ts
 */
import { test, expect, type Page, type Browser } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { sql } from './field-db.ts';

test.describe.configure({ mode: 'serial' });

const run = promisify(execFile);
const PHONE = { width: 390, height: 844 };
const shot = (p: Page, n: string) => p.screenshot({ path: `e2e/screenshots/site-admin-${n}.png`, fullPage: true });
const OWNERS = 'e2e-agare';
const GONE = 'e2e-borta';
const GONE_NO = '7200001';
const ERIK = '3000001';
const ANNA = '3000002';

async function login(browser: Browser, who: 'Bengt' | 'Anna', viewport = { width: 1280, height: 900 }) {
	const ctx = await browser.newContext({ viewport });
	const page = await ctx.newPage();
	await page.goto('/login');
	await page.getByRole('button', { name: new RegExp(`Logga in som ${who}`) }).click();
	await page.waitForURL(/\/admin/);
	return page;
}

/** goto + wait for hydration (forms use client state). */
async function open(p: Page, path: string) {
	const r = await p.goto(path);
	await p.waitForLoadState('networkidle');
	return r;
}

const cli = (...args: string[]) => run('npm', ['run', '-s', `site-admin:${args[0]}`, '--', ...args.slice(1)], { env: { ...process.env, SITE_ADMIN_OPERATOR: 'e2e' } });

async function competition(slug: string, name: string, ownerNo: string) {
	const [owner] = await sql`select id from app_user where member_no = ${ownerNo}`;
	const [c] = await sql`
		insert into competition (slug, name, start_date, end_date, patrol_code_key, status, owner_group_name, info_text)
		values (${slug}, ${name}, '2027-09-18', '2027-09-18', 'e2e', 'live', 'Granlidens scoutkår', 'Påhittad tävling för test.') returning id`;
	await sql`insert into competition_member (competition_id, user_id, role) values (${c.id}, ${owner.id}, 'owner')`;
}

async function cleanup() {
	await sql`delete from competition where slug in (${OWNERS}, ${GONE})`;
	await sql`delete from app_user where member_no = ${GONE_NO}`;
	await sql`delete from site_admin where user_id = (select id from app_user where member_no = ${ERIK})`;
}

test.beforeAll(async ({ browser }) => {
	await cleanup();
	// Anna must have logged in once to be invited.
	await (await login(browser, 'Anna')).context().close();
	await sql`insert into app_user (member_no, name, groups) values (${GONE_NO}, 'Gustav Slutat', '[]')`;
	await competition(OWNERS, 'Ägartestet 2027', ERIK);
	await competition(GONE, 'Bortaträffen 2027', GONE_NO);
});
test.afterAll(async () => {
	await cleanup();
	await sql.end();
});

test('1. an owner adds a co-owner and transfers ownership; the last owner cannot leave', async ({ browser }) => {
	const bengt = await login(browser, 'Bengt');
	await open(bengt, `/admin/${OWNERS}/settings`);
	const sec = bengt.locator('#agare');
	await expect(sec.getByRole('heading', { name: 'Ägare och arrangörer' })).toBeVisible();
	// Bengt is the only owner and cannot leave or become organiser.
	await expect(sec.getByTestId(`member-${ERIK}`).getByRole('button', { name: 'Lämna' })).toBeDisabled();
	await expect(sec.getByTestId('only-owner')).toHaveText(/Du är enda ägaren/);

	await sec.getByLabel('Bjud in med medlemsnummer').fill(ANNA);
	await sec.getByLabel('Roll').selectOption('owner');
	await sec.getByRole('button', { name: 'Lägg till ägare' }).click();
	await expect(sec.getByRole('status')).toHaveText('Anna Berg är nu ägare.');
	await expect(sec.getByTestId(`member-${ANNA}`)).toContainText('Ägare');
	await expect(sec.getByTestId(`member-${ERIK}`).getByRole('button', { name: 'Lämna' })).toBeEnabled();

	// Make Anna organiser, then hand her the ownership (with a confirmation step).
	await sec.getByTestId(`member-${ANNA}`).getByRole('button', { name: 'Gör till arrangör' }).click();
	await expect(sec.getByTestId(`member-${ANNA}`)).toContainText('Arrangör');
	await sec.getByTestId(`member-${ANNA}`).getByRole('button', { name: 'Överlåt ägarskapet' }).click();
	await expect(sec.getByText(/Överlåt ägarskapet till Anna Berg\?/)).toBeVisible();
	await shot(bengt, 'settings-transfer-confirm');
	await sec.getByRole('button', { name: 'Ja, överlåt' }).click();
	await expect(sec.getByRole('status')).toHaveText(/Anna Berg är nu ägare, och du är arrangör/);
	await expect(sec.getByTestId(`member-${ERIK}`)).toContainText('Arrangör');
	// As organiser Bengt can no longer touch the owner.
	await expect(sec.getByTestId(`member-${ANNA}`).getByRole('button')).toHaveCount(0);
	// The owners' audit log is not shown to organisers.
	await expect(bengt.locator('#logg')).toHaveCount(0);
	await bengt.context().close();

	for (const [name, viewport] of [['desktop', { width: 1280, height: 900 }], ['phone', PHONE]] as const) {
		const anna = await login(browser, 'Anna', viewport);
		await open(anna, `/admin/${OWNERS}/settings`);
		const s = anna.locator('#agare');
		await expect(s.getByTestId(`member-${ANNA}`).getByRole('button', { name: 'Lämna' })).toBeDisabled();
		await expect(s.getByTestId('only-owner')).toHaveText(/Du är enda ägaren/);
		// The server enforces it too: a forged leave is refused.
		const forged = await anna.evaluate(async () => {
			const r = await fetch('?/memberLeave', { method: 'POST', body: new FormData(), headers: { 'x-sveltekit-action': 'true' } });
			return r.text();
		});
		expect(forged).toMatch(/minst en ägare/);
		await expect(anna.locator('#logg').getByTestId('audit-row')).toHaveCount(3);
		await expect(anna.locator('#logg')).toContainText('Överlät ägarskapet: Anna Berg');
		await s.scrollIntoViewIfNeeded();
		if (name === 'phone') expect(await anna.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
		await shot(anna, `settings-owners-${name}`);
		await anna.context().close();
	}
});

test('2. the CLI makes Bengt site admin, who replaces a gone owner, suspends, takes temporary access, reads the log', async ({ browser }) => {
	await expect(cli('grant', ERIK)).rejects.toMatchObject({ code: 2 });
	const g = await cli('grant', ERIK, '--reason', 'Driftansvarig under e2e-test');
	expect(g.stdout).toMatch(/Bengt Ellison \(3000001\) is now a site admin \(cli:e2e\)/);
	expect((await cli('list')).stdout).toContain('Bengt Ellison');

	const bengt = await login(browser, 'Bengt');
	await open(bengt, '/admin');
	await bengt.getByRole('link', { name: 'Plattformsadmin' }).click();
	await bengt.getByLabel(/Tävling, serie, adress/).fill('borta');
	await bengt.getByRole('button', { name: 'Sök' }).click();
	const hit = bengt.getByTestId(`hit-${GONE}`);
	await expect(hit).toContainText('Gustav Slutat');
	await expect(hit).toContainText('Patruller');
	await shot(bengt, 'search-desktop');
	await hit.click();
	await expect(bengt.getByRole('heading', { level: 1, name: 'Bortaträffen 2027' })).toBeVisible();
	// A site admin does not get the admin pages automatically.
	const denied = await bengt.request.get(`/admin/${GONE}`);
	expect(denied.status()).toBe(403);

	// Replace the gone owner in one step (a reason is required).
	await open(bengt, `/site-admin/c/${GONE}`);
	const row = bengt.getByTestId(`member-${GONE_NO}`);
	await expect(row.getByRole('button', { name: 'Ta bort' })).toBeDisabled();
	await row.getByRole('button', { name: 'Ersätt ägare' }).click();
	await row.getByLabel('Ny ägares medlemsnummer').fill(ANNA);
	await row.getByRole('button', { name: 'Ersätt', exact: true }).click();
	await expect(bengt.getByRole('alert').first()).toHaveText(/minst 10 tecken/);
	await bengt.locator('#mp-reason').fill('Ägaren har slutat, ärende från distriktet');
	await row.getByRole('button', { name: 'Ersätt', exact: true }).click();
	await expect(bengt.getByTestId(`member-${ANNA}`)).toContainText('Ägare');
	await expect(bengt.getByTestId(`member-${GONE_NO}`)).toHaveCount(0);

	// Suspend: the public page says so; reopen.
	await bengt.locator('#susp-reason').fill('Utreder en anmälan om missbruk');
	await bengt.getByRole('button', { name: 'Stäng av tävlingen' }).click();
	await expect(bengt.getByTestId('suspended-pill')).toBeVisible();
	const pub = await browser.newPage();
	const resp = await pub.goto(`/t/${GONE}`);
	expect(resp?.status()).toBe(423);
	await expect(pub.getByRole('heading', { level: 1 })).toHaveText('Tävlingen är tillfälligt avstängd');
	await shot(pub, 'public-suspended');
	await pub.setViewportSize(PHONE);
	await shot(pub, 'public-suspended-phone');
	await bengt.locator('#susp-reason').fill('Utrett, inget missbruk hittades');
	await bengt.getByRole('button', { name: 'Öppna tävlingen igen' }).click();
	await expect(bengt.getByTestId('suspended-pill')).toHaveCount(0);
	expect((await pub.goto(`/t/${GONE}`))?.status()).toBe(200);
	await pub.close();

	// Temporary access, organiser level, 2 h.
	await bengt.locator('#acc-reason').fill('Ägaren bad om hjälp med kontrollerna');
	await bengt.getByRole('button', { name: 'Ta tillfällig åtkomst' }).click();
	await expect(bengt.getByTestId('access-section')).toContainText('Du har åtkomst till');
	await shot(bengt, 'competition-desktop');
	await bengt.setViewportSize(PHONE);
	await shot(bengt, 'competition-phone');
	await bengt.setViewportSize({ width: 1280, height: 900 });
	await bengt.getByRole('link', { name: 'Öppna tävlingen' }).click();
	await expect(bengt.getByTestId('access-banner')).toContainText('Ägaren bad om hjälp med kontrollerna');

	// The (new) owner sees who had access and why.
	for (const [name, viewport] of [['desktop', { width: 1280, height: 900 }], ['phone', PHONE]] as const) {
		const anna = await login(browser, 'Anna', viewport);
		await open(anna, `/admin/${GONE}`);
		await expect(anna.getByTestId('access-notice')).toContainText('Plattformsadmin Bengt Ellison har åtkomst till tävlingen');
		await expect(anna.getByTestId('access-notice')).toContainText('Ägaren bad om hjälp med kontrollerna');
		await shot(anna, `access-notice-${name}`);
		await anna.context().close();
	}

	// The audit log, filtered on the competition.
	await open(bengt, `/site-admin/audit?slug=${GONE}`);
	const rows = bengt.getByTestId('audit-row');
	await expect(rows).toHaveCount(4);
	await expect(rows.nth(0)).toContainText('Tog tillfällig åtkomst');
	await expect(rows.nth(1)).toContainText('Öppnade tävlingen igen');
	await expect(rows.nth(2)).toContainText('Stängde av tävlingen');
	await expect(rows.nth(3)).toContainText('Ersatte ägaren: Gustav Slutat → Anna Berg');
	await expect(rows.nth(3)).toContainText('Anledning: Ägaren har slutat, ärende från distriktet');
	await shot(bengt, 'audit-desktop');
	await bengt.setViewportSize(PHONE);
	expect(await bengt.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
	await shot(bengt, 'audit-phone');
	await open(bengt, '/site-admin?q=borta');
	await shot(bengt, 'search-phone');
	await bengt.context().close();
});

test('3. a non-admin and a logged-out visitor get 404 on /site-admin', async ({ browser }) => {
	const anna = await login(browser, 'Anna');
	await expect(anna.getByRole('link', { name: 'Plattformsadmin' })).toHaveCount(0);
	for (const path of ['/site-admin', '/site-admin/audit', `/site-admin/c/${GONE}`]) {
		expect((await open(anna, path))?.status()).toBe(404);
	}
	await expect(anna.getByRole('heading', { level: 1 })).toHaveText('Sidan finns inte');
	const forged = await anna.request.post(`/site-admin/c/${GONE}?/suspend`, { form: { suspend: '1', reason: 'Försöker utan behörighet' }, headers: { origin: 'http://localhost:5205' } });
	expect(forged.status()).toBe(404);
	const [c] = await sql`select suspended_at from competition where slug = ${GONE}`;
	expect(c.suspended_at).toBeNull();
	await anna.context().close();
	const anon = await browser.newPage();
	expect((await anon.goto('/site-admin'))?.status()).toBe(404);
	await anon.close();
	// Revoking removes the area for Bengt too.
	await cli('revoke', ERIK, '--reason', 'Slut på e2e-testet');
	const bengt = await login(browser, 'Bengt');
	expect((await open(bengt, '/site-admin'))?.status()).toBe(404);
	await bengt.context().close();
});

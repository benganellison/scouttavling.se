import { expect, test, type Page } from '@playwright/test';
import { login } from './support.ts';
import { readFileSync } from 'node:fs';
import postgres from 'postgres';

/*
 * Privacy: notice linked where data is collected, owner export (audited), site-admin follow-up list.
 * Run: (in apps/web) PORT=5204 scripts/dev-server.sh start && npm run db:seed && npx playwright test -c e2e/privacy.config.ts
 */
const shot = (page: Page, name: string) => page.screenshot({ path: `e2e/screenshots/privacy-${name}.png`, fullPage: true });

function databaseUrl() {
	if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
	const env = readFileSync(new URL('../.env', import.meta.url), 'utf8');
	return /^DATABASE_URL=(.*)$/m
		.exec(env)![1]
		.trim()
		.replace(/^["']|["']$/g, '');
}
test.describe.configure({ mode: 'serial' });

test('1. the privacy notice is linked at registration and names the kår', async ({ page }) => {
	await page.goto('/t/gokopen-2027/anmal');
	const link = page.getByRole('link', { name: 'Så hanterar vi personuppgifter' });
	await expect(link).toHaveAttribute('href', '/personuppgifter?t=gokopen-2027');
	await link.click();
	await expect(page.getByTestId('privacy')).toContainText('Personuppgiftsansvarig är Granlidens scoutkår');
	await expect(page.getByTestId('privacy')).toContainText('aldrig personnummer');
	await shot(page, 'notice');
	await page.goto('/login');
	await expect(page.getByRole('link', { name: 'Så hanterar vi personuppgifter' })).toHaveAttribute('href', '/personuppgifter');
});

test("2. an owner exports the edition's personal data; it is audited; others are refused", async ({ page, browser }) => {
	const sql = postgres(databaseUrl(), { max: 1 });
	try {
		await login(page, 'Bengt');
		const res = await page.request.get('/admin/gokopen-2027/personuppgifter.json');
		expect(res.status()).toBe(200);
		expect(res.headers()['content-disposition']).toContain('personuppgifter-gokopen-2027.json');
		const data = await res.json();
		const p104 = data.patrols.find((p: { number: number }) => p.number === 104);
		expect(p104.contact.phone).toBeTruthy();
		expect(p104.members.length).toBeGreaterThan(0);
		const [a] =
			await sql`select count(*)::int n from audit_log where action = 'competition.export_personal_data' and competition_id = (select id from competition where slug = 'gokopen-2027')`;
		expect(a.n).toBeGreaterThan(0);
		// Anna is not a member of GökOpen 2027.
		const other = await browser.newContext();
		const op = await other.newPage();
		await login(op, 'Anna');
		expect((await op.request.get('/admin/gokopen-2027/personuppgifter.json')).status()).toBe(403);
		await other.close();
	} finally {
		await sql.end();
	}
});

test('3. site admins see editions that ended long ago and still hold personal data', async ({ page }) => {
	const sql = postgres(databaseUrl(), { max: 1 });
	const slug = `gammal-tavling-${Date.now() % 1e6}`;
	try {
		const [u] = await sql`select id from app_user where member_no = '3000001'`;
		await sql`insert into site_admin (user_id, granted_by, reason) values (${u.id}, 'e2e', 'Test av uppföljningslistan') on conflict do nothing`;
		const [c] = await sql`insert into competition (slug, name, start_date, end_date, status, patrol_code_key, owner_group_name)
			values (${slug}, 'Gammal tävling 2020', '2020-05-01', '2020-05-01', 'closed', 'k', 'Påhittsby scoutkår') returning id`;
		await sql`insert into competition_member (competition_id, user_id, role) values (${c.id}, ${u.id}, 'owner')`;
		await sql`insert into patrol (competition_id, number, name, troop, contact_phone) values (${c.id}, 101, 'Påhittarna', 'Påhittsby scoutkår', '070-000 00 00')`;
		await login(page, 'Bengt');
		await page.goto('/site-admin');
		const row = page.getByTestId(`overdue-${slug}`);
		await expect(row).toContainText('Gammal tävling 2020');
		await expect(row).toContainText('1 patrull med personuppgifter');
		await shot(page, 'site-admin-overdue');
		// After removal it disappears.
		await sql`update patrol set contact_phone = null where competition_id = ${c.id}`;
		await page.reload();
		await expect(page.getByTestId(`overdue-${slug}`)).toHaveCount(0);
	} finally {
		await sql`delete from competition where slug = ${slug}`;
		await sql`delete from site_admin where granted_by = 'e2e'`;
		await sql.end();
	}
});

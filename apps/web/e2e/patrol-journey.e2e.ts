/**
 * Patrol journey e2e: public page → 3-step registration → confirmation links →
 * patrol pass with QR → follow page (off → on → live update) → closed/full states.
 * Also covers three UAT fixes: closed overview summary, conflict reporter names,
 * and the phone's "Nekad" pill + closed banner.
 *
 * Run (in apps/web), on its own database and port:
 *   export DATABASE_URL=postgres://scout:scout@127.0.0.1:5544/scouttavling_features
 *   npm run db:reset && PORT=5205 scripts/dev-server.sh start
 *   npx playwright test -c e2e/patrol-journey.config.ts
 */
import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { SLUG, clearScores, compId, createInvite, patrolId, sql, stationItems } from './field-db.ts';

test.describe.configure({ mode: 'serial' });

const shot = (page: Page, name: string) => page.screenshot({ path: `e2e/screenshots/patrol-${name}.png`, fullPage: true });
const path = (href: string) => new URL(href).pathname;
const PATROL = `Lodjuren ${Date.now() % 10000}`;

let manageUrl = '';
let followUrl = '';
let admin: BrowserContext;
let adminPage: Page;

async function resetComp() {
	await sql`update competition set status = 'live', registration_open = true, registration_opens_on = '2026-09-01', registration_closes_on = '2027-05-01',
		max_patrols = 40, follow_enabled = false, follow_show_scores = true where slug = ${SLUG}`;
}

test.beforeAll(async ({ browser }: { browser: Browser }) => {
	await resetComp();
	await sql`delete from patrol where competition_id = ${await compId()} and name like 'Lodjuren %'`;
	admin = await browser.newContext({ viewport: { width: 1280, height: 900 } });
	adminPage = await admin.newPage();
	await adminPage.goto('/login');
	await adminPage.getByRole('button', { name: /Logga in som Erik/ }).click();
	await adminPage.waitForURL(/\/admin/);
});

test.afterAll(async () => {
	await resetComp();
	await sql`update competition set follow_enabled = true where slug = ${SLUG}`;
	await admin?.close();
	await sql.end();
});

test('1: public competition page', async ({ page }) => {
	await page.goto(`/t/${SLUG}`);
	await expect(page.getByRole('heading', { name: 'GökOpen 2027' })).toBeVisible();
	await expect(page.getByText('Granlidens scoutkår bjuder in till')).toBeVisible();
	await expect(page.getByText('Gökskogens lägerplats')).toBeVisible();
	await expect(page.getByRole('link', { name: 'Anmäl en patrull' })).toBeVisible();
	await expect(page.getByTestId('spots')).toContainText('platser kvar av 40');
	await expect(page.getByRole('heading', { name: 'Klasser' })).toBeVisible();
	await expect(page.getByText('Spårare')).toBeVisible();
	await expect(page.getByText(/Välkomna till GökOpen/)).toBeVisible();
	await expect(page.getByRole('link', { name: /Liveresultat/ })).toHaveAttribute('href', `/r/${SLUG}`);
	// No personal data on the public page.
	await expect(page.locator('body')).not.toContainText('@');
	await shot(page, 'public');
});

test('2–3: register through all 3 steps; confirmation shows both links', async ({ page }) => {
	await page.goto(`/t/${SLUG}`);
	await page.getByRole('link', { name: 'Anmäl en patrull' }).click();
	await expect(page.getByText('Steg 1 av 3')).toBeVisible();
	await page.getByRole('button', { name: 'Nästa' }).click();
	await expect(page.getByText('Skriv patrullens namn (minst 2 tecken)')).toBeVisible();
	await expect(page.getByText('Välj en klass')).toBeVisible();
	await page.getByLabel('Patrullens namn').fill(PATROL);
	await page.getByLabel('Kår').fill('Ekbackens scoutkår');
	await page.getByRole('radio', { name: /^Upptäckare/ }).check();
	await shot(page, 'step1');
	await page.getByRole('button', { name: 'Nästa' }).click();

	await expect(page.getByText('Steg 2 av 3')).toBeVisible();
	await expect(page.getByText(/personnummer/)).toBeVisible();
	await page.getByLabel('Förnamn scout 1').fill('Alva');
	await page.getByLabel('Efternamn scout 1').fill('Ek');
	await page.getByLabel('Förnamn scout 2').fill('Noah');
	await page.getByRole('button', { name: 'Nästa' }).click();
	await expect(page.getByText('Skriv efternamn')).toBeVisible();
	await page.getByLabel('Efternamn scout 2').fill('Lind');
	await page.getByRole('button', { name: 'Lägg till scout' }).click();
	await page.getByLabel('Förnamn scout 4').fill('Selma');
	await page.getByLabel('Efternamn scout 4').fill('Berg');
	await page.getByRole('button', { name: 'Ta bort scout 3' }).click();
	await expect(page.getByLabel('Förnamn scout 3')).toHaveValue('Selma');
	await shot(page, 'step2');
	await page.getByRole('button', { name: 'Nästa' }).click();

	await expect(page.getByText('Steg 3 av 3')).toBeVisible();
	await page.getByLabel('Namn', { exact: true }).fill('Maria Ek');
	await page.getByLabel('Mobilnummer').fill('070-123 45 67');
	await page.getByLabel('E-post').fill('maria@example.org');
	await shot(page, 'step3');
	await page.getByRole('button', { name: 'Skicka anmälan' }).click();

	const conf = page.getByTestId('confirmation');
	await expect(conf).toContainText(`${PATROL} är anmäld!`);
	await expect(page.getByRole('heading', { name: 'Spara länken' })).toBeVisible();
	manageUrl = (await page.getByTestId('manage-link').getAttribute('href'))!;
	followUrl = (await page.getByTestId('follow-link').getAttribute('href'))!;
	expect(path(manageUrl)).toMatch(/^\/m\/[A-Za-z0-9_-]{22}$/);
	expect(path(followUrl)).toMatch(/^\/folj\/[A-Za-z0-9_-]{22}$/);
	await expect(page.getByText('Startavgiften är 150 kr')).toBeVisible();
	await shot(page, 'confirmation');

	const [p] = await sql`select number, status, manage_token_hash, follow_token_hash, follow_token_enc from patrol where name = ${PATROL}`;
	expect(p.status).toBe('registered');
	expect(p.number).toBeGreaterThan(114);
	expect(p.manage_token_hash).not.toContain(path(manageUrl).slice(3));
	const members = await sql`select first_name from member where patrol_id = (select id from patrol where name = ${PATROL}) order by first_name`;
	expect(members.map((m) => m.first_name)).toEqual(['Alva', 'Noah', 'Selma']);
});

test('4: patrol pass shows the QR and lets the contact edit', async ({ page }) => {
	await page.goto(path(manageUrl));
	await expect(page.getByRole('heading', { name: PATROL })).toBeVisible();
	await expect(page.getByTestId('patrol-qr').locator('svg')).toBeVisible();
	await expect(page.getByText('Upptäckare')).toBeVisible();
	await expect(page.getByText('Spara den här sidan')).toBeVisible();
	// Follow is off: no follow link on the pass.
	await expect(page.getByTestId('follow-link')).toHaveCount(0);
	await page.waitForLoadState('networkidle'); // hydrated
	await page.getByRole('button', { name: 'Lägg till scout' }).click();
	await page.getByLabel('Förnamn scout 4').fill('Ture');
	await page.getByLabel('Efternamn scout 4').fill('Lind');
	await page.getByLabel('Mobilnummer').fill('073-555 66 77');
	await page.getByRole('button', { name: 'Spara ändringar' }).click();
	await expect(page.getByRole('status').filter({ hasText: 'Sparat' })).toBeVisible();
	const [p] = await sql`select contact_phone, (select count(*)::int from member m where m.patrol_id = patrol.id) as n from patrol where name = ${PATROL}`;
	expect(p).toMatchObject({ contact_phone: '073-555 66 77', n: 4 });
	await shot(page, 'pass');
});

test('5: follow page off → admin turns it on → live update on a new score', async ({ page }) => {
	await page.goto(path(followUrl));
	await expect(page.getByTestId('follow-off')).toContainText('Följ patrullen är avstängt för den här tävlingen');
	await expect(page.locator('body')).not.toContainText(PATROL);
	await shot(page, 'follow-off');

	await adminPage.goto(`/admin/${SLUG}/settings`);
	await adminPage.getByRole('switch', { name: /^Följ patrullen/ }).check();
	await adminPage.getByRole('button', { name: 'Spara anmälan' }).click();
	await expect(adminPage.locator('#anmalan').getByRole('status')).toContainText('Sparat');
	await adminPage.locator('#anmalan').screenshot({ path: 'e2e/screenshots/patrol-settings.png' });

	await page.reload();
	await expect(page.getByRole('heading', { name: PATROL })).toBeVisible();
	await expect(page.getByTestId('done-count')).toHaveText('0');
	await expect(page.getByTestId('follow-stations').locator('li')).not.toHaveCount(0);

	const cid = await compId();
	const [p] = await sql`select id from patrol where name = ${PATROL}`;
	const [item] = await stationItems('Lägerplatsen');
	await sql`insert into score (competition_id, patrol_id, item_id, points, style_points, raw, origin) values (${cid}, ${p.id}, ${item.id}, 14, 3, ${sql.json({ value: 14, style: 3 })}, 'admin')`;
	await sql`insert into change_log (competition_id, kind, entity_id) values (${cid}, 'score', ${p.id})`;
	await expect(page.getByTestId('done-count')).toHaveText('1', { timeout: 25_000 });
	await expect(page.getByTestId('placement')).toContainText('17');
	await expect(page.getByTestId('follow-stations').locator('li.done')).toContainText('Lägerplatsen');
	await shot(page, 'follow-on');

	// Manage page now links to the follow page.
	await page.goto(path(manageUrl));
	await expect(page.getByTestId('follow-link')).toBeVisible();
});

test('6: not yet open, full and closed registration', async ({ page }) => {
	await sql`update competition set registration_opens_on = '2099-02-01', registration_closes_on = '2099-05-01' where slug = ${SLUG}`;
	await page.goto(`/t/${SLUG}`);
	await expect(page.getByTestId('reg-status')).toHaveText('Anmälan öppnar 1 feb 2099');
	await expect(page.getByRole('link', { name: 'Anmäl en patrull' })).toHaveCount(0);
	await shot(page, 'not-yet');

	const [{ n }] = await sql`select count(*)::int as n from patrol where competition_id = ${await compId()} and status <> 'resigned'`;
	await sql`update competition set registration_opens_on = '2026-09-01', registration_closes_on = '2099-05-01', max_patrols = ${n} where slug = ${SLUG}`;
	await page.goto(`/t/${SLUG}`);
	await expect(page.getByTestId('reg-status')).toHaveText('Tävlingen är fullbokad');
	await page.goto(`/t/${SLUG}/anmal`);
	await expect(page.getByTestId('reg-closed')).toContainText('Tävlingen är fullbokad');
	await shot(page, 'full');
	// Full still allows the contact to edit.
	await page.goto(path(manageUrl));
	await expect(page.getByRole('button', { name: 'Spara ändringar' })).toBeVisible();

	await sql`update competition set registration_open = false where slug = ${SLUG}`;
	await page.goto(`/t/${SLUG}`);
	await expect(page.getByTestId('reg-status')).toHaveText('Anmälan är stängd');
	await page.goto(path(manageUrl));
	await expect(page.getByTestId('edit-closed')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Spara ändringar' })).toHaveCount(0);

	// A direct POST is refused server-side too.
	const res = await page.request.post(`/t/${SLUG}/anmal`, {
		form: { patrolName: 'Lodjuren hack', troop: 'X kår', trackId: '00000000-0000-4000-8000-000000000000', firstName: 'A', lastName: 'B', contactName: 'AB', contactPhone: '0701234567', contactEmail: 'a@b.se' },
		headers: { origin: new URL(page.url()).origin, accept: 'application/json', 'x-sveltekit-action': 'true' }
	});
	expect(JSON.stringify(await res.json())).not.toContain('"done"');
	await resetComp();
});

test('fix: overview shows a closed summary instead of the checklist', async () => {
	await sql`update competition set status = 'closed' where slug = ${SLUG}`;
	await adminPage.goto(`/admin/${SLUG}`);
	await expect(adminPage.getByTestId('closed-summary')).toBeVisible();
	await expect(adminPage.getByText('Att göra innan tävlingsdagen')).toHaveCount(0);
	await expect(adminPage.getByText('Utan funktionär')).toHaveCount(0);
	await expect(adminPage.getByTestId('closed-summary').getByRole('link', { name: 'Prisutdelning' })).toHaveAttribute('href', `/r/${SLUG}/ceremony`);
	await adminPage.screenshot({ path: 'e2e/screenshots/patrol-overview-closed.png' });
	await sql`update competition set status = 'live' where slug = ${SLUG}`;
	await adminPage.goto(`/admin/${SLUG}`);
	await expect(adminPage.getByRole('link', { name: 'Visa sidan' })).toHaveAttribute('href', `/t/${SLUG}`);
});

test('fix: conflicts name the reporter; phone shows "Nekad" and a closed banner', async ({ browser }) => {
	await clearScores([128, 133], 'Första hjälpen');
	const secret = await createInvite('Första hjälpen');
	const phone = await browser.newContext({ viewport: { width: 390, height: 844 } });
	const p = await phone.newPage();
	await p.goto(`/j/${secret}`);
	await p.getByLabel('Vad heter du?').fill('Anna Rapport');
	await p.getByRole('button', { name: 'Öppna min kontroll' }).click();
	await expect(p.getByTestId('sync-pill')).toContainText('Synkad');

	const score = async (nr: number) => {
		await p.getByRole('link', { name: /Skanna patrull/ }).click();
		await p.getByRole('tab', { name: 'Nummer' }).click();
		for (const d of String(nr)) await p.getByRole('button', { name: d, exact: true }).click();
		await p.getByRole('button', { name: new RegExp(`^${nr}`) }).click();
		await p.getByRole('button', { name: /Ja, sätt poäng|Ändra poäng/ }).click();
		await p.getByRole('button', { name: '12', exact: true }).click();
		await p.getByRole('button', { name: 'Stil 2' }).click();
		await p.getByRole('button', { name: 'Spara 12 + 2 = 14 p' }).click();
		await expect(p.getByText('Sparat!')).toBeVisible();
	};
	await score(128);
	await expect.poll(async () => (await sql`select count(*)::int as n from score where patrol_id = ${await patrolId(128)} and origin = 'device'`)[0].n, { timeout: 20_000 }).toBeGreaterThan(0);

	// A conflict on that score: the existing side must show the device name, the new side the organiser.
	const [s] = await sql`select s.id, s.item_id, s.version, s.points from score s where s.patrol_id = ${await patrolId(128)} and s.origin = 'device'`;
	const [erik] = await sql`select id from app_user where member_no = '3000001'`;
	await sql`insert into score_conflict (competition_id, patrol_id, item_id, existing, incoming) values (${await compId()}, ${await patrolId(128)}, ${s.item_id},
		${sql.json({ points: s.points, stylePoints: 2, version: s.version, state: 'active', origin: 'device' })},
		${sql.json({ points: 9, stylePoints: 1, origin: 'admin', userId: erik.id, raw: { value: 9, style: 1 } })})`;
	await adminPage.goto(`/admin/${SLUG}/conflicts`);
	const card = adminPage.getByTestId('conflict').filter({ hasText: '128' });
	await expect(card.locator('.side').first()).toContainText('Anna Rapport');
	await expect(card.locator('.side.new')).toContainText('Erik Rydberg');
	await card.screenshot({ path: 'e2e/screenshots/patrol-conflict.png' });
	await card.getByRole('button', { name: 'Behåll' }).click();

	// Close the competition: the next report is rejected → "Nekad", plus a banner.
	await sql`update competition set status = 'closed' where slug = ${SLUG}`;
	await p.goto(`/f/${SLUG}`);
	await score(133);
	await p.goto(`/f/${SLUG}`);
	await expect(p.getByTestId('sync-pill')).toHaveText(/Nekad/, { timeout: 20_000 });
	await expect(p.getByTestId('sync-pill')).not.toContainText('Konflikt');
	await expect(p.getByTestId('closed-banner')).toHaveText('Tävlingen är avslutad — rapporter tas inte emot');
	await shot(p, 'phone-closed');
	await p.goto(`/f/${SLUG}/log`);
	await expect(p.getByText(/Nekad:.*Tävlingen är avslutad/)).toBeVisible();
	await shot(p, 'phone-log');
	await sql`update competition set status = 'live' where slug = ${SLUG}`;
	await phone.close();
});

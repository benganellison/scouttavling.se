import { expect, test, type Page } from '@playwright/test';
import { login } from './support.ts';
import { readFileSync } from 'node:fs';
import postgres from 'postgres';

/*
 * Live / HQ / results flow. Run:
 *   cd apps/web && PORT=5204 scripts/dev-server.sh start
 *   npx playwright test -c e2e/live.config.ts
 * Needs fresh seed data (npm run db:seed).
 */
const SLUG = 'gokopen-2027';
const shot = (page: Page, name: string) => page.screenshot({ path: `e2e/screenshots/live-${name}.png`, fullPage: true });

function databaseUrl() {
	if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
	const env = readFileSync(new URL('../.env', import.meta.url), 'utf8');
	return /^DATABASE_URL=(.*)$/m
		.exec(env)![1]
		.trim()
		.replace(/^["']|["']$/g, '');
}

test.describe.configure({ mode: 'serial' });

test('live dashboard, patrol edit, results, public page and ceremony', async ({ page }) => {
	const sql = postgres(databaseUrl(), { max: 1 });
	try {
		await login(page);

		// 2. Dashboard
		await page.goto(`/admin/${SLUG}/live`);
		await expect(page.getByRole('heading', { name: 'Ledningscentralen' })).toBeVisible();
		await expect(page.getByTestId('live-status')).toHaveAttribute('data-status', 'open', { timeout: 15_000 });

		// 3. A score written behind the page's back (SQL + change_log + NOTIFY) shows up without reload.
		const [comp] = await sql`select id from competition where slug = ${SLUG}`;
		const [p104] = await sql`select id from patrol where competition_id = ${comp.id} and number = 104`;
		const [item] = await sql`
			select i.id from score_item i join station s on s.id = i.station_id
			where s.competition_id = ${comp.id} and s.name = 'Kojbygge'`;
		await sql`delete from score where patrol_id = ${p104.id} and item_id = ${item.id}`;
		await sql.begin(async (tx) => {
			const [sc] = await tx`
				insert into score (competition_id, patrol_id, item_id, points, style_points, raw, origin)
				values (${comp.id}, ${p104.id}, ${item.id}, 17, 4, ${tx.json({ value: 17, style: 4 })}, 'paper') returning id`;
			await tx`insert into score_revision (score_id, version, points, style_points, state, origin) values (${sc.id}, 1, 17, 4, 'active', 'paper')`;
			const [ch] = await tx`insert into change_log (competition_id, kind, entity_id) values (${comp.id}, 'score', ${sc.id}) returning seq`;
			await tx`select pg_notify('changes', ${JSON.stringify({ c: comp.id, k: 'score', s: Number(ch.seq) })})`;
		});
		const navs: string[] = [];
		page.on('framenavigated', (f) => f === page.mainFrame() && navs.push(f.url()));
		const feedRow = page.getByTestId('feed').locator('li').first();
		await expect(feedRow).toContainText('104 Älgarna', { timeout: 10_000 });
		await expect(feedRow).toContainText('17 + 4');
		expect(navs).toHaveLength(0);
		await shot(page, 'dashboard');

		// 4. Edit a score on the patrol detail page → audit entry.
		await page.goto(`/admin/${SLUG}/patrol/112`);
		await expect(page.getByRole('heading', { name: 'Lodjuren' })).toBeVisible();
		// Retry until hydrated: the cell toggles a client-side panel.
		await expect(async () => {
			if (!(await page.locator('form.item').count())) await page.locator('button.cell[data-code="K1"]').click();
			await expect(page.locator('form.item').first()).toBeVisible({ timeout: 1000 });
		}).toPass({ timeout: 15_000 });
		const form = page.locator('form.item').first();
		await form
			.locator('label.chip', { hasText: /^\s*16\s*$/ })
			.first()
			.click();
		await form
			.locator('fieldset', { hasText: 'Stil' })
			.locator('label.chip', { hasText: /^\s*3\s*$/ })
			.click();
		await form.getByLabel('Anledning').fill('fel patrull vald');
		await form.getByRole('button', { name: 'Spara ändring' }).click();
		await expect(form.getByRole('status')).toContainText('sparad');
		await expect(page.getByTestId('timeline')).toContainText('K1 ändrad av Bengt · var 18 + 4 → 16 + 3');
		await expect(page.getByTestId('timeline')).toContainText("'fel patrull vald'");
		await shot(page, 'patrol');

		// Put it back so 112/137 tie again.
		await page
			.locator('form.item')
			.first()
			.locator('label.chip', { hasText: /^\s*18\s*$/ })
			.first()
			.click();
		await page
			.locator('form.item')
			.first()
			.locator('fieldset', { hasText: 'Stil' })
			.locator('label.chip', { hasText: /^\s*4\s*$/ })
			.click();
		await page.locator('form.item').first().getByRole('button', { name: 'Spara ändring' }).click();
		await expect(page.getByTestId('timeline')).toContainText('var 16 + 3 → 18 + 4');

		// 5. Results: 112 and 137 share a place.
		const [upp] = await sql`select id from track where competition_id = ${comp.id} and name = 'Upptäckare'`;
		await page.goto(`/admin/${SLUG}/results?class=${upp.id}`);
		const r112 = page.locator('[data-testid="result-row"][data-number="112"]');
		const r137 = page.locator('[data-testid="result-row"][data-number="137"]');
		await expect(r112).toBeVisible();
		const place112 = await r112.getAttribute('data-place');
		expect(place112).toBe(await r137.getAttribute('data-place'));
		await expect(r112).toContainText('Delad plats med 137');
		// Organisers always see points per station.
		// Retry until hydrated; only click while still closed so a retry never closes it again.
		const more112 = r112.getByRole('button', { name: /Poäng per kontroll för 112/ });
		await expect(async () => {
			if ((await more112.getAttribute('aria-expanded')) !== 'true') await more112.click();
			await expect(page.getByTestId('station-breakdown')).toBeVisible({ timeout: 1000 });
		}).toPass({ timeout: 15_000 });
		await expect(page.getByTestId('station-breakdown')).toContainText('Lägerplatsen');
		await expect(page.getByTestId('station-breakdown')).toContainText('18/20');
		await shot(page, 'results');
		// CSV export: one column per station (points incl. style, plus a style column).
		const csv = await (await page.request.get(`/admin/${SLUG}/results.csv`)).text();
		const [head, ...lines] = csv.replace(/^\uFEFF/, '').split('\r\n');
		const cols = head.split(';');
		expect(cols).toContain('Lägerplatsen');
		expect(cols).toContain('Lägerplatsen stil');
		const line112 = lines.find((l) => l.split(';')[2] === '112')!.split(';');
		expect(line112[cols.indexOf('Lägerplatsen')]).toBe('22');
		expect(line112[cols.indexOf('Lägerplatsen stil')]).toBe('4');
		expect(line112[cols.indexOf('Repstegen')]).toBe('–');

		// 6. Public page at phone width.
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto(`/r/${SLUG}`);
		await expect(page.getByText('Preliminärt · live')).toBeVisible();
		const pub112 = page.locator('[data-testid="public-list"] li[data-number="112"]');
		await expect(async () => {
			await page.getByRole('button', { name: 'Upptäckare' }).click();
			await expect(pub112).toHaveAttribute('data-place', place112!, { timeout: 1000 });
		}).toPass({ timeout: 15_000 });
		await expect(page.getByText(/Vid lika totalpoäng vinner flest poäng utan stil/)).toBeVisible();
		const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
		expect(overflow).toBe(false);
		// During the competition points per station are hidden by default: rows are not buttons.
		await expect(pub112.getByRole('button')).toHaveCount(0);
		await shot(page, 'public');

		// 6b. Turned on in Inställningar → tap a patrol for its points per station.
		await page.setViewportSize({ width: 1440, height: 900 });
		await page.goto(`/admin/${SLUG}/settings`);
		const sw = page.getByRole('switch', { name: 'Visa poäng per kontroll under tävlingen' });
		await expect(sw).not.toBeChecked();
		await sw.check();
		await page.getByRole('button', { name: 'Spara grundinfo' }).click();
		await expect(page.getByRole('status').filter({ hasText: 'Sparat' }).first()).toBeVisible();
		try {
			await page.setViewportSize({ width: 390, height: 844 });
			// /r is cacheable for 5 s (max-age=5); a new URL skips the copy from step 6.
			await page.goto(`/r/${SLUG}?efter-installning`);
			await expect(async () => {
				await page.getByRole('button', { name: 'Upptäckare' }).click();
				// getAttribute would wait for the row; count() does not, so a retry clicks the tab again.
				const btn = pub112.getByRole('button');
				if ((await btn.count()) && (await btn.getAttribute('aria-expanded')) !== 'true') await btn.click();
				await expect(pub112.getByTestId('station-breakdown')).toBeVisible({ timeout: 1000 });
			}).toPass({ timeout: 15_000 });
			await expect(pub112.getByRole('button')).toHaveAttribute('aria-expanded', 'true');
			await expect(pub112.getByTestId('station-breakdown')).toContainText('18/20');
			expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
			await shot(page, 'public-stations');
		} finally {
			await sql`update competition set station_results_live = false where id = ${comp.id}`;
		}

		// 7. Ceremony.
		await page.setViewportSize({ width: 1600, height: 900 });
		await page.goto(`/r/${SLUG}/ceremony?class=${upp.id}&fresh=1`);
		await expect(page.getByTestId('reveal-card')).toContainText('Strax dags');
		await expect(page.getByTestId('place-item').first()).toContainText('? ? ?');
		await shot(page, 'ceremony-start');
		await page.getByRole('button', { name: 'Avslöja nästa' }).click();
		await expect(page.getByTestId('reveal-name')).toBeVisible();
		await page.keyboard.press('ArrowRight');
		await page.keyboard.press('ArrowLeft');
		await page.keyboard.press('ArrowRight');
		const count = await page.getByTestId('place-item').count();
		for (let i = 2; i < count - 1; i++) await page.keyboard.press('Space');
		await shot(page, 'ceremony-mid');
		await page.getByRole('button', { name: 'Avslöja vinnaren' }).click();
		await expect(page.getByTestId('reveal-card')).toContainText('Första plats');
		await expect(page.getByTestId('reveal-name')).toHaveText('Ugglorna');
		await expect(page.getByTestId('place-item').first()).not.toContainText('? ? ?');
		await shot(page, 'ceremony-winner');
	} finally {
		await sql.end();
	}
});

test('conflicts resolve and messages send', async ({ page }) => {
	const sql = postgres(databaseUrl(), { max: 1 });
	try {
		const [comp] = await sql`select id from competition where slug = ${SLUG}`;
		const [p] = await sql`select id from patrol where competition_id = ${comp.id} and number = 137`;
		const [item] = await sql`
			select i.id from score_item i join station s on s.id = i.station_id
			where s.competition_id = ${comp.id} and s.name = 'Naturkunskap'`;
		await sql`delete from score_conflict where patrol_id = ${p.id}`;
		await sql`insert into score_conflict (competition_id, patrol_id, item_id, existing, incoming) values (
			${comp.id}, ${p.id}, ${item.id},
			${sql.json({ points: 15, stylePoints: 3, version: 1, state: 'active', origin: 'admin' })},
			${sql.json({ points: 12, stylePoints: 2, raw: { value: 12, style: 2 }, origin: 'device', deviceId: null, baseVersion: null })})`;

		await login(page);
		await page.goto(`/admin/${SLUG}/conflicts`);
		await expect(page.getByRole('heading', { name: 'Konflikter', exact: true })).toBeVisible();
		const card = page.getByTestId('conflict').first();
		await expect(card).toContainText('137 Hackspettarna');
		await expect(card).toContainText('15 + 3');
		await expect(card).toContainText('12 + 2');
		await shot(page, 'conflicts');
		await card.getByRole('button', { name: 'Använd ny' }).click();
		await expect(page.getByText('Den nya poängen används.')).toBeVisible();
		await expect(page.getByTestId('conflict')).toHaveCount(0);
		await page.goto(`/admin/${SLUG}/patrol/137`);
		await expect(page.getByTestId('timeline')).toContainText('K2 ändrad av Bengt · var 15 + 3 → 12 + 2');

		await page.goto(`/admin/${SLUG}/messages`);
		await expect(async () => {
			await page.getByRole('button', { name: 'Lunch' }).click();
			await expect(page.getByLabel('Rubrik')).toHaveValue('Lunch', { timeout: 1000 });
		}).toPass({ timeout: 15_000 });
		await page.getByRole('button', { name: 'Skicka meddelande' }).click();
		await expect(page.getByTestId('sent-message').first()).toContainText('Lunch');
		await shot(page, 'messages');
	} finally {
		await sql.end();
	}
});

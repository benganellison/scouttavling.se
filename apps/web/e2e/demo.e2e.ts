/**
 * DEMO recordings for the README: the same journeys as the UAT, but at human
 * pace, with Swedish captions and a visible tap marker. Not a test suite
 * (assertions only guard that the demo shows what the caption says).
 *
 *   cd apps/web && npm run db:reset && ORIGIN=http://localhost:5210 npx vite build
 *   PORT=5210 ORIGIN=http://localhost:5210 DEV_LOGIN=1 GRANT_SIGNING_KEY="$(cat .dev-grant-key.pem)" \
 *     node --env-file=.env build/index.js > .uat-server.log 2>&1 & echo $! > .uat-server.pid
 *   npx playwright test -c e2e/demo.config.ts
 *   kill $(cat .uat-server.pid)
 *
 * Raw videos land in e2e/demo-results/<name>/, caption timings in e2e/demo-results/captions.json, and
 * the moment each recording first shows a real page in e2e/demo-results/ready.json (the cut starts there,
 * so no blank first frame).
 * Then: node scripts/demo-cut.ts  → e2e/demo-results/final/*.mp4 (captions burned in a band below).
 * All data is invented.
 */
import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { SLUG, clearScores, compId, createInvite, setStatus, sql } from './field-db.ts';

const BASE = 'http://localhost:5210';
const OUT = 'e2e/demo-results';
mkdirSync(OUT, { recursive: true });

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };
const STAGE = { width: 1600, height: 900 };
/** Clip 5's desktop parts: 1280×800 scales to the 1152×720 cut with readable text. */
const DESK5 = { width: 1280, height: 800 };

const timing: Record<string, number> = {};
/** Absolute time (ms) when a recording first shows a real, painted page. */
const ready: Record<string, number> = {};
const open: BrowserContext[] = [];

/** Tap marker: an orange ring wherever the "finger" presses. Captions are NOT drawn in the page
 *  (they would cover the UI); they are logged with timestamps and burned into a band under the
 *  video by scripts/demo-cut.ts. */
const tapMarker = () => {
	const install = () => {
		if (document.getElementById('__tapstyle')) return;
		const style = document.createElement('style');
		style.id = '__tapstyle';
		style.textContent = `.__tap{position:fixed;z-index:2147483646;pointer-events:none;width:44px;height:44px;margin:-22px 0 0 -22px;
  border-radius:50%;border:4px solid #F26B2A;background:rgba(242,107,42,.25);animation:__tap .6s ease-out forwards}
@keyframes __tap{from{transform:scale(.4);opacity:1}to{transform:scale(1.4);opacity:0}}`;
		document.head.appendChild(style);
		addEventListener('pointerdown', (e) => {
			const t = document.createElement('div');
			t.className = '__tap';
			t.style.left = `${e.clientX}px`;
			t.style.top = `${e.clientY}px`;
			document.body.appendChild(t);
			setTimeout(() => t.remove(), 700);
		}, true);
	};
	if (document.readyState === 'loading') addEventListener('DOMContentLoaded', install);
	else install();
};

/** Caption log per recording: seconds from the recording start. */
interface Cap { start: number; end: number | null; text: string }
const captions: Record<string, Cap[]> = {};
const actorOf = new Map<Page, string>();

async function actor(browser: Browser, name: string, viewport: { width: number; height: number }, touch = false) {
	const ctx = await browser.newContext({
		viewport, locale: 'sv-SE', timezoneId: 'Europe/Stockholm', baseURL: BASE,
		isMobile: touch && viewport.width < 600, hasTouch: touch,
		recordVideo: { dir: `${OUT}/${name}`, size: viewport }
	});
	await ctx.addInitScript(tapMarker);
	open.push(ctx);
	const page = await ctx.newPage();
	timing[name] = Date.now();
	captions[name] = [];
	actorOf.set(page, name);
	return { ctx, page };
}

const now = (page: Page) => (Date.now() - timing[actorOf.get(page)!]) / 1000;
/** Marks the first frame worth showing (call once the first real page is on screen). */
async function shown(page: Page) {
	await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
	ready[actorOf.get(page)!] ??= Date.now() + 250;
}
function closeOpen(page: Page) {
	const list = captions[actorOf.get(page)!];
	const last = list.at(-1);
	if (last && last.end === null) last.end = now(page);
}
/** Show a caption (burned in later) and leave time to read it (≈ 1.2 s + 55 ms per character). */
async function say(page: Page, text: string, extra = 0) {
	closeOpen(page);
	captions[actorOf.get(page)!].push({ start: now(page), end: null, text });
	await page.waitForTimeout(1200 + text.length * 55 + extra);
}
async function hush(page: Page) {
	closeOpen(page);
}
const pause = (page: Page, ms = 1300) => page.waitForTimeout(ms);
async function tap(page: Page, locator: ReturnType<Page['getByRole']>, after = 900) {
	await locator.click();
	await page.waitForTimeout(after);
}

async function join(p: Page, secret: string, name: string) {
	await p.goto(`/j/${secret}`);
	await shown(p);
	await say(p, 'Funktionären skannar QR-koden på kontrollskylten. Inget konto, inget lösenord.');
	await p.getByLabel('Vad heter du?').pressSequentially(name, { delay: 140 });
	await pause(p, 700);
	await tap(p, p.getByRole('button', { name: 'Öppna min kontroll' }), 600);
}

async function pickPatrol(p: Page, nr: number, caption: string) {
	await say(p, caption);
	await tap(p, p.getByRole('link', { name: /Skanna patrull/ }), 250);
	await tap(p, p.getByRole('tab', { name: 'Nummer' }), 600);
	for (const d of String(nr)) await tap(p, p.getByRole('button', { name: d, exact: true }), 450);
	await tap(p, p.getByRole('button', { name: new RegExp(`^${nr}`) }), 1000);
}

async function score(p: Page, points: number, style: number) {
	await tap(p, p.getByRole('button', { name: 'Ja, sätt poäng' }), 800);
	await tap(p, p.getByRole('button', { name: String(points), exact: true }), 700);
	await tap(p, p.getByRole('button', { name: `Stil ${style}` }), 900);
	await tap(p, p.getByRole('button', { name: `Spara ${points} + ${style} = ${points + style} p` }), 600);
	await expect(p.getByText('Sparat!')).toBeVisible();
}

async function home(p: Page) {
	await tap(p, p.getByRole('link', { name: 'Skanna nästa patrull' }), 500);
	await tap(p, p.getByRole('link', { name: 'Stäng' }), 800);
}

test.describe.configure({ mode: 'serial' });

test.afterEach(async () => {
	for (const c of open.splice(0)) await c.close().catch(() => undefined);
	// Merged into the existing files, so one clip can be re-recorded alone (--grep 05).
	for (const [file, data] of [['timing', timing], ['captions', captions], ['ready', ready]] as const) {
		const path = `${OUT}/${file}.json`;
		const prev = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
		writeFileSync(path, JSON.stringify({ ...prev, ...data }, null, 2));
	}
});
test.afterAll(async () => { await sql.end(); });

test('01 funktionär, även utan täckning', async ({ browser }) => {
	await clearScores([104, 108], 'Repstegen');
	const { page, ctx } = await actor(browser, 'demo-01-funktionar', PHONE, true);
	await join(page, await createInvite('Repstegen'), 'Anna');
	await expect(page.getByTestId('sync-pill')).toContainText('Synkad');
	await say(page, 'Överst tävlingens egen logga. Startsidan visar vilka patruller som väntas, och om allt är skickat.');

	await pickPatrol(page, 104, 'Kameran läser patrullpasset, eller så knappar man in numret.');
	await say(page, 'Rätt patrull? Tryck ”Ja, sätt poäng”.');
	await tap(page, page.getByRole('button', { name: 'Ja, sätt poäng' }), 600);
	await say(page, 'Stora knappar som går att träffa med kalla fingrar.');
	await tap(page, page.getByRole('button', { name: '17', exact: true }), 700);
	await tap(page, page.getByRole('button', { name: 'Stil 3' }), 700);
	await say(page, 'Spara-knappen visar summan innan man trycker.');
	await tap(page, page.getByRole('button', { name: 'Spara 17 + 3 = 20 p' }), 600);
	await expect(page.getByText('Sparat!')).toBeVisible();
	await say(page, 'Sparat! Fel patrull eller fel siffra? Ångra i tio sekunder.');
	await home(page);

	await ctx.setOffline(true);
	await say(page, 'Nu försvinner täckningen, som ofta i skogen…');
	await pickPatrol(page, 108, 'Funktionären fortsätter som vanligt med nästa patrull.');
	await score(page, 12, 4);
	await say(page, 'Poängen sparas i telefonen.');
	await home(page);
	await expect(page.getByTestId('sync-pill')).toContainText('väntar', { timeout: 20_000 });
	await say(page, 'Den orange markeringen visar att en rapport väntar på täckning.', 500);

	await page.reload();
	await expect(page.getByRole('heading', { name: 'K8 · Repstegen' })).toBeVisible({ timeout: 20_000 });
	await say(page, 'Telefonen startas om utan täckning, och appen fungerar ändå.');
	await tap(page, page.getByRole('link', { name: 'Logg' }), 800);
	await say(page, 'Loggen visar vad som är skickat och vad som väntar.');

	await ctx.setOffline(false);
	await page.evaluate(() => dispatchEvent(new Event('online')));
	await say(page, 'Täckningen kommer tillbaka…');
	await expect(page.getByTestId('sync-pill')).toContainText('Synkad', { timeout: 30_000 });
	await say(page, '…och allt skickas automatiskt. Inget gick förlorat.', 800);
	await hush(page);
	await pause(page, 600);
});

test('02 ledningscentralen live', async ({ browser }) => {
	await clearScores([137], 'Repstegen');
	const { page: hq } = await actor(browser, 'demo-02-hq', DESKTOP);
	const { page: ph } = await actor(browser, 'demo-02-phone', PHONE, true);
	// HQ logs in while the phone joins.
	await hq.goto('/login');
	await hq.getByRole('button', { name: /Logga in som Bengt/ }).click();
	await hq.waitForURL(/\/admin$/);
	await hq.goto(`/admin/${SLUG}/live`);
	await expect(hq.getByTestId('live-status')).toHaveAttribute('data-status', 'open', { timeout: 15_000 });
	await ph.goto(`/j/${await createInvite('Repstegen')}`);
	await ph.getByLabel('Vad heter du?').fill('Omar');
	await ph.getByRole('button', { name: 'Öppna min kontroll' }).click();
	await expect(ph.getByRole('heading', { name: 'K8 · Repstegen' })).toBeVisible();
	// Both start at the same moment (side by side in the cut): once HQ and the phone are ready.
	await shown(ph);
	ready['demo-02-hq'] = ready['demo-02-phone'];

	await say(hq, 'Ledningscentralen: alla kontroller, larm och de senaste rapporterna.');
	await say(ph, 'Samtidigt ute i skogen: funktionären på K8 Repstegen.', -1500);
	await pickPatrol(ph, 137, 'Patrull 137 kommer fram.');
	await score(ph, 17, 3);
	const feed = hq.getByTestId('feed').locator('li').first();
	await expect(feed).toContainText('137 Hackspettarna', { timeout: 20_000 });
	await say(hq, 'Rapporten dyker upp direkt, utan att ladda om sidan.', 800);
	await home(ph);

	await hq.goto(`/admin/${SLUG}/patrol/137`);
	await expect(hq.getByRole('heading', { name: 'Hackspettarna' })).toBeVisible();
	await say(hq, 'Fel siffra på protokollet? Ledningen rättar poängen…');
	await expect(async () => {
		if (!(await hq.locator('form.item').count())) await hq.locator('button.cell[data-code="K8"]').click();
		await expect(hq.locator('form.item').first()).toBeVisible({ timeout: 1000 });
	}).toPass({ timeout: 15_000 });
	const form = hq.locator('form.item').first();
	await pause(hq, 900);
	await form.locator('label.chip', { hasText: /^\s*16\s*$/ }).first().click();
	await pause(hq, 700);
	await form.getByLabel('Anledning').pressSequentially('fel siffra på lappen', { delay: 70 });
	await pause(hq, 600);
	await form.getByRole('button', { name: 'Spara ändring' }).click();
	await expect(hq.getByTestId('timeline')).toContainText('var 17 + 3 → 16 + 3');
	await say(hq, '…och historiken visar vem som ändrade, från vad, och varför.', 600);

	await hq.getByRole('navigation', { name: 'Tävlingsmeny' }).getByRole('link', { name: 'Meddelanden' }).click();
	await hq.waitForLoadState('networkidle');
	await say(hq, 'Ett meddelande till alla funktionärer:');
	await hq.getByLabel('Rubrik').pressSequentially('Fika vid Mål kl 14', { delay: 60 });
	await hq.getByRole('textbox', { name: 'Meddelande' }).pressSequentially('Kanelbullar finns vid målet.', { delay: 45 });
	await pause(hq, 700);
	await hq.getByRole('button', { name: 'Skicka meddelande' }).click();
	const sent = hq.getByTestId('sent-message').first();
	await expect(sent).toContainText(/0 av \d+/);
	await expect(ph.getByText('Nytt från ledningen:')).toBeVisible({ timeout: 30_000 });
	await say(ph, 'Meddelandet syns direkt i telefonen.');
	await tap(ph, ph.getByRole('navigation', { name: 'Huvudmeny' }).getByRole('link', { name: /Meddelanden/ }), 700);
	await tap(ph, ph.getByRole('button', { name: /Fika vid Mål kl 14/ }), 600);
	await expect(sent).toContainText(/1 av \d+/, { timeout: 20_000 });
	await say(hq, 'Ledningen ser hur många som har läst det.', 1200);
	await hush(hq);
	await hush(ph);
	await pause(hq, 500);
});

test('03 mål med flera delar', async ({ browser }) => {
	await clearScores([119], 'Mål');
	await setStatus(119, 'active');
	const { page } = await actor(browser, 'demo-03-mal', PHONE, true);
	await join(page, await createInvite('Mål'), 'Lena');
	await expect(page.getByRole('heading', { name: 'K14 · Mål' })).toBeVisible();
	await pickPatrol(page, 119, 'I mål redovisas flera saker. En skanning räcker.');
	await tap(page, page.getByRole('button', { name: 'Ja, sätt poäng' }), 800);
	await say(page, 'Alla delar på samma skärm. Målgången registreras automatiskt.');
	await say(page, 'Nödbrevet: oöppnat ger 20 poäng.');
	await tap(page, page.getByRole('button', { name: 'Oöppnat · 20 p' }), 900);
	await say(page, 'Händighet: 0–20.');
	await tap(page, page.getByRole('button', { name: '14', exact: true }), 900);
	await say(page, 'Orientering: antal hittade skärmar × 2.');
	for (let i = 0; i < 7; i++) await tap(page, page.getByRole('button', { name: 'Öka Orientering' }), 300);
	await pause(page, 900);
	await say(page, 'Ett tryck sparar allt.');
	await tap(page, page.getByRole('button', { name: 'Spara 48 p' }), 600);
	await expect(page.getByText('Sparat!')).toBeVisible();
	await say(page, 'Klart: patrullen är i mål med alla delar rapporterade.', 800);
	await hush(page);
	await pause(page, 500);
});

test('04 prisutdelning', async ({ browser }) => {
	const { page } = await actor(browser, 'demo-04-prisutdelning', STAGE);
	await page.goto('/login');
	await page.getByRole('button', { name: /Logga in som Bengt/ }).click();
	await page.waitForURL(/\/admin$/);
	await page.goto(`/r/${SLUG}/ceremony`);
	await page.getByRole('link', { name: /Upptäckare/ }).click();
	await expect(page.getByTestId('reveal-card')).toContainText('Strax dags');
	await shown(page);
	await say(page, 'Prisutdelning på storbild: placeringarna avslöjas en i taget.');
	await hush(page);
	for (let i = 0; i < 12; i++) {
		if (await page.getByRole('button', { name: 'Avslöja vinnaren' }).isVisible()) break;
		await page.keyboard.press('ArrowRight');
		await pause(page, 2600);
	}
	await say(page, 'Lika poäng ger delad plats, med förklaring på skärmen.', 400);
	await hush(page);
	await page.getByRole('button', { name: 'Avslöja vinnaren' }).click();
	await expect(page.getByTestId('reveal-name')).toHaveText('Ugglorna');
	await pause(page, 4000);
});

test('05 tävlingens eget utseende', async ({ browser }) => {
	// The patrol's own links (pass and follow page) for patrol 112, as after a registration.
	const sha = (t: string) => createHash('sha256').update(t).digest('base64url');
	const tokenM = 'demoManageToken0123456';
	const tokenF = 'demoFollowToken0123456';
	await sql`update patrol set manage_token_hash = ${sha(tokenM)}, follow_token_hash = ${sha(tokenF)} where competition_id = ${await compId()} and number = 112`;

	// The organiser: Inställningar → Utseende, then the public page on a big screen.
	const { page: org } = await actor(browser, 'demo-05-utseende', DESK5);
	await org.goto('/login');
	await org.getByRole('button', { name: /Logga in som Bengt/ }).click();
	await org.waitForURL(/\/admin$/);
	await org.goto(`/admin/${SLUG}/settings#utseende`);
	const look = org.locator('#utseende');
	await expect(look.getByRole('heading', { name: 'Utseende' })).toBeVisible();
	await look.evaluate((el) => el.scrollIntoView({ block: 'start' }));
	await shown(org);
	await say(org, 'Under Inställningar, Utseende: tävlingens egen logga, omslagsbild och färg.');
	// (Instant scrolls: smooth scrolling costs a lot of video bytes.)
	const swatch = (name: string) => look.getByRole('button', { name }).first();
	await say(org, 'Färgen väljs bland Scouternas profilfärger. Vi provar Äventyrarorange.', -600);
	await tap(org, swatch('Äventyrarorange'), 700);
	await expect(org.locator('input[name=accentColor]')).toHaveValue('#e95f13');
	await org.getByTestId('preview-public').evaluate((el) => el.scrollIntoView({ block: 'center' }));
	await say(org, 'Förhandsvisningen visar direkt hur tävlingssidan och telefonen ser ut.', 600);
	await look.evaluate((el) => el.scrollIntoView({ block: 'start' }));
	await pause(org, 500);
	// GökOpen 2027 inherits Upptäckarblå from the series: "Standard" goes back to inheriting it.
	await tap(org, look.getByRole('button', { name: /^Seriens färg \(standard\)/ }), 600);
	await expect(org.locator('input[name=accentColor]')).toHaveValue('');
	await say(org, 'Tillbaka till seriens färg, Upptäckarblå. Sidhuvuden och knappar är alltid Scoutblå.');

	await org.goto(`/t/${SLUG}`);
	await expect(org.getByTestId('cover')).toBeVisible();
	await say(org, 'Tävlingssidan: omslagsbilden, tävlingens logga och färgen som rand.', 400);
	await org.evaluate(() => scrollTo({ top: document.body.scrollHeight }));
	const sender = org.getByRole('contentinfo', { name: 'Avsändare' });
	await expect(sender.locator('img[alt="Granlidens scoutkår"]')).toBeVisible();
	await pause(org, 900);
	await say(org, 'I sidfoten: arrangörens logga, med Scouterna som tydlig avsändare.', 600);
	await hush(org);
	await pause(org, 400);
	await org.context().close(); // ends this recording here (the clip plays the parts one after another)

	// The same look on a phone: registration, the patrol pass, the follow page and live results.
	const { page: ph } = await actor(browser, 'demo-05-telefon', PHONE, true);
	await ph.goto(`/t/${SLUG}`);
	await expect(ph.getByTestId('cover')).toBeVisible();
	await shown(ph);
	await say(ph, 'I telefonen har tävlingssidan samma utseende.');
	await tap(ph, ph.getByRole('link', { name: 'Anmäl en patrull' }), 900);
	await say(ph, 'Anmälan: varje klass har sin färg.');
	await ph.getByLabel('Patrullens namn').pressSequentially('Trastarna', { delay: 120 });
	await pause(ph, 500);
	const option = ph.locator('label.option').nth(1);
	await option.scrollIntoViewIfNeeded();
	await tap(ph, option, 900);

	await ph.goto(`/m/${tokenM}`);
	await expect(ph.getByTestId('patrol-pass')).toBeVisible();
	await say(ph, 'Patrullpasset med QR-kod, under tävlingens logga.');
	await ph.goto(`/folj/${tokenF}`);
	await expect(ph.getByTestId('follow-summary')).toBeVisible();
	await say(ph, 'Föräldrar följer patrullen på följ-sidan.');
	await ph.goto(`/r/${SLUG}`);
	await expect(ph.getByTestId('public-list')).toBeVisible();
	await say(ph, 'Liveresultat: klasserna känns igen på sina färger.');
	await tap(ph, ph.getByRole('button', { name: /Upptäckare/ }), 900);
	await tap(ph, ph.getByRole('button', { name: /Äventyrare/ }), 1200);
	await hush(ph);
	await pause(ph, 300);
	await ph.context().close();

	// Printed scorecards carry the event logo too.
	const { page: pr } = await actor(browser, 'demo-05-utskrift', DESK5);
	await pr.goto('/login');
	await pr.getByRole('button', { name: /Logga in som Bengt/ }).click();
	await pr.waitForURL(/\/admin$/);
	await pr.goto(`/admin/${SLUG}/print/scorecards`);
	await expect(pr.getByTestId('print-event-logo').first()).toBeVisible();
	await shown(pr);
	await say(pr, 'Poängkorten skrivs ut med tävlingens logga och klassens färg.', 1200);
	await hush(pr);
	await pause(pr, 600);
});

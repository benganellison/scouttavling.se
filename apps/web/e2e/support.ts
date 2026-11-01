/** Helpers shared by the e2e specs (the dev-login users are invented seed data). */
import type { Browser, BrowserContext, Page } from '@playwright/test';

/** Optional browser override (PW_CHROMIUM=/path/to/chrome); otherwise Playwright's own Chromium. */
export const launchOptions = process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {};

/** Signs in through the dev login (DEV_LOGIN=1) and waits for the admin area. */
export async function login(page: Page, who: 'Bengt' | 'Anna' = 'Bengt') {
	await page.goto('/login');
	await page.getByRole('button', { name: new RegExp(`Logga in som ${who}`) }).click();
	await page.waitForURL(/\/admin/);
}

export interface ConsoleEntry {
	test: string;
	type: string;
	text: string;
	url: string;
}

/**
 * Records browser console warnings and errors, and uncaught page errors, from every context the
 * browser opens from now on. Call it in beforeEach with the test's title; read `entries` at the end.
 */
export function watchConsole(browser: Browser) {
	const entries: ConsoleEntry[] = [];
	let current = '';
	const watch = (ctx: BrowserContext) => {
		ctx.on('console', (m) => {
			if (m.type() === 'warning' || m.type() === 'error')
				entries.push({ test: current, type: m.type(), text: m.text(), url: m.page()?.url() ?? m.location().url });
		});
		ctx.on('weberror', (e) => entries.push({ test: current, type: 'pageerror', text: String(e.error()), url: e.page()?.url() ?? '' }));
	};
	const marked = browser as Browser & { __consoleWatched?: boolean };
	if (!marked.__consoleWatched) {
		marked.__consoleWatched = true;
		const open = browser.newContext.bind(browser);
		browser.newContext = async (options) => {
			const ctx = await open(options);
			watch(ctx);
			return ctx;
		};
	}
	return {
		entries,
		setTest: (title: string) => (current = title)
	};
}

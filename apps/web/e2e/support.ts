/** Helpers shared by the e2e specs (the dev-login users are invented seed data). */
import type { Page } from '@playwright/test';

/** Optional browser override (PW_CHROMIUM=/path/to/chrome); otherwise Playwright's own Chromium. */
export const launchOptions = process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {};

/** Signs in through the dev login (DEV_LOGIN=1) and waits for the admin area. */
export async function login(page: Page, who: 'Bengt' | 'Anna' = 'Bengt') {
	await page.goto('/login');
	await page.getByRole('button', { name: new RegExp(`Logga in som ${who}`) }).click();
	await page.waitForURL(/\/admin/);
}

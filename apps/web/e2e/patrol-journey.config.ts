import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';

// Fall back to an older cached Chromium when the pinned one is not downloaded.
const cached = `${homedir()}/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome`;
const executablePath = process.env.PW_CHROMIUM ?? (existsSync(cached) ? cached : undefined);

/** Patrol journey e2e against a dev server on its own DB: see the header of patrol-journey.e2e.ts. */
export default defineConfig({
	testDir: '.',
	testMatch: 'patrol-journey.e2e.ts',
	timeout: 90_000,
	expect: { timeout: 15_000 },
	workers: 1,
	use: {
		baseURL: process.env.PATROL_BASE_URL ?? 'http://localhost:5205',
		viewport: { width: 390, height: 844 },
		locale: 'sv-SE',
		timezoneId: 'Europe/Stockholm',
		launchOptions: { executablePath }
	}
});

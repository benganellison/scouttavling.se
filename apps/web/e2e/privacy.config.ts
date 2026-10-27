import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';

// Fall back to an older cached Chromium when the pinned one is not downloaded.
const cached = `${homedir()}/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome`;
const executablePath = process.env.PW_CHROMIUM ?? (existsSync(cached) ? cached : undefined);

/** Privacy e2e against the dev server on :5204 (PORT=5204 scripts/dev-server.sh start). */
export default defineConfig({
	testDir: '.',
	testMatch: 'privacy.e2e.ts',
	timeout: 60_000,
	use: { baseURL: 'http://localhost:5204', viewport: { width: 1440, height: 900 }, launchOptions: { executablePath } }
});

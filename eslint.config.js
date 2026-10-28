// Lint: the recommended rule sets plus the module boundaries from docs/architecture/01 (§3).
import js from '@eslint/js';
import ts from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';

const restrict = (patterns) => ['error', { patterns }];

export default ts.config(
	{
		ignores: ['**/node_modules', '**/build', '**/.svelte-kit', '**/drizzle', '.local-data', '**/test-results', '**/playwright-report', 'docs']
	},
	js.configs.recommended,
	...ts.configs.recommended,
	...svelte.configs.recommended,
	{
		languageOptions: { globals: { ...globals.browser, ...globals.node } },
		rules: {
			// TypeScript checks these (svelte-check); the JS rule misreads type-only names.
			'no-undef': 'off',
			// Links are plain paths: the app is never served under a base path.
			'svelte/no-navigation-without-resolve': 'off',
			// Flags every `new Map()` in `$derived` (rebuilt, never mutated) and every local Date.
			'svelte/prefer-svelte-reactivity': 'off',
			'@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }]
		}
	},
	{
		files: ['**/*.svelte', '**/*.svelte.ts'],
		languageOptions: { parserOptions: { projectService: true, extraFileExtensions: ['.svelte'], parser: ts.parser } }
	},
	{
		// Playwright fixtures take an object pattern even when no fixture is used: async ({}, info) => …
		files: ['apps/web/e2e/**/*.ts'],
		rules: { 'no-empty-pattern': 'off' }
	},
	// Boundaries
	{
		files: ['packages/domain/src/**/*.ts'],
		ignores: ['**/*.test.ts'],
		rules: {
			'no-restricted-imports': restrict([
				{
					group: ['node:*', 'drizzle-orm', 'drizzle-orm/*', 'postgres', '$app/*', '@sveltejs/*', 'svelte', 'svelte/*'],
					message: 'packages/domain is pure: no I/O, database or SvelteKit.'
				}
			])
		}
	},
	{
		files: ['apps/web/src/lib/**/*.{ts,svelte}'],
		rules: {
			'no-restricted-imports': restrict([
				{ group: ['**/routes/*', '**/routes/**'], message: 'src/lib must not depend on route files: move the shared code into src/lib.' }
			])
		}
	},
	{
		files: ['apps/web/src/lib/server/**/*.ts'],
		rules: {
			'no-restricted-imports': restrict([
				{ group: ['**/routes/*', '**/routes/**'], message: 'src/lib must not depend on route files: move the shared code into src/lib.' },
				{
					group: ['#lib/ui/*', '#lib/ui/**', '**/lib/ui/**'],
					message: 'Server code must not import UI modules: move the helper to a neutral module (e.g. #lib/time.ts).'
				}
			])
		}
	},
	{
		files: ['apps/web/src/lib/**/*.{ts,svelte}', 'apps/web/src/routes/**/*.svelte'],
		ignores: ['apps/web/src/lib/server/**', '**/*.server.ts', '**/*.test.ts'],
		rules: {
			'no-restricted-imports': restrict([
				{ group: ['**/routes/*', '**/routes/**'], message: 'src/lib must not depend on route files.' },
				{ group: ['#lib/server/*', '#lib/server/**', '**/lib/server/**', '$app/env/private'], message: 'Client code must not import server modules.' }
			])
		}
	}
);

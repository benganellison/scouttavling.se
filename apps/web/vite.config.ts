import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			adapter: adapter(),
			// adapter-node 6 no longer reads ORIGIN at runtime: without this, the request origin is derived
			// from the Host header with protocol "https", so plain-http deployments fail Kit's CSRF check.
			// Set ORIGIN at BUILD time (e.g. `ORIGIN=http://localhost:5210 npx vite build`) when not behind TLS.
			paths: { origin: process.env.ORIGIN || undefined }
		})
	]
});

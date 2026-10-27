/**
 * Service worker (03 §3.1): makes the field screens (/f/**, /j/**) reload offline.
 * - Precaches the build output (JS/CSS chunks, the zxing WASM) and static files.
 * - Field navigations: network-first with a 4 s timeout, then the cached page;
 *   /f/** is client-rendered, so any cached /f/ shell can serve any /f/ URL.
 * - API responses are never cached (the snapshot fallback lives in IndexedDB).
 * - Admin/HQ requests pass straight through.
 * Never calls skipWaiting automatically (03 §3.6) except on the very first install.
 */
import { immutable, assets } from '$app/manifest';
import { version } from '$app/env';

interface ExtendableEvent extends Event {
	waitUntil(p: Promise<unknown>): void;
}
interface FetchEvent extends ExtendableEvent {
	request: Request;
	respondWith(r: Response | Promise<Response>): void;
}
interface SWScope {
	addEventListener(type: 'install' | 'activate', fn: (e: ExtendableEvent) => void): void;
	addEventListener(type: 'fetch', fn: (e: FetchEvent) => void): void;
	addEventListener(type: 'message', fn: (e: MessageEvent) => void): void;
	skipWaiting(): Promise<void>;
	clients: { claim(): Promise<void> };
	registration: { active: unknown };
	location: Location;
}
const sw = globalThis as unknown as SWScope;

const BUILD = `st-build-${version}`;
const PAGES = 'st-pages';
const MEDIA = 'st-media';
const SHELL = '/f/_shell';
const devMode = immutable.length === 0; // nothing to precache in `vite dev`

const precache = [...immutable.map((f) => f.path), ...assets.map((f) => f.path)].map((p) => (p.startsWith('/') ? p : `/${p}`));

sw.addEventListener('install', (event) => {
	if (devMode) return;
	event.waitUntil(
		(async () => {
			const cache = await caches.open(BUILD);
			await cache.addAll(precache);
			// One client-rendered shell that can boot any /f/** page offline.
			const pages = await caches.open(PAGES);
			await pages.add(SHELL).catch(() => undefined);
			if (!sw.registration.active) await sw.skipWaiting();
		})()
	);
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			for (const key of await caches.keys()) if (key.startsWith('st-build-') && key !== BUILD) await caches.delete(key);
			// Fonts are self-hosted now (in the build cache); drop the old Google Fonts cache.
			await caches.delete('st-fonts');
			await sw.clients.claim();
		})()
	);
});

sw.addEventListener('message', (event) => {
	if (event.data === 'skip-waiting') void sw.skipWaiting();
});

function timeout(ms: number): Promise<never> {
	return new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms));
}

async function fieldNavigation(request: Request, url: URL): Promise<Response> {
	const pages = await caches.open(PAGES);
	try {
		const res = await Promise.race([fetch(request), timeout(4000)]);
		if (res.ok) {
			void pages.put(request, res.clone());
			if (url.pathname.startsWith('/f/')) void pages.put(SHELL, res.clone());
		}
		return res;
	} catch {
		const hit = (await pages.match(request, { ignoreSearch: true })) ?? (url.pathname.startsWith('/f/') ? await pages.match(SHELL) : undefined);
		return hit ?? new Response('<!doctype html><meta charset="utf-8"><title>Ingen täckning</title><h1>Ingen täckning</h1><p>Sidan finns inte sparad i telefonen än.</p>', { status: 503, headers: { 'content-type': 'text/html; charset=utf-8' } });
	}
}

sw.addEventListener('fetch', (event) => {
	const { request } = event;
	if (request.method !== 'GET' || devMode) return;
	const url = new URL(request.url);

	if (url.origin !== sw.location.origin) return;
	if (url.pathname.startsWith('/api/')) return; // never cache API responses

	// Event logos/covers: /media/<id> never changes (a replaced image gets a new id), so cache-first
	// keeps the volunteer header branded offline.
	if (url.pathname.startsWith('/media/')) {
		event.respondWith(
			(async () => {
				const cache = await caches.open(MEDIA);
				const hit = await cache.match(request);
				if (hit) return hit;
				const res = await fetch(request);
				if (res.ok) void cache.put(request, res.clone());
				return res;
			})()
		);
		return;
	}
	if (precache.includes(url.pathname)) {
		event.respondWith(caches.match(request).then((hit) => hit ?? fetch(request)));
		return;
	}
	if (request.mode === 'navigate' && (url.pathname.startsWith('/f/') || url.pathname.startsWith('/j/'))) {
		event.respondWith(fieldNavigation(request, url));
		return;
	}
	// Kit's client data requests for /f/** (none today, ssr=false) and everything else: network.
});

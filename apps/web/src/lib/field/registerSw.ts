import { dev } from '$app/env';

/**
 * The service worker (offline field app) is registered only where volunteers are: the field app and
 * the join page. Public pages (results, follow, competition page) do not install it, so a thousand
 * parents do not each download the whole app in the background.
 */
export function registerFieldServiceWorker() {
	if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
	void navigator.serviceWorker.register('/service-worker.js', { type: dev ? 'module' : 'classic' }).catch(() => undefined);
}

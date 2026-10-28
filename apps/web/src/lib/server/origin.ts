import { ORIGIN } from '$app/env/private';

/**
 * The public address of this deployment (e.g. https://scouttavling.se), from ORIGIN, which is
 * baked into the image. Falls back to the request's own origin in dev. Used for QR codes, links
 * in messages and every address shown to people, so a staging build never shows the wrong domain.
 */
export function publicOrigin(url: URL): string {
	return (ORIGIN || url.origin).replace(/\/$/, '');
}

/** "scouttavling.se" (host only, for addresses shown as text: "scouttavling.se/gokopen"). */
export function publicHost(url: URL): string {
	return new URL(publicOrigin(url)).host;
}

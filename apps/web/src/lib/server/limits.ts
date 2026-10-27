import { dev } from '$app/env';
import { RateLimiter } from './rateLimit.ts';

/*
 * Per-client limits for public entry points (the client address comes from X-Forwarded-For behind
 * Traefik, see compose.prod.yaml). Higher in dev: the e2e suites join many phones from one address.
 */

/** Joining with an invite (page and redeem): generous, a whole campsite may share one Wi-Fi address. */
export const joinLimiter = new RateLimiter(dev ? 2000 : 60, 600_000);
/** Patrol-pass lookups (/p/<code>): a phone camera opens a few, a script many. */
export const passLimiter = new RateLimiter(dev ? 2000 : 120, 600_000);

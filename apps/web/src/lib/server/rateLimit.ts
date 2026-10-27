/**
 * Fixed-window-ish in-memory rate limiter (sliding log). Good enough for one
 * instance in v0.1; a multi-instance deploy needs a shared store.
 */
export class RateLimiter {
	private hits = new Map<string, number[]>();

	constructor(
		readonly limit: number,
		readonly windowMs: number
	) {}

	/** Records a hit and returns false when the key is over the limit (the hit is then not recorded). */
	hit(key: string, now = Date.now()): boolean {
		const from = now - this.windowMs;
		const list = (this.hits.get(key) ?? []).filter((t) => t > from);
		if (list.length >= this.limit) {
			this.hits.set(key, list);
			return false;
		}
		list.push(now);
		this.hits.set(key, list);
		if (this.hits.size > 10_000) this.prune(now);
		return true;
	}

	/** True when the key would be refused right now (does not record). */
	blocked(key: string, now = Date.now()): boolean {
		const from = now - this.windowMs;
		return (this.hits.get(key) ?? []).filter((t) => t > from).length >= this.limit;
	}

	private prune(now: number) {
		const from = now - this.windowMs;
		for (const [k, list] of this.hits) if (!list.some((t) => t > from)) this.hits.delete(k);
	}
}


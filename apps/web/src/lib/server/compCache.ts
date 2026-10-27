import { latestSeq } from './live.ts';

/**
 * Per-competition cache for data many visitors read (follow pages, public statistics): reused while
 * nothing changed in the competition (same change_log seq) and, under load, for up to `maxStaleMs`
 * without even checking. At most MAX entries (least recently used dropped).
 */
const MAX = 300;
const g = globalThis as unknown as { __compCache?: Map<string, { seq: number; at: number; value: Promise<unknown> }> };
const cache = (g.__compCache ??= new Map());

export async function cachedForCompetition<T>(key: string, competitionId: string, maxStaleMs: number, load: () => Promise<T>): Promise<T> {
	const hit = cache.get(key);
	const age = hit ? Date.now() - hit.at : Infinity;
	if (hit && age < maxStaleMs) return touch(key, hit).value as Promise<T>;
	const seq = await latestSeq(competitionId);
	if (hit && hit.seq === seq && age < 5 * 60_000) {
		hit.at = Date.now();
		return touch(key, hit).value as Promise<T>;
	}
	const entry = { seq, at: Date.now(), value: load() as Promise<unknown> };
	cache.set(key, entry);
	entry.value.catch(() => cache.get(key) === entry && cache.delete(key));
	while (cache.size > MAX) cache.delete(cache.keys().next().value!);
	return entry.value as Promise<T>;
}

function touch<E>(key: string, e: E): E {
	cache.delete(key);
	cache.set(key, e as never);
	return e;
}

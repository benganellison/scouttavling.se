import { invalidate } from '$app/navigation';
import { untrack } from 'svelte';

export interface LiveOptions {
	/** SSE endpoint, e.g. `/api/v1/live/<slug>/events`. */
	url: string;
	/** `depends()` key to invalidate (debounced) whenever an event arrives. */
	depends?: string;
	/** Extra named events to listen for besides `change` (e.g. `results`). */
	events?: string[];
	onEvent?: (type: string, data: unknown) => void;
	debounceMs?: number;
	/** Refresh at the latest this long after the first unhandled change, even if changes keep coming. */
	maxWaitMs?: number;
	/** Never refresh more often than this (heavy pages: the dashboard, statistics). */
	minIntervalMs?: number;
	/** Also invalidate on a timer so "x min sedan" texts stay fresh. */
	refreshMs?: number;
}

export type LiveStatus = 'connecting' | 'open' | 'reconnecting';

/**
 * EventSource wrapper with resume and reconnect. Create it during component
 * initialisation; it opens in an $effect and closes when the component goes.
 * Correctness relies on the cursor: native reconnects send Last-Event-ID, our
 * own reconnects (after an HTTP error) pass ?since=<last seq>.
 */
export class LiveStream {
	status = $state<LiveStatus>('connecting');
	lastSeq = $state<number | null>(null);
	lastEventAt = $state<Date | null>(null);

	constructor(options: () => LiveOptions) {
		// Only the options are dependencies; the connection's own state must not restart it.
		$effect(() => {
			const o = options();
			return untrack(() => this.#connect(o));
		});
	}

	#connect(o: LiveOptions) {
		let es: EventSource | null = null;
		let stopped = false;
		let retry = 0;
		let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
		let debounceTimer: ReturnType<typeof setTimeout> | undefined;
		const refreshTimer = o.refreshMs && o.depends ? setInterval(() => invalidate(o.depends!), o.refreshMs) : undefined;

		// Trailing debounce, but with a ceiling (maxWait) so a steady stream of changes still refreshes
		// the page, and a floor (minInterval) so a busy competition does not reload it constantly.
		let firstPending: number | null = null;
		let lastRun = 0;
		const run = () => {
			firstPending = null;
			lastRun = Date.now();
			void invalidate(o.depends!);
		};
		const schedule = () => {
			if (!o.depends) return;
			const now = Date.now();
			firstPending ??= now;
			clearTimeout(debounceTimer);
			const debounce = now + (o.debounceMs ?? 250);
			const ceiling = firstPending + (o.maxWaitMs ?? 3000);
			const floor = lastRun + (o.minIntervalMs ?? 1500);
			debounceTimer = setTimeout(run, Math.max(Math.min(debounce, ceiling), floor) - now);
		};

		const handler = (type: string) => (e: MessageEvent) => {
			if (e.lastEventId) this.lastSeq = Number(e.lastEventId);
			let data: unknown = null;
			try {
				data = JSON.parse(e.data);
			} catch {
				/* not JSON */
			}
			if (type === 'ready') {
				const seq = (data as { seq?: number } | null)?.seq;
				if (this.lastSeq === null && typeof seq === 'number') this.lastSeq = seq;
				return;
			}
			this.lastEventAt = new Date();
			o.onEvent?.(type, data);
			schedule();
		};

		const open = () => {
			if (stopped) return;
			const u = new URL(o.url, location.href);
			if (this.lastSeq !== null) u.searchParams.set('since', String(this.lastSeq));
			es = new EventSource(u);
			es.onopen = () => {
				this.status = 'open';
				retry = 0;
			};
			for (const t of ['ready', 'change', ...(o.events ?? [])]) es.addEventListener(t, handler(t) as EventListener);
			es.onerror = () => {
				this.status = 'reconnecting';
				if (es && es.readyState === EventSource.CLOSED) {
					es.close();
					reconnectTimer = setTimeout(open, Math.min(30_000, 1000 * 2 ** retry++));
				}
			};
		};
		open();

		return () => {
			stopped = true;
			es?.close();
			clearTimeout(reconnectTimer);
			clearTimeout(debounceTimer);
			if (refreshTimer) clearInterval(refreshTimer);
		};
	}
}

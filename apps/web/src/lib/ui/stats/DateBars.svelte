<script lang="ts">
	/**
	 * Per-date counts as bars with the running total as a line (registrations, payments). A visually
	 * hidden table carries the same numbers for screen readers.
	 */
	let { rows, label, unit }: { rows: { date: string; count: number; total: number }[]; label: string; unit: string } = $props();

	const W = 960;
	const H = 170;
	const PAD = 22;
	const maxCount = $derived(Math.max(1, ...rows.map((r) => r.count)));
	const maxTotal = $derived(Math.max(1, rows.at(-1)?.total ?? 1));
	const step = $derived((W - 2 * PAD) / Math.max(1, rows.length));
	const bw = $derived(Math.max(2, Math.min(22, step * 0.6)));
	const x = (i: number) => PAD + i * step + step / 2;
	const yC = (c: number) => H - PAD - (c / maxCount) * (H - 2 * PAD);
	const yT = (t: number) => H - PAD - (t / maxTotal) * (H - 2 * PAD);
	const line = $derived(rows.map((r, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${yT(r.total).toFixed(1)}`).join(' '));
	const short = (d: string) => `${Number(d.slice(8))}/${Number(d.slice(5, 7))}`;
	const labelEvery = $derived(Math.max(1, Math.ceil(rows.length / 8)));
</script>

<figure class="chart">
	<svg viewBox="0 0 {W} {H}" aria-hidden="true">
		<line class="axis" x1={PAD} x2={W - PAD} y1={H - PAD} y2={H - PAD} />
		{#each rows as r, i (r.date)}
			<rect x={x(i) - bw / 2} y={yC(r.count)} width={bw} height={H - PAD - yC(r.count)} rx="2"
				><title>{short(r.date)}: {r.count} {unit}, totalt {r.total}</title></rect
			>
			{#if i % labelEvery === 0 || i === rows.length - 1}<text x={x(i)} y={H - 6} text-anchor="middle">{short(r.date)}</text>{/if}
		{/each}
		<path class="total" d={line} />
		{#if rows.length}<text class="total-label" x={x(rows.length - 1)} y={yT(maxTotal) - 6} text-anchor="end">totalt {maxTotal}</text>{/if}
	</svg>
	<table class="sr-only">
		<caption>{label}</caption>
		<thead><tr><th scope="col">Datum</th><th scope="col">Per dag</th><th scope="col">Totalt</th></tr></thead>
		<tbody>
			{#each rows as r (r.date)}<tr><th scope="row">{r.date}</th><td>{r.count}</td><td>{r.total}</td></tr>{/each}
		</tbody>
	</table>
	<figcaption class="legend"><span class="sw bar"></span> per dag <span class="sw ln"></span> totalt</figcaption>
</figure>

<style>
	.chart {
		margin: 0;
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: var(--r-lg, 12px);
		padding: 10px 12px;
		/* On a phone the chart keeps a readable size and scrolls sideways inside its frame. */
		overflow-x: auto;
	}
	svg {
		display: block;
		width: 100%;
		min-width: 560px;
		height: auto;
		max-height: 200px;
	}
	rect {
		fill: var(--brand);
		opacity: 0.85;
	}
	.axis {
		stroke: var(--line-strong);
	}
	.total {
		fill: none;
		stroke: var(--orange);
		stroke-width: 2.5;
	}
	text {
		font-size: 11px;
		fill: var(--ink-2);
	}
	.total-label {
		fill: var(--ink);
		font-weight: 700;
	}
	.legend {
		font-size: 12px;
		color: var(--ink-2);
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.sw {
		display: inline-block;
		width: 14px;
		height: 10px;
		border-radius: 2px;
	}
	.sw.bar {
		background: var(--brand);
	}
	.sw.ln {
		height: 3px;
		background: var(--orange);
		margin-left: 10px;
	}
</style>

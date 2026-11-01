<script lang="ts">
	import type { Bucket } from '@scouttavling/domain';

	/** Small bar chart of how many patrols got each score. Decorative: the numbers sit next to it. */
	let { buckets, label }: { buckets: Bucket[]; label: string } = $props();
	const top = $derived(Math.max(1, ...buckets.map((b) => b.count)));
	const W = 168;
	const H = 40;
	const gap = $derived(buckets.length > 12 ? 1 : 2);
	const bw = $derived((W - gap * (buckets.length - 1)) / Math.max(1, buckets.length));
	const tip = (b: Bucket) => `${b.from === b.to ? b.from : `${b.from}–${b.to}`} p: ${b.count} ${b.count === 1 ? 'patrull' : 'patruller'}`;
</script>

<svg class="hist" viewBox="0 0 {W} {H + 12}" width={W} height={H + 12} role="img" aria-label={label}>
	{#each buckets as b, i (i)}
		{@const h = b.count ? Math.max(2, (b.count / top) * H) : 0}
		<rect x={i * (bw + gap)} y={H - h} width={bw} height={h} rx="1.5"><title>{tip(b)}</title></rect>
		<rect class="base" x={i * (bw + gap)} y={H} width={bw} height="1.5" />
	{/each}
	<text x="0" y={H + 11}>{buckets[0]?.from ?? 0}</text>
	<text x={W} y={H + 11} text-anchor="end">{buckets.at(-1)?.to ?? 0}</text>
</svg>

<style>
	.hist {
		display: block;
		max-width: 100%;
		height: auto;
	}
	rect {
		fill: var(--track, var(--brand));
	}
	rect.base {
		fill: var(--line-strong);
	}
	text {
		font-size: 10px;
		fill: var(--ink-2);
		font-variant-numeric: tabular-nums;
	}
</style>

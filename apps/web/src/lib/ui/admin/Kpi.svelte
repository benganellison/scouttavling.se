<script lang="ts">
	let {
		label,
		value,
		of = '',
		note = '',
		tone = 'muted'
	}: { label: string; value: string | number; of?: string; note?: string; tone?: 'muted' | 'ok' | 'warn' } = $props();
</script>

<div class="kpi">
	<span class="l">{label}</span>
	<span class="v"
		>{value}{#if of}<span class="of">{of}</span>{/if}</span
	>
	{#if note}<span class="n {tone}">{note}</span>{/if}
</div>

<style>
	.kpi {
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: var(--r-lg);
		padding: 18px;
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-width: 0;
	}
	.l {
		font-size: 13px;
		font-weight: 700;
		color: var(--ink-2);
	}
	.v {
		font-family: var(--font-display);
		font-weight: 800;
		font-size: 34px;
		line-height: 1.05;
		letter-spacing: -0.02em;
	}
	.of {
		font-size: 18px;
		color: var(--ink-3);
	}
	.n {
		font-size: 13px;
		font-weight: 700;
	}
	.muted {
		color: var(--ink-2);
	}
	.ok {
		color: var(--brand-2);
	}
	.warn {
		color: var(--warn-ink);
	}
</style>

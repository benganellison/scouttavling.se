<script lang="ts">
	/** Numbered phase/step indicator: "1 · Före  2 · Tävlingsdag  3 · Efter". */
	let { steps, current, label = 'Faser' }: { steps: string[]; current: number; label?: string } = $props();
</script>

<ol class="stepper" aria-label={label}>
	{#each steps as s, i (s)}
		<li class:on={i + 1 === current} class:past={i + 1 < current} aria-current={i + 1 === current ? 'step' : undefined}>
			{i + 1} · {s}
		</li>
	{/each}
</ol>

<style>
	.stepper {
		list-style: none;
		margin: 0;
		display: flex;
		align-items: center;
		gap: 6px;
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: 999px;
		padding: 5px;
		flex-wrap: wrap;
	}
	li {
		padding: 8px 16px;
		border-radius: 999px;
		color: var(--ink-2);
		font-weight: 700;
		font-size: 14px;
		white-space: nowrap;
	}
	li.past {
		color: var(--brand-2);
	}
	li.on {
		background: var(--brand);
		color: #fff;
		font-weight: 800;
	}
	@media (max-width: 480px) {
		li {
			padding: 6px 10px;
			font-size: 13px;
		}
	}
</style>

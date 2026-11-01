<script lang="ts">
	/** One patrol's points per station (public results and the organiser's results page). */
	let {
		stations,
		cells,
		id
	}: {
		stations: { name: string; max: number; styleMax: number }[];
		cells: ({ points: number; stylePoints: number } | null)[];
		id?: string;
	} = $props();
</script>

<dl class="breakdown" {id} data-testid="station-breakdown">
	{#each stations as s, i (i)}
		{@const c = cells[i]}
		<div class="line" class:missing={!c}>
			<dt>{s.name}</dt>
			<dd>
				{#if c}
					<strong>{c.points}</strong><span class="of">/{s.max}</span>
					{#if s.styleMax}<span class="style">+{c.stylePoints} stil</span>{/if}
				{:else}
					<span class="of" aria-label="Inte rapporterad">–</span>
				{/if}
			</dd>
		</div>
	{/each}
</dl>

<style>
	.breakdown {
		margin: 0;
		display: grid;
		gap: 0;
	}
	.line {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 12px;
		padding: 7px 0;
		border-top: 1px dashed var(--line);
	}
	.line:first-child {
		border-top: 0;
	}
	dt {
		min-width: 0;
		overflow-wrap: anywhere;
	}
	dd {
		margin: 0;
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
	}
	strong {
		font-weight: 800;
	}
	.of {
		color: var(--ink-2);
	}
	.style {
		color: var(--ink-2);
		font-size: 13px;
		margin-left: 8px;
	}
	.missing dt {
		color: var(--ink-2);
	}
</style>

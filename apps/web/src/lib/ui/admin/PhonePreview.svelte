<script lang="ts">
	/**
	 * What the volunteer will see for a station's first scorable item, built
	 * from the same domain helpers the field app uses.
	 */
	import { selectableValues, styleValues, type ScoreItemDef } from '@scouttavling/domain';

	let {
		code,
		name,
		item,
		checkpoint,
		count,
		index = 1
	}: { code: string; name: string; item: ScoreItemDef | null; checkpoint: boolean; count: number; index?: number } = $props();

	const values = $derived(item ? selectableValues(item) : []);
	const style = $derived(item ? styleValues(item) : []);
	const labelled = $derived(item?.mode === 'DISTINCT' && (item.distinctValues ?? []).some((d) => d.label));
	const cols = $derived(labelled ? 1 : values.length <= 6 ? values.length || 1 : values.length <= 12 ? 4 : 7);
	const labelOf = (v: number) => item?.distinctValues?.find((d) => d.value === v)?.label;
</script>

<div class="wrap">
	<span class="cap">Så ser funktionären det</span>
	<div class="phone" aria-hidden="true">
		<span class="title">{code} · {name || 'Namnlös'}</span>
		{#if item}
			<span class="sub">{item.name}{count > 1 ? ` · del ${index} av ${count}` : ''}</span>
			<span class="h">{item.mode === 'COUNT' ? `Antal (× ${item.countMultiplier ?? 1} poäng)` : 'Poäng'}</span>
			<div class="grid" style="grid-template-columns: repeat({cols}, minmax(0, 1fr))">
				{#each values as v (v)}
					<span class="chip" class:wide={labelled}>
						<strong>{v}</strong>{#if labelled && labelOf(v)}<span class="lab">{labelOf(v)}</span>{/if}
					</span>
				{/each}
			</div>
			{#if values.length === 0}<span class="empty">Inga värden ännu</span>{/if}
			{#if style.length}
				<span class="h">Stilpoäng</span>
				<div class="grid" style="grid-template-columns: repeat({Math.min(style.length, 6)}, minmax(0, 1fr))">
					{#each style as v (v)}<span class="chip">{v}</span>{/each}
				</div>
			{/if}
			<span class="cta">Spara</span>
		{:else if checkpoint}
			<span class="msg">Patrullen checkas in med ett tryck. Inga poäng.</span>
			<span class="cta">Checka in</span>
		{:else}
			<span class="msg">Patrullen registreras automatiskt när funktionären skannar QR-koden.</span>
			<span class="cta">Skanna</span>
		{/if}
	</div>
</div>

<style>
	.wrap {
		display: flex;
		flex-direction: column;
		gap: 10px;
		align-items: center;
	}
	.cap {
		font-size: 12px;
		font-weight: 800;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--ink-2);
	}
	.phone {
		width: 230px;
		height: 420px;
		border-radius: 30px;
		border: 8px solid var(--ink);
		background: var(--ground);
		padding: 16px 12px;
		display: flex;
		flex-direction: column;
		gap: 8px;
		overflow: hidden;
	}
	.title {
		font-family: var(--font-display);
		font-weight: 800;
		font-size: 15px;
		line-height: 1.2;
	}
	.sub {
		font-size: 11px;
		color: var(--ink-2);
		margin-top: -4px;
	}
	.h {
		font-size: 11px;
		font-weight: 800;
		margin-top: 2px;
	}
	.grid {
		display: grid;
		gap: 4px;
	}
	.chip {
		min-height: 30px;
		border-radius: 7px;
		background: var(--surface);
		border: 1px solid var(--line-strong);
		display: flex;
		align-items: center;
		justify-content: center;
		font-weight: 800;
		font-size: 12px;
		gap: 6px;
		padding: 0 4px;
	}
	.chip.wide {
		justify-content: flex-start;
		padding: 4px 8px;
		min-height: 36px;
	}
	.chip.wide strong {
		font-size: 14px;
		min-width: 20px;
	}
	.lab {
		font-weight: 600;
		font-size: 11px;
		color: var(--ink-2);
	}
	.msg,
	.empty {
		font-size: 13px;
		color: var(--ink-2);
		line-height: 1.4;
	}
	.cta {
		margin-top: auto;
		min-height: 38px;
		border-radius: 10px;
		background: var(--cta);
		color: #fff;
		font-weight: 800;
		font-size: 12px;
		display: flex;
		align-items: center;
		justify-content: center;
		flex: none;
	}
</style>

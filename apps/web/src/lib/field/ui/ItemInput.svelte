<script lang="ts">
	/**
	 * The volunteer's input for one score item: chips (RANGE), labelled options (DISTINCT) or a
	 * −/+ stepper (COUNT), plus the style row. Used by the score screen and, inert, by the admin
	 * preview (#lib/ui/admin/PhonePreview.svelte), so the preview is always what volunteers see.
	 */
	import { selectableValues, styleValues, type ScoreItemDef } from '@scouttavling/domain';
	import Icon from './Icon.svelte';

	let {
		item,
		heading,
		// No fallback values: the score page binds entries that start out undefined, and Svelte
		// refuses bind:value={undefined} on a prop with a fallback (props_invalid_value).
		value = $bindable(),
		style = $bindable(),
		fill = false
	}: {
		item: ScoreItemDef;
		heading: string;
		value?: number | null | undefined;
		style?: number | null | undefined;
		/** The only item on screen: the choices fill the height. */
		fill?: boolean;
	} = $props();

	const values = $derived(selectableValues(item));
	const cols = $derived(values.length <= 6 ? values.length || 1 : values.length <= 12 ? 4 : 5);
	const rangeText = $derived(
		item.mode === 'RANGE' ? `${item.min}–${item.max}` : item.mode === 'COUNT' ? `${item.min}–${item.max} × ${item.countMultiplier ?? 1} p` : ''
	);

	function countStep(d: number) {
		value = value == null ? (d > 0 ? Math.min(item.min + 1, item.max) : item.min) : Math.max(item.min, Math.min(item.max, value + d));
	}
	function distinctLabel(v: number) {
		const l = item.distinctValues?.find((d) => d.value === v)?.label;
		return l ? `${l} · ${v} p` : `${v} p`;
	}
</script>

<section class="item" class:grow={item.mode === 'RANGE' || (fill && item.mode === 'DISTINCT')} class:fill aria-labelledby="h-{item.id}">
	<div class="item-head">
		<h2 id="h-{item.id}">{heading} <span class="range">{rangeText}</span></h2>
		<span class="shown">{value ?? '–'}</span>
	</div>

	{#if item.mode === 'RANGE'}
		<div class="grid" style="grid-template-columns: repeat({cols}, minmax(0, 1fr))">
			{#each values as v (v)}
				<button type="button" class="chip" aria-pressed={value === v} onclick={() => (value = v)}>{v}</button>
			{/each}
		</div>
	{:else if item.mode === 'DISTINCT'}
		<div class="stacked">
			{#each values as v (v)}
				<button type="button" class="opt" aria-pressed={value === v} onclick={() => (value = v)}>{distinctLabel(v)}</button>
			{/each}
		</div>
	{:else if item.mode === 'COUNT'}
		<div class="stepper">
			<button type="button" class="step" aria-label="Minska {item.name}" onclick={() => countStep(-1)}><Icon name="minus" size={34} stroke={3} /></button>
			<span class="count" aria-live="polite">
				<span class="cnum">{value ?? '–'} <span class="cmax">/ {item.max}</span></span>
				<span class="cpts">→ {value == null ? '–' : value * (item.countMultiplier ?? 1)} p</span>
			</span>
			<button type="button" class="step" aria-label="Öka {item.name}" onclick={() => countStep(1)}><Icon name="plus" size={34} stroke={3} /></button>
		</div>
	{/if}

	{#if item.styleEnabled}
		<div class="item-head style-head">
			<h3>Stilpoäng <span class="range">{item.styleMin}–{item.styleMax} · samarbete &amp; glädje</span></h3>
			<span class="shown">{style ?? '–'}</span>
		</div>
		<div class="style-row" style="grid-template-columns: repeat({styleValues(item).length}, minmax(0, 1fr))">
			{#each styleValues(item) as v (v)}
				<button type="button" class="chip style" aria-pressed={style === v} aria-label="Stil {v}" onclick={() => (style = v)}>{v}</button>
			{/each}
		</div>
	{/if}
</section>

<style>
	h2,
	h3 {
		font-family: var(--font-ui);
		font-size: 17px;
		font-weight: 800;
		letter-spacing: 0;
	}
	.item {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.item.grow {
		flex: 1 0 auto;
	}
	.item.grow.fill {
		min-height: 0;
		flex: 1 1 0;
	}
	.item-head {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
	}
	.range {
		font-weight: 600;
		color: var(--ink-2);
		font-size: 15px;
	}
	.shown {
		font-family: var(--font-display);
		font-weight: 800;
		font-size: 30px;
		line-height: 1;
		color: var(--brand);
	}
	.grid {
		flex: 1;
		min-height: 0;
		display: grid;
		grid-auto-rows: minmax(56px, 1fr);
		gap: 8px;
	}
	.chip,
	.opt {
		min-height: 56px;
		border-radius: 16px;
		border: 1.5px solid var(--line-strong);
		background: var(--surface);
		color: var(--ink);
		font-family: var(--font-display);
		font-weight: 800;
		font-size: 34px;
		cursor: pointer;
		touch-action: manipulation;
	}
	.chip[aria-pressed='true'],
	.opt[aria-pressed='true'] {
		background: var(--brand);
		border: 2px solid var(--brand);
		color: #fff;
	}
	.stacked {
		flex: 1;
		display: grid;
		grid-auto-rows: minmax(64px, 1fr);
		gap: 8px;
	}
	.opt {
		font-size: 22px;
		text-align: left;
		padding: 0 20px;
	}
	.style-head {
		margin-top: 4px;
	}
	.style-row {
		display: grid;
		gap: 8px;
	}
	.chip.style {
		height: 68px;
	}
	.stepper {
		display: grid;
		grid-template-columns: 84px 1fr 84px;
		gap: 10px;
		align-items: stretch;
	}
	.step {
		height: 84px;
		border-radius: 18px;
		border: 1.5px solid var(--line-strong);
		background: var(--surface);
		color: var(--ink);
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.step:active {
		background: var(--tint);
	}
	.count {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: 18px;
	}
	.cnum {
		font-family: var(--font-display);
		font-weight: 800;
		font-size: 38px;
		line-height: 1;
	}
	.cmax {
		font-size: 22px;
		color: var(--ink-2);
	}
	.cpts {
		font-weight: 800;
		color: var(--brand);
		font-size: 17px;
	}
</style>

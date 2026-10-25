<script lang="ts">
	import { untrack } from 'svelte';
	import { PALETTE, colorName, contrast, parseHex, readableText } from '#lib/brand/colors.ts';

	/**
	 * Colour choice: Scouterna's palette as swatches, "Standard" (= `fallback`) and a custom colour
	 * (picker + hex). Submits `name` = "#rrggbb" or "" (standard). With `showContrast`, a live note
	 * says which text colour reads on it, or that it is decoration only.
	 */
	let {
		name,
		value = $bindable(''),
		fallback,
		fallbackLabel = 'Standard',
		label,
		showContrast = false,
		compact = false,
		disabled = false,
		id
	}: {
		name: string;
		value?: string;
		fallback: string;
		fallbackLabel?: string;
		label: string;
		showContrast?: boolean;
		compact?: boolean;
		disabled?: boolean;
		id: string;
	} = $props();

	let hexText = $state(untrack(() => parseHex(value) ?? ''));
	const effective = $derived(parseHex(value) ?? fallback);
	const r = $derived(readableText(effective));
	const onWhite = $derived(contrast(effective, '#ffffff'));
	const isPalette = (hex: string) => PALETTE.some((p) => p.hex === hex);
	const custom = $derived(!!parseHex(value) && !isPalette(parseHex(value)!));

	function pick(hex: string) {
		value = hex;
		hexText = hex;
	}
	function typed(v: string) {
		hexText = v;
		const h = parseHex(v);
		if (h) value = h;
		else if (v.trim() === '') value = '';
	}
</script>

<fieldset class="cf" class:compact {disabled}>
	<legend class={compact ? 'sr-only' : 'label'}>{label}</legend>
	<input type="hidden" {name} {value} />
	<div class="sw" role="group" aria-label="Färger för {label}">
		<button type="button" class="opt std" aria-pressed={!parseHex(value)} onclick={() => pick('')} title="{fallbackLabel}: {colorName(fallback)}">
			<span class="chip" style="background:{fallback}" aria-hidden="true"></span>
			<span>{fallbackLabel}</span>
			<span class="sr-only">({colorName(fallback)})</span>
		</button>
		{#each PALETTE as p (p.key)}
			<button type="button" class="opt" aria-pressed={parseHex(value) === p.hex} onclick={() => pick(p.hex)} title={p.name} data-swatch={p.hex}>
				<span class="chip" style="background:{p.hex}" aria-hidden="true"></span>
				<span class="sr-only">{p.name}</span>
			</button>
		{/each}
		<label class="opt pickr" class:on={custom} title="Välj egen färg">
			<input type="color" value={effective} oninput={(e) => pick(e.currentTarget.value)} aria-label="Egen färg för {label}" />
			<span class:sr-only={compact}>Egen</span>
		</label>
		<input
			class="hex"
			{id}
			value={hexText}
			oninput={(e) => typed(e.currentTarget.value)}
			placeholder="#rrggbb"
			maxlength="7"
			spellcheck="false"
			autocomplete="off"
			aria-label="Egen färg (hex) för {label}"
			aria-invalid={hexText && !parseHex(hexText) ? 'true' : undefined}
		/>
	</div>
	{#if showContrast}
		<p class="note" data-testid="contrast-note" aria-live="polite">
			<span class="demo" style="background:{effective};color:{r.text ?? '#ffffff'}" aria-hidden="true">{r.text ? 'Aa' : ''}</span>
			{#if r.text}
				<span><strong>{r.text === '#ffffff' ? 'Vit' : 'Svart'} text</strong> på färgen ({r.ratio.toFixed(1)}:1). {onWhite >= 4.5 ? `Läsbar som text på vitt (${onWhite.toFixed(1)}:1).` : `Inte läsbar som text på vitt (${onWhite.toFixed(1)}:1), används bara som yta och dekor.`}</span>
			{:else}
				<span><strong>Bara dekor.</strong> Varken svart eller vit text når 4,5:1 ({r.ratio.toFixed(1)}:1), så färgen används aldrig bakom text.</span>
			{/if}
		</p>
	{/if}
</fieldset>

<style>
	.cf {
		border: 0;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
		min-width: 0;
	}
	.sw {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		align-items: center;
	}
	.opt {
		min-height: 44px;
		min-width: 44px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		padding: 0 6px;
		border-radius: 12px;
		border: 1.5px solid var(--line-strong);
		background: var(--surface);
		cursor: pointer;
		font-weight: 700;
		font-size: 14px;
	}
	.opt.std {
		padding: 0 10px 0 6px;
	}
	.opt[aria-pressed='true'],
	.opt.on {
		border-color: var(--brand);
		box-shadow: inset 0 0 0 2px var(--brand);
	}
	.chip {
		width: 26px;
		height: 26px;
		border-radius: 7px;
		box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.2);
	}
	.pickr {
		padding: 0 10px 0 4px;
		cursor: pointer;
	}
	.compact .pickr {
		padding: 0 4px;
	}
	/* The native picker as a rainbow well, so it never looks like one of the palette swatches. */
	.pickr input {
		width: 30px;
		height: 30px;
		border: 0;
		padding: 0;
		border-radius: 7px;
		background: conic-gradient(red, yellow, lime, cyan, blue, magenta, red);
		cursor: pointer;
		appearance: none;
		-webkit-appearance: none;
	}
	.pickr input::-webkit-color-swatch-wrapper {
		padding: 0;
	}
	.pickr input::-webkit-color-swatch {
		border: 0;
		opacity: 0;
	}
	.pickr input::-moz-color-swatch {
		border: 0;
		opacity: 0;
	}
	.hex {
		width: 108px;
		min-height: 44px;
		font-family: ui-monospace, monospace;
		font-size: 14px;
	}
	.note {
		margin: 0;
		display: flex;
		gap: 10px;
		align-items: center;
		font-size: 14px;
		color: var(--ink-2);
	}
	.demo {
		width: 44px;
		height: 32px;
		flex: none;
		border-radius: 8px;
		display: grid;
		place-items: center;
		font-weight: 800;
	}
	.compact .opt {
		min-height: 40px;
		min-width: 40px;
	}
	.compact .chip {
		width: 22px;
		height: 22px;
	}
</style>

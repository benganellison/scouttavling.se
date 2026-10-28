<script lang="ts">
	import type { BrandImage } from '#lib/brand/branding.ts';
	import ScouternaSymbol from '#lib/ui/brand/ScouternaSymbol.svelte';

	/** The event logo on printouts (height in mm), or Scouterna's symbol when none is uploaded. */
	let { logo, mm = 14 }: { logo: BrandImage | null; mm?: number } = $props();
</script>

{#if logo}
	<img class="pel" src={logo.url} alt={logo.alt} style="height:{mm}mm;max-width:{mm * 3.5}mm" data-testid="print-event-logo" />
{:else}
	<ScouternaSymbol size={mm} print />
{/if}

<style>
	.pel {
		width: auto;
		object-fit: contain;
		flex: none;
	}
</style>

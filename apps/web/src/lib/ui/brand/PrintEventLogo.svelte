<script lang="ts">
	import type { BrandImage } from '#lib/brand/branding.ts';
	import Flag from '#lib/ui/Flag.svelte';

	/** The event logo on printouts (height in mm), or the app's control flag when none is uploaded. */
	let { logo, mm = 14 }: { logo: BrandImage | null; mm?: number } = $props();
</script>

{#if logo}
	<img class="pel" src={logo.url} alt={logo.alt} style="height:{mm}mm;max-width:{mm * 3.5}mm" data-testid="print-event-logo" />
{:else}
	<span class="flag" style="width:{mm}mm;height:{mm}mm"><Flag size={64} /></span>
{/if}

<style>
	.pel {
		width: auto;
		object-fit: contain;
		flex: none;
	}
	.flag {
		display: inline-flex;
		flex: none;
	}
	.flag :global(svg) {
		width: 100%;
		height: 100%;
	}
</style>

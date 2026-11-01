<script lang="ts">
	/**
	 * Scouterna's official logo, unchanged (static/brand/scouterna/, see its README).
	 * - `onDark`: white version on Scoutblå/dark images; otherwise the blue version.
	 * - `tagline`: "Raised by Adventure" variant (external pages). Don't use it where the
	 *   tagline is also a heading on the page.
	 * - Clear space: 1× the x-height of "scouterna" on every side (padding below, inside the box).
	 * - Minimum size: 250 px wide on screen, 35 mm in print (`print` switches to mm).
	 */
	let { onDark = false, tagline = false, width = 250, print = false }: { onDark?: boolean; tagline?: boolean; width?: number; print?: boolean } = $props();

	const w = $derived(Math.max(250, width));
	const ratio = $derived(tagline ? 500 / 1440 : 314.77 / 1440);
	const src = $derived(`/brand/scouterna/scouterna${tagline ? '_tagline' : ''}_${onDark ? 'white' : 'blue'}_RGB.svg`);
	// x-height of the lowercase letters ≈ 0.41 of the plain logo's height; the SVG already holds
	// a small margin (≈1.4 % of the width), so the padding adds the rest.
	const clear = $derived(Math.round(0.41 * (314.77 / 1440) * w - 0.014 * w));
	const mm = $derived(Math.max(35, (w / 250) * 35));
</script>

{#if print}
	<span class="logo print" style="padding:{(mm * 0.075).toFixed(1)}mm" data-scouterna-logo={onDark ? 'white' : 'blue'}>
		<img {src} alt="Scouterna" style="width:{mm}mm;height:{(mm * ratio).toFixed(2)}mm" />
	</span>
{:else}
	<span class="logo" style="padding:{clear}px" data-scouterna-logo={onDark ? 'white' : 'blue'}>
		<img {src} alt="Scouterna" width={w} height={Math.round(w * ratio)} />
	</span>
{/if}

<style>
	.logo {
		display: inline-block;
		line-height: 0;
		flex: none;
	}
	img {
		display: block;
		max-width: none;
	}
</style>

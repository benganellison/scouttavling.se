<script lang="ts">
	import type { BrandImage } from '#lib/brand/branding.ts';

	/** An uploaded event/organiser logo, sized by height and never distorted. */
	let { logo, height = 48, onDark = false }: { logo: BrandImage; height?: number; onDark?: boolean } = $props();
</script>

<span class="ev" class:on-dark={onDark} style="--h:{height}px">
	<img src={logo.url} alt={logo.alt} width={logo.width} height={logo.height} />
</span>

<style>
	.ev {
		display: inline-flex;
		flex: none;
		line-height: 0;
	}
	/* Logos are often dark on transparent: a white plate keeps them visible on Scoutblå. */
	.on-dark {
		background: #fff;
		border-radius: 8px;
		padding: 4px;
	}
	img {
		height: var(--h);
		width: auto;
		max-width: calc(var(--h) * 3.5);
		object-fit: contain;
	}
</style>

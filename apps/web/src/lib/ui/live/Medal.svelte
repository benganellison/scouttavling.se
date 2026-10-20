<script lang="ts">
	/** Place badge; gold / silver / bronze for 1–3. */
	let { place, size = 36 }: { place: number; size?: number } = $props();
	const tone = $derived(place === 1 ? 'gold' : place === 2 ? 'silver' : place === 3 ? 'bronze' : 'plain');
</script>

<span class="medal {tone}" style="--s: {size}px" aria-label="Plats {place}">{place}</span>

<style>
	.medal {
		display: inline-grid;
		place-items: center;
		width: var(--s);
		height: var(--s);
		border-radius: 50%;
		font-family: var(--font-display);
		font-weight: 800;
		font-size: calc(var(--s) * 0.45);
		color: var(--ink);
		background: var(--sage-tint);
		flex: none;
	}
	.gold {
		background: #f2c14e;
	}
	.silver {
		background: #d5dbd7;
	}
	.bronze {
		background: #e3a574;
	}
</style>

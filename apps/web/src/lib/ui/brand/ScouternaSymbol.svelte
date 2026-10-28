<script lang="ts">
	/**
	 * Scouterna's official scout symbol, unchanged (static/brand/scouterna/Scoutsymbolen_rgb.png), for
	 * small square spots where the full logo (≥250 px) does not fit: compact headers, loading screens.
	 * The symbol only exists in blue, so on Scoutblå/dark it sits on a white plate (allowed by the profile).
	 * Where there is room, use ScouternaLogo.svelte instead.
	 */
	let { size = 32, onDark = false, print = false }: { size?: number; onDark?: boolean; print?: boolean } = $props();
	const unit = $derived(print ? 'mm' : 'px');
</script>

<span class="sym" class:plate={onDark} style="--s:{size}{unit}" data-scouterna-symbol>
	<img src="/brand/scouterna/Scoutsymbolen_rgb.png" alt="Scouterna" width={print ? undefined : size} height={print ? undefined : size} />
</span>

<style>
	.sym {
		display: inline-flex;
		flex: none;
		line-height: 0;
	}
	.plate {
		background: #fff;
		border-radius: calc(var(--s) * 0.2);
		padding: calc(var(--s) * 0.12);
	}
	img {
		width: var(--s);
		height: var(--s);
		display: block;
	}
</style>

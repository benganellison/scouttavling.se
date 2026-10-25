<script lang="ts">
	import { needsOutline } from '#lib/brand/colors.ts';

	/** A class colour as a decorative chip (never carries text). `bar` = a tall edge for list rows. */
	let { color, size = 14, bar = false }: { color: string | null | undefined; size?: number; bar?: boolean } = $props();
</script>

{#if color}
	<span class="chip" class:bar class:outline={needsOutline(color)} style="--c:{color};--s:{size}px" aria-hidden="true" data-track-color={color}></span>
{/if}

<style>
	.chip {
		display: inline-block;
		flex: none;
		width: var(--s);
		height: var(--s);
		border-radius: 4px;
		background: var(--c);
		vertical-align: middle;
	}
	.bar {
		width: 6px;
		height: auto;
		align-self: stretch;
		min-height: 1.4em;
		border-radius: 3px;
	}
	.outline {
		box-shadow: inset 0 0 0 1.5px var(--ink-3);
	}
</style>

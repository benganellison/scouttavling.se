<script lang="ts">
	import type { Snippet } from 'svelte';

	let { back, title, meta = '', children }: { back: string; title: string; meta?: string; children?: Snippet } = $props();
</script>

<div class="print-bar no-print">
	<div class="row">
		<a href={back}>← Utskrifter</a>
		<strong>{title}</strong>
		{#if meta}<span class="meta">{meta}</span>{/if}
	</div>
	<div class="opts">
		{@render children?.()}
		<button type="button" class="btn btn-accent" onclick={() => window.print()}>Skriv ut</button>
	</div>
</div>

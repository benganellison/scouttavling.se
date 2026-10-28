<script lang="ts">
	import CompetitionPage from './CompetitionPage.svelte';
	import SeriesPage from './SeriesPage.svelte';

	/** /t/<slug> is an edition's page, or (when no edition has that slug) a series page with its archive. */
	let { data } = $props();
</script>

{#if data.kind === 'series'}
	<SeriesPage {data} />
{:else}
	<CompetitionPage {data} />
{/if}

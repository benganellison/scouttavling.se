<script lang="ts">
	import ScouternaSymbol from '#lib/ui/brand/ScouternaSymbol.svelte';
	let { data } = $props();
</script>

<svelte:head>
	<title>{data.patrol ? `Patrull ${data.patrol.number} ${data.patrol.name}` : 'Patrullkod'}</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<main>
	<ScouternaSymbol size={44} />
	{#if data.patrol}
		<span class="comp">{data.patrol.competition}</span>
		<h1>Patrull {data.patrol.number}<br />{data.patrol.name}</h1>
		<p>Är du funktionär? Öppna koden i poängappen för att rapportera.</p>
		<a class="btn btn-primary big" href="/f/{data.patrol.slug}/scan?nr={data.patrol.number}">Öppna i poängappen</a>
		<p class="small">Det här är patrullens kod för kontrollerna. Resultat publiceras av tävlingsledningen.</p>
	{:else}
		<h1>Okänd patrullkod</h1>
		<p>Koden kunde inte kännas igen. Kontrollera att hela QR-koden skannades.</p>
	{/if}
</main>

<style>
	main {
		min-height: 100dvh;
		max-width: 480px;
		margin: 0 auto;
		padding: 32px 20px;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 14px;
	}
	.comp {
		font-weight: 700;
		color: var(--ink-2);
	}
	h1 {
		font-size: 40px;
	}
	p {
		margin: 0;
		font-size: 17px;
		color: var(--ink-2);
	}
	.big {
		min-height: 60px;
		font-size: 18px;
	}
	.small {
		font-size: 14px;
	}
</style>

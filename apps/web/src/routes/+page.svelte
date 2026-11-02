<script lang="ts">
	import ScouternaSymbol from '#lib/ui/brand/ScouternaSymbol.svelte';
	import ScouternaLogo from '#lib/ui/brand/ScouternaLogo.svelte';
</script>

<svelte:head><title>Scouttävling</title></svelte:head>

<main>
	<div class="row"><ScouternaSymbol size={44} /> <span class="brand">Scouttävling</span></div>
	<h1>Från anmälan till prisutdelning — utan en enda manual.</h1>
	<div class="row">
		<a class="btn btn-primary" href="/admin">Tävlingsledning</a>
	</div>
	<p class="credit">
		Scouttävling bygger vidare på <a href="https://github.com/erydberg/gokapp">gokapp</a> av Erik Rydberg. Klasser, kontroller med stilpoäng, startfördelning, start
		och mål och hur resultaten avgörs kommer därifrån. Tack, Erik!
	</p>
	<footer><ScouternaLogo tagline /></footer>
</main>

<style>
	main {
		max-width: 960px;
		margin: 0 auto;
		padding: 64px 20px;
		display: flex;
		flex-direction: column;
		gap: 28px;
	}
	.brand {
		font-family: var(--font-display);
		font-weight: 800;
		font-size: 26px;
	}
	footer {
		margin: 24px 0 0 -19px;
	}
	.credit {
		max-width: 60ch;
		margin: 24px 0 0;
		color: var(--ink-2);
	}
	.credit a {
		color: inherit;
	}
	h1 {
		font-size: clamp(36px, 6vw, 64px);
	}
</style>

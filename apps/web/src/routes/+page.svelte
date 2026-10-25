<script lang="ts">
	import Flag from '#lib/ui/Flag.svelte';
	import ScouternaLogo from '#lib/ui/brand/ScouternaLogo.svelte';
</script>

<svelte:head><title>Scouttävling</title></svelte:head>

<main>
	<div class="row"><Flag size={44} /> <span class="brand">Scouttävling</span></div>
	<h1>Från anmälan till prisutdelning — utan en enda manual.</h1>
	<div class="row">
		<a class="btn btn-primary" href="/admin">Tävlingsledning</a>
	</div>
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
	h1 {
		font-size: clamp(36px, 6vw, 64px);
	}
</style>

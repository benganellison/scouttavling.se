<script lang="ts">
	import ScouternaSymbol from '#lib/ui/brand/ScouternaSymbol.svelte';
	import EventLogo from '#lib/ui/brand/EventLogo.svelte';
	import SenderFooter from '#lib/ui/brand/SenderFooter.svelte';
	import StatsView from '#lib/ui/stats/StatsView.svelte';
	import { accentStyle } from '#lib/brand/branding.ts';

	let { data } = $props();
</script>

<svelte:head>
	<title>Statistik · {data.comp.name}</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="wrap" style={accentStyle(data.branding)}>
	<header class="top">
		<div class="brand">{#if data.branding.eventLogo}<EventLogo logo={data.branding.eventLogo} height={40} onDark />{:else}<ScouternaSymbol size={28} onDark />{/if} <span>{data.comp.name}</span></div>
		<nav class="links" aria-label="Tävlingen">
			<a href="/r/{data.comp.slug}">{data.comp.final ? 'Slutresultat' : 'Resultat'}</a>
			<a href="/r/{data.comp.slug}/statistik" aria-current="page">Statistik</a>
		</nav>
	</header>

	<main class="stack">
		<h1>Statistik</h1>
		<StatsView stats={data.stats} trackColors={data.trackColors} hiddenNote="Poäng per kontroll och tider visas när tävlingen är avslutad." />
		<SenderFooter organiserName={data.branding.organiserName} organiserLogo={data.branding.organiserLogo} />
	</main>
</div>

<style>
	.wrap {
		min-height: 100dvh;
		background: var(--ground);
	}
	.top {
		background: var(--brand);
		color: #fff;
		padding: 18px 16px 0;
		border-top: 6px solid var(--event-stripe);
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.brand {
		display: flex;
		align-items: center;
		gap: 10px;
		font-family: var(--font-display);
		font-weight: 800;
		font-size: 22px;
	}
	.links {
		display: flex;
		gap: 4px;
	}
	.links a {
		color: #fff;
		text-decoration: none;
		font-weight: 800;
		padding: 10px 14px;
		min-height: var(--tap);
		display: inline-flex;
		align-items: center;
		border-bottom: 3px solid transparent;
	}
	.links a[aria-current='page'] {
		border-bottom-color: #fff;
	}
	main {
		padding: 16px;
		max-width: 960px;
		margin: 0 auto;
		gap: 16px;
	}
	h1 {
		margin: 4px 0 0;
		font-size: 30px;
	}
</style>

<script lang="ts">
	import ScouternaSymbol from '#lib/ui/brand/ScouternaSymbol.svelte';
	import ScouternaLogo from '#lib/ui/brand/ScouternaLogo.svelte';

	let { data } = $props();
</script>

<svelte:head><title>Logga in · Scouttävling</title></svelte:head>

<div class="wrap">
	<section class="hero">
		<div class="row"><ScouternaSymbol size={40} onDark /> <span class="brand">Scouttävling</span></div>
		<h1>Planera, genomför och avsluta er patrulltävling.</h1>
		<p>Logga in med samma konto som i Scoutnet. Ingen ny användare, inget nytt lösenord.</p>
		<div class="sender"><ScouternaLogo onDark tagline /></div>
	</section>
	<main class="stack">
		<h2>Logga in</h2>
		{#if data.scoutId}
			<a class="btn btn-primary big" href="/auth/login?next={encodeURIComponent(data.next)}">Logga in med ScoutID</a>
		{:else}
			<button class="btn big" disabled>Logga in med ScoutID (inte konfigurerat ännu)</button>
		{/if}
		<p class="muted small">
			Du skickas till Scouternas inloggning och tillbaka hit. Vi får ditt namn, medlemsnummer, e-post och vilka kårer du tillhör — aldrig
			personnummer.
		</p>
		{#if data.devLogin}
			<form method="POST" action="?/dev" class="dev card stack">
				<span class="pill pill-warn">Endast utveckling</span>
				<input type="hidden" name="next" value={data.next} />
				<div class="row">
					<button class="btn" name="who" value="erik">Logga in som Erik (tävlingsledare)</button>
					<button class="btn" name="who" value="anna">Logga in som Anna</button>
				</div>
			</form>
		{/if}
		<div class="other">
			<strong>Inte medlem i Scouterna?</strong>
			<p class="muted small">Funktionär: skanna QR-koden på din kontrollskylt — ingen inloggning behövs.</p>
		</div>
	</main>
</div>

<style>
	.wrap {
		min-height: 100dvh;
		display: flex;
		flex-wrap: wrap;
	}
	.hero {
		flex: 1 1 420px;
		background: var(--brand);
		color: #fff;
		padding: 56px;
		display: flex;
		flex-direction: column;
		gap: 22px;
	}
	.dev .pill {
		align-self: flex-start;
	}
	.sender {
		margin-top: auto;
		margin-left: -19px;
	}
	.brand {
		font-family: var(--font-display);
		font-weight: 800;
		font-size: 24px;
	}
	.hero h1 {
		margin-top: 40px;
		font-size: clamp(36px, 5vw, 56px);
		max-width: 560px;
	}
	.hero p {
		color: var(--on-brand);
		font-size: 18px;
		max-width: 480px;
	}
	main {
		flex: 1 1 420px;
		padding: 56px;
		max-width: 680px;
		justify-content: center;
	}
	.big {
		min-height: 64px;
		font-size: 18px;
	}
	.small {
		font-size: 14px;
		margin: 0;
	}
	.dev {
		gap: 10px;
	}
	.other {
		border-top: 1px solid var(--line);
		padding-top: 18px;
	}
	@media (max-width: 600px) {
		.hero,
		main {
			padding: 28px 20px;
		}
	}
</style>

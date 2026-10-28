<script lang="ts">
	import { page } from '$app/state';
	import ScouternaSymbol from '#lib/ui/brand/ScouternaSymbol.svelte';

	const HELP: Record<number, string> = {
		404: 'Kontrollera adressen, eller gå till startsidan.',
		403: 'Du är inloggad men har inte behörighet här.',
		423: 'Arrangören och plattformen arbetar med saken. Försök igen senare.'
	};
	const status = $derived(page.status);
	const message = $derived(page.error?.message || (status === 404 ? 'Sidan finns inte' : 'Något gick fel'));
</script>

<svelte:head><title>{message} · Scouttävling</title></svelte:head>

<main class="wrap">
	<section class="card box" aria-labelledby="err-h">
		<ScouternaSymbol size={44} />
		<h1 id="err-h">{message}</h1>
		<p class="muted">{HELP[status] ?? 'Försök igen om en stund.'}</p>
		<p class="muted code">Felkod {status}</p>
		<a class="btn btn-ghost" href="/">Till startsidan</a>
	</section>
</main>

<style>
	.wrap {
		min-height: 100dvh;
		display: grid;
		place-items: center;
		padding: 24px 16px;
		background: var(--ground);
	}
	.box {
		max-width: 520px;
		width: 100%;
		padding: 32px 28px;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 12px;
	}
	h1 {
		font-size: 28px;
		font-weight: 800;
		letter-spacing: -0.02em;
		margin: 4px 0 0;
	}
	p {
		margin: 0;
	}
	.code {
		font-size: 13px;
	}
</style>

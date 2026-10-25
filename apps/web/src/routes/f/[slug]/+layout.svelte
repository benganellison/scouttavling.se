<script lang="ts">
	import { onDestroy } from 'svelte';
	import { page } from '$app/state';
	import { FieldApp, provideField } from '#lib/field/app.svelte.ts';
	import Flag from '#lib/ui/Flag.svelte';
	import { accentStyle } from '#lib/brand/branding.ts';

	let { children } = $props();
	const app = new FieldApp(page.params.slug ?? '');
	provideField(app);
	void app.init();
	onDestroy(() => app.destroy());
</script>

<svelte:head>
	<title>{app.pack ? `${app.station?.code ?? ''} ${app.station?.name ?? 'Start & mål'} · ${app.pack.competition.name}` : 'Kontroll'}</title>
	<link rel="manifest" href="/f/{app.slug}/manifest.webmanifest" />
	<meta name="robots" content="noindex" />
</svelte:head>

{#if !app.ready}
	<div class="center" aria-busy="true"><Flag size={48} /></div>
{:else if !app.grant}
	<main class="center">
		<Flag size={48} />
		<h1>Telefonen är inte kopplad hit</h1>
		<p>Skanna QR-koden du fick av tävlingsledningen för att öppna din kontroll.</p>
	</main>
{:else if !app.pack}
	<main class="center" aria-busy="true">
		<Flag size={48} />
		<h1>Hämtar kontrollen…</h1>
		{#if app.authProblem}<p class="error-text">{app.authProblem}</p>{:else if !app.online}<p>Behöver täckning en gång för att hämta patrullerna.</p>{/if}
	</main>
{:else}
	{#if app.authProblem}
		<div class="auth" role="alert">{app.authProblem}</div>
	{/if}
	{#if app.closed}
		<div class="closed" role="alert" data-testid="closed-banner">Tävlingen är avslutad — rapporter tas inte emot</div>
	{/if}
	<!-- Event accent variables for every field screen (older cached packs have no branding). -->
	<div class="brandvars" style={app.pack.competition.branding ? accentStyle(app.pack.competition.branding) : '--event-stripe: var(--orange)'}>
		{@render children()}
	</div>
{/if}

<style>
	:global(body) {
		overscroll-behavior-y: none;
	}
	.center {
		min-height: 100dvh;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 14px;
		padding: 24px;
		text-align: center;
	}
	.center h1 {
		font-size: 28px;
	}
	.center p {
		margin: 0;
		font-size: 17px;
		color: var(--ink-2);
		max-width: 32ch;
	}
	.brandvars {
		display: contents;
	}
	.closed {
		background: var(--brand);
		color: #fff;
		font-weight: 800;
		padding: 12px 16px;
		font-size: 16px;
		text-align: center;
	}
	.auth {
		background: var(--danger);
		color: #fff;
		font-weight: 700;
		padding: 10px 16px;
		font-size: 15px;
	}
</style>

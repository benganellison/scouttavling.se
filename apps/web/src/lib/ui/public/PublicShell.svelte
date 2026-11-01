<script lang="ts">
	import type { Snippet } from 'svelte';
	import ScouternaSymbol from '#lib/ui/brand/ScouternaSymbol.svelte';
	import EventLogo from '#lib/ui/brand/EventLogo.svelte';
	import SenderFooter from '#lib/ui/brand/SenderFooter.svelte';
	import { accentStyle, type Branding } from '#lib/brand/branding.ts';

	/**
	 * Phone-first shell for public and patrol-leader pages. Scouterna base: a Scoutblå header
	 * (the event's accent only as a stripe/chip, so Scoutblå stays dominant), optional cover image
	 * above it (never with text on it), and the sender footer "Arrangeras av … · Scouterna".
	 */
	let {
		title,
		eyebrow = '',
		href = null,
		branding = null,
		showCover = false,
		children,
		hero
	}: {
		title: string;
		eyebrow?: string;
		href?: string | null;
		branding?: Branding | null;
		showCover?: boolean;
		children: Snippet;
		hero?: Snippet;
	} = $props();

	const style = $derived(branding ? accentStyle(branding) : '');
</script>

<div class="shell" {style} data-accent={branding?.accent ?? ''}>
	{#if showCover && branding?.cover}
		<!-- Never upscaled beyond 2× (low-res banners blur), centred on wide screens; 'contain' never crops baked-in text. -->
		<div class="cover {branding.coverFit}" style="--cw:{branding.cover.width * 2}px;--ar:{branding.cover.width} / {branding.cover.height}">
			<img
				src={branding.cover.url}
				alt={branding.cover.alt}
				width={branding.cover.width}
				height={branding.cover.height}
				data-testid="cover"
				data-fit={branding.coverFit}
			/>
		</div>
	{/if}
	<header class="top" class:stripe={branding?.customAccent}>
		<div class="inner">
			<div class="brand">
				{#if branding?.eventLogo}
					<EventLogo logo={branding.eventLogo} height={40} onDark />
				{:else}
					<ScouternaSymbol size={26} onDark />
				{/if}
				{#if href}<a {href}>{title}</a>{:else}<span>{title}</span>{/if}
			</div>
			{#if eyebrow}<p class="eyebrow">{eyebrow}</p>{/if}
			{#if hero}{@render hero()}{/if}
		</div>
	</header>
	<main class="inner main">
		{@render children()}
	</main>
	<div class="inner foot">
		<SenderFooter organiserName={branding?.organiserName ?? null} organiserLogo={branding?.organiserLogo ?? null} />
		<p class="app">scouttavling.se</p>
	</div>
</div>

<style>
	.shell {
		min-height: 100dvh;
		background: var(--ground);
		display: flex;
		flex-direction: column;
	}
	.cover {
		background: var(--brand);
		line-height: 0;
	}
	/* The band around a contained banner is Scoutblå (never a stretched image). */
	.cover img {
		display: block;
		margin: 0 auto;
		width: 100%;
		max-width: min(var(--cw), 960px);
	}
	.cover.contain img {
		height: auto;
		aspect-ratio: var(--ar);
		object-fit: contain;
	}
	.cover.cover img {
		height: clamp(140px, 38vw, 300px);
		object-fit: cover;
	}
	.top {
		background: var(--brand);
		color: #fff;
		padding: 16px 16px 22px;
	}
	/* The organiser's accent as a decorative stripe; Scoutblå stays the header colour. */
	.top.stripe {
		border-bottom: 6px solid var(--event-accent);
	}
	.inner {
		width: 100%;
		max-width: 640px;
		margin: 0 auto;
	}
	.brand {
		display: flex;
		align-items: center;
		gap: 10px;
		font-family: var(--font-display);
		font-weight: 800;
		font-size: 18px;
		min-width: 0;
	}
	.brand a,
	.brand span {
		color: #fff;
		text-decoration: none;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.eyebrow {
		margin: 14px 0 0;
		font-size: 13px;
		font-weight: 800;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--on-brand-2);
	}
	.main {
		padding: 16px;
		display: flex;
		flex-direction: column;
		gap: 14px;
		flex: 1;
	}
	.foot {
		padding: 0 16px 24px;
	}
	.app {
		margin: 4px 0 0;
		font-size: 13px;
		color: var(--ink-3);
	}
</style>

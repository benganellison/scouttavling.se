<script lang="ts">
	import type { Snippet } from 'svelte';
	import Flag from '#lib/ui/Flag.svelte';

	/** Phone-first shell for public and patrol-leader pages: forest header, centred column. */
	let { title, eyebrow = '', href = null, children, hero }: { title: string; eyebrow?: string; href?: string | null; children: Snippet; hero?: Snippet } = $props();
</script>

<div class="shell">
	<header class="top">
		<div class="inner">
			<div class="brand">
				<Flag size={26} onDark />
				{#if href}<a {href}>{title}</a>{:else}<span>{title}</span>{/if}
			</div>
			{#if eyebrow}<p class="eyebrow">{eyebrow}</p>{/if}
			{#if hero}{@render hero()}{/if}
		</div>
	</header>
	<main class="inner main">
		{@render children()}
	</main>
	<footer class="inner foot">
		<span>scouttavling.se</span>
	</footer>
</div>

<style>
	.shell {
		min-height: 100dvh;
		background: var(--ground);
		display: flex;
		flex-direction: column;
	}
	.top {
		background: var(--forest);
		color: #fff;
		padding: 16px 16px 22px;
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
		color: var(--on-forest-2);
	}
	.main {
		padding: 16px;
		display: flex;
		flex-direction: column;
		gap: 14px;
		flex: 1;
	}
	.foot {
		padding: 8px 16px 28px;
		font-size: 13px;
		color: var(--ink-3);
	}
</style>

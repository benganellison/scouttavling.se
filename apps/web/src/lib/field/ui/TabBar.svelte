<script lang="ts">
	import Icon from './Icon.svelte';
	import { useField } from '../app.svelte.ts';
	let { current }: { current: 'home' | 'log' | 'messages' } = $props();
	const app = useField();
	const base = $derived(`/f/${app.slug}`);
	const tel = $derived((app.pack?.competition.hqPhone ?? '').replace(/[^\d+]/g, ''));
</script>

<nav class="tabs" aria-label="Huvudmeny">
	<a href={base} aria-current={current === 'home' ? 'page' : undefined}><Icon name="flag" />Kontroll</a>
	<a href="{base}/log" aria-current={current === 'log' ? 'page' : undefined}><Icon name="list" />Logg</a>
	<a href="{base}/messages" aria-current={current === 'messages' ? 'page' : undefined}>
		<Icon name="chat" />Meddelanden
		{#if app.unreadCount}<span class="badge" aria-label="{app.unreadCount} olästa">{app.unreadCount}</span>{/if}
	</a>
	{#if tel}
		<a href="tel:{tel}"><Icon name="phone" />Ring HQ</a>
	{:else}
		<span class="disabled" aria-disabled="true"><Icon name="phone" />Ring HQ</span>
	{/if}
</nav>

<style>
	.tabs {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		border-top: 1px solid var(--line);
		background: var(--surface);
		padding: 4px 4px calc(8px + env(safe-area-inset-bottom));
		flex: none;
	}
	a,
	.disabled {
		position: relative;
		min-height: 60px;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 3px;
		color: var(--ink-2);
		font-size: 12px;
		font-weight: 700;
		text-decoration: none;
	}
	.disabled {
		opacity: 0.5;
	}
	a[aria-current='page'] {
		color: var(--forest);
		font-weight: 800;
	}
	.badge {
		position: absolute;
		top: 6px;
		right: calc(50% - 26px);
		min-width: 19px;
		height: 19px;
		padding: 0 5px;
		border-radius: 999px;
		background: var(--accent);
		color: #fff;
		font-size: 11px;
		font-weight: 800;
		display: flex;
		align-items: center;
		justify-content: center;
	}
</style>

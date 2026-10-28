<script lang="ts">
	import { page } from '$app/state';
	import Topbar from '#lib/ui/admin/Topbar.svelte';

	let { data, children } = $props();
	const here = (p: string) => (p === '/site-admin' ? page.url.pathname === p : page.url.pathname.startsWith(p));
</script>

<div class="page">
	<Topbar userName={data.admin.name} />
	<nav class="tabs" aria-label="Plattformsadmin">
		<span class="kicker">Plattformsadmin</span>
		<a href="/site-admin" aria-current={here('/site-admin') ? 'page' : undefined}>Sök</a>
		<a href="/site-admin/audit" aria-current={here('/site-admin/audit') ? 'page' : undefined}>Händelselogg</a>
		<a href="/admin">Mina tävlingar</a>
	</nav>
	{@render children()}
</div>

<style>
	.page {
		max-width: 1100px;
		margin: 0 auto;
		padding: 28px 24px 64px;
		display: flex;
		flex-direction: column;
		gap: 22px;
	}
	.tabs {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px 6px;
		border-bottom: 1px solid var(--line);
		padding-bottom: 8px;
	}
	.kicker {
		font-weight: 800;
		color: var(--brand);
		margin-right: 10px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		font-size: 13px;
	}
	.tabs a {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
		padding: 0 12px;
		border-radius: var(--r-sm);
		color: var(--ink-2);
		font-weight: 700;
		text-decoration: none;
	}
	.tabs a[aria-current='page'] {
		background: var(--brand);
		color: #fff;
	}
	@media (max-width: 600px) {
		.page {
			padding: 20px 16px 48px;
		}
	}
	:global(.sa-sec) {
		padding: 22px;
		display: flex;
		flex-direction: column;
		gap: 14px;
		border-radius: 20px;
	}
	:global(.sa-sec h2) {
		font-size: 22px;
		font-weight: 800;
		margin: 0;
	}
	:global(.sa-h1) {
		font-size: 32px;
		font-weight: 800;
		letter-spacing: -0.03em;
		margin: 0;
	}
</style>

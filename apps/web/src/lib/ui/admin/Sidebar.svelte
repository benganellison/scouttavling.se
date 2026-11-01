<script lang="ts">
	import ScouternaSymbol from '#lib/ui/brand/ScouternaSymbol.svelte';
	import ScouternaLogo from '#lib/ui/brand/ScouternaLogo.svelte';
	import EventLogo from '#lib/ui/brand/EventLogo.svelte';
	import type { BrandImage } from '#lib/brand/branding.ts';
	import { adminNav } from './format.ts';

	let {
		slug,
		name,
		dateText,
		pathname,
		search = '',
		userName,
		roleText,
		eventLogo = null
	}: {
		slug: string;
		name: string;
		dateText: string;
		pathname: string;
		search?: string;
		userName: string;
		roleText: string;
		eventLogo?: BrandImage | null;
	} = $props();

	const nav = $derived(adminNav(slug));

	/** Which nav key the current URL belongs to. */
	const activeKey = $derived.by(() => {
		const rest = pathname.replace(`/admin/${slug}`, '').split('/').filter(Boolean);
		const seg = rest[0] ?? '';
		if (pathname.startsWith(`/r/${slug}/ceremony`)) return 'ceremony';
		if (seg === 'invites' && new URLSearchParams(search).get('role') === 'startfinish') return 'invites?startfinish';
		if (seg === 'patrol' || seg === 'conflicts') return 'live';
		return seg;
	});

	const initials = $derived(
		userName
			.split(/\s+/)
			.filter(Boolean)
			.slice(0, 2)
			.map((p) => p[0]?.toUpperCase() ?? '')
			.join('')
	);
	const shortName = $derived.by(() => {
		const [first, last] = userName.split(/\s+/);
		return last ? `${first} ${last[0]}.` : first;
	});
</script>

<aside class="sidebar">
	<a class="brand" href="/admin/{slug}">
		{#if eventLogo}<EventLogo logo={eventLogo} height={36} onDark />{:else}<ScouternaSymbol size={30} onDark />{/if}
		<span class="brand-text">
			<span class="comp">{name}</span>
			<span class="date">{dateText}</span>
		</span>
	</a>

	<nav aria-label="Tävlingsmeny">
		{#each nav as g (g.group)}
			<div class="group">
				<span class="group-label" id="nav-{g.group}">{g.group}</span>
				<ul aria-labelledby="nav-{g.group}">
					{#each g.items as it (it.key)}
						<li>
							<a href={it.href} class:active={activeKey === it.key} aria-current={activeKey === it.key ? 'page' : undefined}>{it.label}</a>
						</li>
					{/each}
				</ul>
			</div>
		{/each}
	</nav>

	<div class="foot">
		<a class="all" href="/admin">
			<svg
				width="16"
				height="16"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2.2"
				stroke-linecap="round"
				stroke-linejoin="round"
				aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg
			>
			Alla tävlingar
		</a>
		<div class="me">
			<span class="avatar" aria-hidden="true">{initials}</span>
			<span class="who">
				<span class="who-name">{shortName}</span>
				<span class="who-role">{roleText}</span>
			</span>
		</div>
		<form method="POST" action="/auth/logout">
			<button class="logout" type="submit">Logga ut</button>
		</form>
		<div class="sender"><ScouternaLogo onDark /></div>
	</div>
</aside>

<style>
	.sidebar {
		flex: 1 1 288px;
		max-width: 100%;
		background: var(--brand);
		color: #fff;
		padding: 22px 14px;
		display: flex;
		flex-direction: column;
		gap: 20px;
	}
	@media (min-width: 821px) {
		.sidebar {
			flex: 0 0 288px;
			position: sticky;
			top: 0;
			height: 100dvh;
			overflow-y: auto;
		}
	}
	.brand {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 0 8px;
		color: #fff;
		text-decoration: none;
	}
	.brand-text {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.comp {
		font-weight: 800;
		font-size: 16px;
		line-height: 1.2;
		overflow-wrap: anywhere;
	}
	.date {
		font-size: 12px;
		color: var(--on-brand-2);
	}
	nav {
		display: flex;
		flex-direction: column;
		gap: 18px;
	}
	.group-label {
		display: block;
		font-size: 11px;
		font-weight: 800;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--on-brand-2);
		padding: 0 12px 6px;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	ul a {
		display: flex;
		align-items: center;
		min-height: 40px;
		padding: 0 12px;
		border-radius: var(--r-sm);
		text-decoration: none;
		font-size: 15px;
		font-weight: 600;
		color: var(--on-brand);
	}
	ul a:hover {
		background: var(--brand-2);
		color: #fff;
		text-decoration: underline;
	}
	ul a.active {
		background: var(--ground);
		color: var(--brand);
		font-weight: 800;
	}
	.foot {
		margin-top: auto;
		display: flex;
		flex-direction: column;
		gap: 10px;
		border-top: 1px solid var(--line-on-brand);
		padding-top: 12px;
	}
	.all {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		color: var(--on-brand);
		font-size: 14px;
		font-weight: 700;
		text-decoration: none;
		padding: 6px 8px;
		min-height: 40px;
		border-radius: var(--r-sm);
	}
	.all:hover {
		color: #fff;
		background: var(--brand-2);
	}
	.me {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 4px 8px;
	}
	.avatar {
		width: 34px;
		height: 34px;
		border-radius: 50%;
		background: #fff;
		color: var(--brand);
		display: flex;
		align-items: center;
		justify-content: center;
		font-weight: 800;
		font-size: 14px;
		flex: none;
	}
	.who {
		display: flex;
		flex-direction: column;
	}
	.who-name {
		font-weight: 700;
		font-size: 14px;
	}
	.who-role {
		font-size: 12px;
		color: var(--on-brand-2);
	}
	.logout {
		width: 100%;
		min-height: 44px;
		border-radius: var(--r-sm);
		border: 1.5px solid var(--line-on-brand);
		background: transparent;
		color: #fff;
		font-weight: 800;
		cursor: pointer;
	}
	.logout:hover {
		background: var(--brand-2);
	}
	.sender {
		display: flex;
		justify-content: center;
		margin: 0 -14px -22px;
	}
	@media (max-width: 820px) {
		nav {
			flex-direction: row;
			flex-wrap: wrap;
			gap: 12px 20px;
		}
		.group {
			flex: 1 1 100%;
		}
		ul {
			flex-direction: row;
			flex-wrap: wrap;
			gap: 4px;
		}
		ul a {
			min-height: 40px;
			font-size: 14px;
			box-shadow: inset 0 0 0 1px var(--line-on-brand);
		}
		.foot {
			flex-direction: row;
			flex-wrap: wrap;
			align-items: center;
			justify-content: space-between;
		}
		.foot form {
			flex: 0 0 auto;
		}
		.logout {
			padding: 0 16px;
		}
	}
</style>

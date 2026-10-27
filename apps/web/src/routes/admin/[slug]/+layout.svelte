<script lang="ts">
	import { page } from '$app/state';
	import Sidebar from '#lib/ui/admin/Sidebar.svelte';
	import { dateRange } from '#lib/ui/admin/format.ts';

	let { data, children } = $props();

	const ROLE_TEXT: Record<string, string> = { owner: 'Tävlingsledare', organiser: 'Arrangör', hq: 'Ledningscentral', startfinish: 'Start & mål' };
	const fmtTime = (d: Date | string) => new Date(d).toLocaleTimeString('sv-SE', { timeStyle: 'short', timeZone: 'Europe/Stockholm' });
	const fmtDateTime = (d: Date | string) => new Date(d).toLocaleString('sv-SE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Stockholm' });
	const roleText = $derived(data.access ? 'Plattformsadmin (tillfällig)' : ROLE_TEXT[data.roles.includes('owner') ? 'owner' : (data.roles[0] ?? 'organiser')] ?? 'Arrangör');
</script>

<a class="skip-link" href="#innehall">Hoppa till innehållet</a>
<div class="shell">
	<Sidebar
		slug={data.competition.slug}
		name={data.competition.name}
		dateText={dateRange(data.competition.startDate, data.competition.endDate)}
		pathname={page.url.pathname}
		search={page.url.search}
		userName={data.user.name}
		{roleText}
		eventLogo={data.branding.eventLogo}
	/>
	<main class="content" id="innehall" tabindex="-1">
		{#if data.access}
			<div class="banner banner-admin" role="status" data-testid="access-banner">
				<strong>Tillfällig åtkomst som plattformsadmin</strong>
				<span>Du har arrangörsbehörighet till {fmtTime(data.access.expiresAt)}. Anledning: {data.access.reason}. Ägarna ser att du har åtkomst.</span>
				<a href="/site-admin/c/{data.competition.slug}">Avsluta eller förläng</a>
			</div>
		{/if}
		{#each data.notices as n (n.id)}
			<div class="banner" role="note" data-testid="access-notice">
				<strong>Plattformsadmin {n.adminName} {n.active ? 'har' : 'hade'} åtkomst till tävlingen</strong>
				<span>{fmtDateTime(n.grantedAt)}–{fmtTime(n.until)} · Anledning: {n.reason}</span>
				<a href="/admin/{data.competition.slug}/settings#logg">Händelselogg</a>
			</div>
		{/each}
		{#if data.suspended}
			<div class="banner banner-bad" role="alert" data-testid="suspended-banner">
				<strong>Tävlingen är tillfälligt avstängd</strong>
				<span>Plattformsadministratören har stängt av tävlingen. Du kan se allt men inte ändra något, och funktionärernas telefoner synkar inte. Kontakta info@scouttavling.se.</span>
			</div>
		{/if}
		{@render children()}
	</main>
</div>

<style>
	.shell {
		min-height: 100dvh;
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
	}
	/* The sidebar is sticky at viewport height; paint its colour down the whole
	   page too so full-page captures and prints don't show a cut-off sidebar. */
	@media (min-width: 821px) {
		.shell {
			background: linear-gradient(to right, var(--brand) 288px, var(--ground) 288px);
		}
	}
	.content {
		flex: 999 1 560px;
		min-width: 0;
		padding: 28px 32px 56px;
		display: flex;
		flex-direction: column;
		gap: 22px;
	}
	@media (min-width: 821px) {
		.shell {
			background: linear-gradient(to right, var(--brand) 288px, var(--ground) 288px);
		}
	}
	.banner {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 12px;
		align-items: baseline;
		background: var(--surface);
		border: 1px solid var(--line-strong);
		border-left: 6px solid var(--orange);
		border-radius: var(--r-md);
		padding: 12px 16px;
		max-width: 860px;
	}
	.banner strong {
		flex-basis: 100%;
	}
	.banner-admin {
		border-left-color: var(--brand);
	}
	.banner-bad {
		border-left-color: var(--danger);
		background: var(--danger-tint);
	}
	@media (max-width: 600px) {
		.content {
			padding: 20px 16px 48px;
		}
	}
</style>

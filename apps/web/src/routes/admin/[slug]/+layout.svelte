<script lang="ts">
	import { page } from '$app/state';
	import Sidebar from '#lib/ui/admin/Sidebar.svelte';
	import { dateRange } from '#lib/ui/admin/format.ts';

	let { data, children } = $props();

	const ROLE_TEXT: Record<string, string> = { owner: 'Tävlingsledare', organiser: 'Arrangör', hq: 'Ledningscentral', startfinish: 'Start & mål' };
	const roleText = $derived(ROLE_TEXT[data.roles.includes('owner') ? 'owner' : (data.roles[0] ?? 'organiser')] ?? 'Arrangör');
</script>

<div class="shell">
	<Sidebar
		slug={data.competition.slug}
		name={data.competition.name}
		dateText={dateRange(data.competition.startDate, data.competition.endDate)}
		pathname={page.url.pathname}
		search={page.url.search}
		userName={data.user.name}
		{roleText}
	/>
	<main class="content">
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
			background: linear-gradient(to right, var(--forest) 232px, var(--ground) 232px);
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
			background: linear-gradient(to right, var(--forest) 232px, var(--ground) 232px);
		}
	}
	@media (max-width: 600px) {
		.content {
			padding: 20px 16px 48px;
		}
	}
</style>

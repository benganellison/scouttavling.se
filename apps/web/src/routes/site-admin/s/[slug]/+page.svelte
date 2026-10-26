<script lang="ts">
	import MembersPanel from '#lib/ui/admin/MembersPanel.svelte';
	import AuditList from '#lib/ui/admin/AuditList.svelte';
	import StatusPill from '#lib/ui/admin/StatusPill.svelte';

	let { data, form } = $props();
</script>

<svelte:head><title>{data.series.name} · Plattformsadmin</title></svelte:head>

<a class="back" href="/site-admin">Sök</a>
<h1 class="sa-h1">{data.series.name}</h1>
<p class="muted">Tävlingsserie · <a href="/t/{data.series.slug}">/t/{data.series.slug}</a>{data.series.ownerGroupName ? ` · ${data.series.ownerGroupName}` : ''}</p>

<section class="card sa-sec" aria-labelledby="h-members">
	<h2 id="h-members">Seriens ägare och arrangörer</h2>
	<MembersPanel members={data.members} meId={data.admin.id} power="platform" {form} scopeText="serien" lead="Gäller serien (utseende, klassfärger, arkiv). Varje års ägare ändras på tävlingens sida." />
</section>

<section class="card sa-sec" aria-labelledby="h-eds">
	<h2 id="h-eds">År</h2>
	<ul class="rows">
		{#each data.editions as e (e.id)}
			<li>
				<a href="/site-admin/c/{e.slug}"><strong>{e.name}</strong></a>
				<StatusPill status={e.status as 'draft' | 'live' | 'closed'} />
				{#if e.suspended}<span class="pill pill-bad">Avstängd</span>{/if}
				<span class="muted small">Ägare: {e.owners.join(', ') || 'ingen'} · {e.patrols} patruller</span>
			</li>
		{/each}
	</ul>
</section>

<section class="card sa-sec" aria-labelledby="h-log">
	<h2 id="h-log">Händelselogg</h2>
	<AuditList rows={data.audit} />
</section>

<style>
	.back {
		font-weight: 700;
	}
	.rows {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.rows li {
		display: flex;
		flex-wrap: wrap;
		gap: 6px 12px;
		align-items: center;
		padding: 10px 0;
		border-top: 1px solid var(--line);
	}
	.small {
		font-size: 13px;
	}
	section {
		max-width: 860px;
	}
</style>

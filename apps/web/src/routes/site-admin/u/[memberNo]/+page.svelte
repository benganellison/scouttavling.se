<script lang="ts">
	import { enhance } from '$app/forms';
	import AuditList from '#lib/ui/admin/AuditList.svelte';

	let { data, form } = $props();
	const p = $derived(data.person);
	const ROLE: Record<string, string> = { owner: 'Ägare', organiser: 'Arrangör', hq: 'Ledningscentral', startfinish: 'Start & mål' };
	const dt = (d: Date | string | null) =>
		d ? new Date(d).toLocaleString('sv-SE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Stockholm' }) : '–';
</script>

<svelte:head><title>{p.name} · Plattformsadmin</title></svelte:head>

<a class="back" href="/site-admin">Sök</a>
<h1 class="sa-h1">{p.name}</h1>
<div class="pills">
	{#if p.suspendedAt}<span class="pill pill-bad">Avstängd</span>{/if}
	{#if data.isSiteAdmin}<span class="pill">Plattformsadmin</span>{/if}
</div>
<p class="muted">Medlemsnr {p.memberNo} · första inloggning {dt(p.createdAt)} · senast {dt(p.lastLogin)}</p>

<section class="card sa-sec" aria-labelledby="h-comps">
	<h2 id="h-comps">Tävlingar</h2>
	{#if data.comps.length === 0}<p class="muted">Inga.</p>{/if}
	<ul class="rows">
		{#each data.comps as c (c.slug + c.role)}
			<li><a href="/site-admin/c/{c.slug}">{c.name}</a><span class="pill">{ROLE[c.role] ?? c.role}</span></li>
		{/each}
	</ul>
</section>

<section class="card sa-sec" aria-labelledby="h-susp">
	<h2 id="h-susp">{p.suspendedAt ? 'Användaren är avstängd' : 'Stäng av användaren'}</h2>
	<p class="muted">
		{p.suspendedAt
			? `Avstängd sedan ${dt(p.suspendedAt)}. Hen kan inte logga in.`
			: 'En avstängd användare loggas ut direkt och kan inte logga in. Rollerna i tävlingarna finns kvar.'}
	</p>
	<form method="POST" action="?/suspend" class="stack" use:enhance>
		<input type="hidden" name="suspend" value={p.suspendedAt ? '0' : '1'} />
		<div class="field">
			<label for="u-reason">Anledning (krävs, minst 10 tecken)</label>
			<textarea id="u-reason" name="reason" rows="2"></textarea>
			<span class="muted small">Sparas i händelseloggen. Skriv inte namn på patrullmedlemmar.</span>
		</div>
		<div><button class="btn btn-primary">{p.suspendedAt ? 'Öppna användaren igen' : 'Stäng av användaren'}</button></div>
	</form>
	{#if form?.error}<p class="error-text" role="alert">{form.error}</p>{/if}
	{#if form?.ok}<p class="pill pill-ok" role="status">{form.message}</p>{/if}
</section>

<section class="card sa-sec" aria-labelledby="h-log">
	<h2 id="h-log">Vad användaren har gjort (händelselogg)</h2>
	<AuditList rows={data.audit} showTarget siteLinks />
</section>

<style>
	.back {
		font-weight: 700;
	}
	.pills {
		display: flex;
		gap: 6px;
	}
	.rows {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.rows li {
		display: flex;
		gap: 10px;
		align-items: center;
		padding: 10px 0;
		border-top: 1px solid var(--line);
		flex-wrap: wrap;
	}
	.small {
		font-size: 13px;
	}
	textarea {
		min-height: 64px;
	}
	section {
		max-width: 860px;
	}
</style>

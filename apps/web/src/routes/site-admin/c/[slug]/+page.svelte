<script lang="ts">
	import { enhance } from '$app/forms';
	import StatusPill from '#lib/ui/admin/StatusPill.svelte';
	import MembersPanel from '#lib/ui/admin/MembersPanel.svelte';
	import AuditList from '#lib/ui/admin/AuditList.svelte';

	let { data, form } = $props();
	const c = $derived(data.comp);
	const res = (section: string) =>
		form && 'section' in form && form.section === section ? (form as { ok?: boolean; message?: string; error?: string }) : null;
	const dt = (d: Date | string | null) =>
		d ? new Date(d).toLocaleString('sv-SE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Stockholm' }) : '–';
	const time = (d: Date | string) => new Date(d).toLocaleTimeString('sv-SE', { timeStyle: 'short', timeZone: 'Europe/Stockholm' });
	const HINT = 'Sparas i händelseloggen och visas för ägarna. Skriv inte namn på patrullmedlemmar.';
</script>

<svelte:head><title>{c.name} · Plattformsadmin</title></svelte:head>

<header class="head">
	<a class="back" href="/site-admin">Sök</a>
	<h1 class="sa-h1">{c.name}</h1>
	<div class="pills">
		<StatusPill status={c.status as 'draft' | 'live' | 'closed'} />
		{#if c.suspended}<span class="pill pill-bad" data-testid="suspended-pill">Avstängd</span>{/if}
		{#if c.anonymised}<span class="pill">Personuppgifter borttagna</span>{/if}
	</div>
	<dl class="facts">
		<div>
			<dt>Adress</dt>
			<dd><a href="/t/{c.slug}">/t/{c.slug}</a></dd>
		</div>
		<div>
			<dt>Serie</dt>
			<dd>
				{#if data.series}<a href="/site-admin/s/{data.series.slug}">{data.series.name}</a>{:else}Fristående{/if}
			</dd>
		</div>
		<div>
			<dt>Kår/distrikt</dt>
			<dd>{c.ownerGroupName ?? '–'}</dd>
		</div>
		<div>
			<dt>Patruller</dt>
			<dd>{c.patrols}</dd>
		</div>
		<div>
			<dt>Senast aktiv</dt>
			<dd>{dt(c.lastActivity)}</dd>
		</div>
		<div>
			<dt>Personuppgifter kvar</dt>
			<dd>{c.anonymised ? 'Nej' : `${data.personalDataLeft} patruller`}</dd>
		</div>
	</dl>
</header>

<section class="card sa-sec" aria-labelledby="h-access" data-testid="access-section">
	<h2 id="h-access">Tillfällig åtkomst</h2>
	<p class="muted">
		Du ser inte tävlingens administrationssidor automatiskt. Ta tillfällig åtkomst som arrangör när du behöver hjälpa ägarna. Den loggas, ägarna ser den med din
		anledning, och den upphör av sig själv.
	</p>
	{#if data.access}
		<div class="active" role="status">
			<strong>Du har åtkomst till {time(data.access.expiresAt)}.</strong>
			<span class="muted">Anledning: {data.access.reason}</span>
			<div class="row-form">
				<a class="btn btn-primary" href="/admin/{c.slug}">Öppna tävlingen</a>
				<form method="POST" action="?/endAccess" use:enhance>
					<input type="hidden" name="id" value={data.access.id} />
					<button class="btn btn-ghost">Avsluta åtkomsten nu</button>
				</form>
			</div>
		</div>
	{:else}
		<form method="POST" action="?/access" class="stack" use:enhance>
			<div class="field">
				<label for="acc-reason">Anledning (krävs, minst 10 tecken)</label>
				<textarea id="acc-reason" name="reason" rows="2" aria-describedby="acc-help" placeholder="t.ex. Ägaren bad om hjälp med kontrollerna (mejl 25/10)"
				></textarea>
				<span id="acc-help" class="muted small">{HINT}</span>
			</div>
			<div class="row-form">
				<div class="field">
					<label for="acc-hours">Hur länge</label>
					<select id="acc-hours" name="hours">
						{#each data.hours as h (h)}<option value={h} selected={h === data.defaultHours}>{h} {h === 1 ? 'timme' : 'timmar'}</option>{/each}
					</select>
				</div>
				<button class="btn btn-accent">Ta tillfällig åtkomst</button>
			</div>
		</form>
	{/if}
	{#if res('access')?.error}<p class="error-text" role="alert">{res('access')?.error}</p>{/if}
	{#if data.notices.length}
		<details>
			<summary>Tidigare åtkomst (30 dagar): {data.notices.length}</summary>
			<ul class="plain">
				{#each data.notices as n (n.id)}<li>{n.adminName}: {dt(n.grantedAt)}–{time(n.until)} · {n.reason}</li>{/each}
			</ul>
		</details>
	{/if}
</section>

<section class="card sa-sec" aria-labelledby="h-members">
	<h2 id="h-members">Ägare och arrangörer</h2>
	<MembersPanel
		members={data.members}
		meId={data.admin.id}
		power="platform"
		{form}
		lead="Lägg till, ändra eller ta bort ägare, t.ex. när ägaren har slutat. Tävlingen har alltid minst en ägare."
	/>
</section>

<section class="card sa-sec" aria-labelledby="h-susp">
	<h2 id="h-susp">{c.suspended ? 'Tävlingen är avstängd' : 'Stäng av tävlingen'}</h2>
	<p class="muted">
		{c.suspended
			? `Avstängd sedan ${dt(c.suspendedAt)}. Publika sidor visar "Tävlingen är tillfälligt avstängd", funktionärernas telefoner synkar inte och ingen kan ändra något.`
			: 'Publika sidor visar "Tävlingen är tillfälligt avstängd", funktionärernas telefoner kan inte synka (deras poäng ligger kvar i telefonen) och arrangörerna kan bara titta.'}
	</p>
	<form method="POST" action="?/suspend" class="stack" use:enhance>
		<input type="hidden" name="suspend" value={c.suspended ? '0' : '1'} />
		<div class="field">
			<label for="susp-reason">Anledning (krävs, minst 10 tecken)</label>
			<textarea id="susp-reason" name="reason" rows="2" aria-describedby="susp-help"></textarea>
			<span id="susp-help" class="muted small">{HINT}</span>
		</div>
		<div class="row-form">
			<button class="btn {c.suspended ? 'btn-primary' : 'btn-primary danger-bg'}">{c.suspended ? 'Öppna tävlingen igen' : 'Stäng av tävlingen'}</button>
		</div>
	</form>
	{#if res('suspend')?.error}<p class="error-text" role="alert">{res('suspend')?.error}</p>{/if}
	{#if res('suspend')?.ok}<p class="pill pill-ok msg" role="status">{res('suspend')?.message}</p>{/if}
</section>

<section class="card sa-sec" aria-labelledby="h-pd">
	<h2 id="h-pd">Ta bort personuppgifter åt ägarna</h2>
	{#if c.anonymised}
		<p class="muted">Personuppgifterna togs bort {dt(c.anonymisedAt)}.</p>
	{:else if c.status !== 'closed'}
		<p class="muted">Går bara när tävlingen är avslutad. Be ägaren avsluta den först.</p>
	{:else}
		<p class="muted">
			Samma borttagning som ägarna gör (t.ex. en begäran som distriktet skickat vidare). Namn, kontaktuppgifter, funktionärer och meddelanden tas bort;
			resultaten finns kvar. Det går inte att ångra, och uppgifterna försvinner ur säkerhetskopiorna först när de roteras bort (högst cirka 8 veckor).
		</p>
		<form method="POST" action="?/anonymise" class="stack" use:enhance>
			<div class="field">
				<label for="pd-reason">Anledning (krävs, minst 10 tecken)</label>
				<textarea id="pd-reason" name="reason" rows="2" aria-describedby="pd-help" placeholder="t.ex. Begäran från Göteborgs scoutdistrikt, ärende 2026-14"
				></textarea>
				<span id="pd-help" class="muted small">{HINT} Loggen behåller bara id:n och anledningen.</span>
			</div>
			<div class="field">
				<label for="pd-confirm">Skriv tävlingens namn för att bekräfta: <strong>{c.name}</strong></label>
				<input id="pd-confirm" name="confirm" autocomplete="off" />
			</div>
			<div class="row-form"><button class="btn btn-primary danger-bg">Ta bort personuppgifter</button></div>
		</form>
	{/if}
	{#if res('anonymise')?.error}<p class="error-text" role="alert">{res('anonymise')?.error}</p>{/if}
	{#if res('anonymise')?.ok}<p class="pill pill-ok msg" role="status">{res('anonymise')?.message}</p>{/if}
</section>

<section class="card sa-sec" aria-labelledby="h-log">
	<h2 id="h-log">Händelselogg</h2>
	<AuditList rows={data.audit} />
</section>

<style>
	.head {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.back {
		font-weight: 700;
	}
	.pills {
		display: flex;
		gap: 6px;
		flex-wrap: wrap;
	}
	.facts {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 170px), 1fr));
		gap: 10px 18px;
		margin: 6px 0 0;
	}
	dt {
		font-size: 12px;
		color: var(--ink-3);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	dd {
		margin: 0;
		overflow-wrap: anywhere;
	}
	.row-form {
		display: flex;
		gap: 10px;
		align-items: flex-end;
		flex-wrap: wrap;
	}
	.active {
		background: var(--tint);
		border-radius: var(--r-md);
		padding: 14px 16px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.small {
		font-size: 13px;
	}
	.danger-bg {
		background: var(--danger);
		border-color: var(--danger);
	}
	.msg {
		align-self: flex-start;
		margin: 0;
	}
	.plain {
		margin: 8px 0 0;
		padding-left: 18px;
	}
	textarea {
		min-height: 64px;
	}
	section {
		max-width: 860px;
	}
</style>

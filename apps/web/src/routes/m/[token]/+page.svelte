<script lang="ts">
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import PublicShell from '#lib/ui/public/PublicShell.svelte';
	import TrackChip from '#lib/ui/brand/TrackChip.svelte';
	import MembersEditor from '#lib/ui/public/MembersEditor.svelte';
	import CopyLink from '#lib/ui/public/CopyLink.svelte';
	import StatusPill from '#lib/ui/patrols/StatusPill.svelte';
	import { dateRange } from '#lib/ui/admin/format.ts';
	import type { FormErrors, RawRegistration } from '#lib/registration/rules.ts';

	let { data, form } = $props();
	const p = $derived(data.patrol);

	// Form state is seeded once from the server data; the page owns it afterwards.
	const seed = untrack(() => {
		const init = (form && 'values' in form ? form.values : null) as RawRegistration | null;
		return {
			members: init?.members.length ? init.members : data.members.length ? data.members.map((m) => ({ ...m })) : [{ firstName: '', lastName: '' }],
			contactName: init?.contactName ?? data.patrol.contactName,
			contactPhone: init?.contactPhone ?? data.patrol.contactPhone,
			contactEmail: init?.contactEmail ?? data.patrol.contactEmail
		};
	});
	let members = $state(seed.members);
	let contactName = $state(seed.contactName);
	let contactPhone = $state(seed.contactPhone);
	let contactEmail = $state(seed.contactEmail);
	let saving = $state(false);
	const errors = $derived((form && 'errors' in form ? form.errors : {}) as FormErrors);
	const saved = $derived(Boolean(form && 'saved' in form && form.saved));
</script>

<svelte:head>
	<title>Patrullpass {p.number} · {data.comp.name}</title>
	<meta name="robots" content="noindex, nofollow" />
	<meta name="referrer" content="no-referrer" />
</svelte:head>

<PublicShell title={data.comp.name} eyebrow="Patrullpass" branding={data.branding}>
	{#if data.comp.status === 'closed'}
		<p class="note" role="note">Tävlingen är avslutad. Tack för att ni var med!</p>
	{/if}

	<article class="pass" aria-labelledby="h-pass" data-testid="patrol-pass">
		<div class="pass-top">
			<span class="pass-comp">{data.comp.name} · {dateRange(data.comp.startDate, data.comp.endDate)}</span>
			<div class="pass-head">
				<span class="pass-nr" aria-label="Patrullnummer">{p.number}</span>
				<div class="pass-name">
					<h1 id="h-pass">{p.name}</h1>
					<span>{p.troop}</span>
				</div>
			</div>
		</div>
		<div class="pass-body">
			<dl>
				<div><dt>Klass</dt><dd class="trk">{#if p.track}<TrackChip color={data.trackColor} />{/if}{p.track || '–'}</dd></div>
				<div><dt>Startkontroll</dt><dd>{p.start ?? 'Delas ut före start'}</dd></div>
				<div><dt>Status</dt><dd><StatusPill status={p.status} /></dd></div>
			</dl>
			<figure class="qr" data-testid="patrol-qr">
				<!-- eslint-disable-next-line svelte/no-at-html-tags -- server-generated SVG from qrcode -->
				{@html data.qr}
				<figcaption>Visa koden på kontrollerna</figcaption>
			</figure>
		</div>
	</article>

	<section class="card bookmark" aria-labelledby="h-bm">
		<h2 id="h-bm">Spara den här sidan</h2>
		<p>Bokmärk sidan eller lägg den på hemskärmen. Länken är personlig – dela den bara med andra ledare i patrullen.</p>
	</section>

	{#if data.followUrl}
		<section class="card stack-s" aria-labelledby="h-follow">
			<h2 id="h-follow">Följ patrullen</h2>
			<p class="muted">Dela med föräldrar och ledare. Visar var patrullen är och hur det går under dagen, men inga namn på scouterna eller kontaktuppgifter.</p>
			<CopyLink url={data.followUrl} label="Följ-länk" testid="follow-link" />
		</section>
	{/if}

	{#if data.canEdit}
		<form
			method="POST"
			action="?/save"
			class="card stack-s"
			novalidate
			use:enhance={() => {
				saving = true;
				return async ({ update }) => {
					saving = false;
					await update({ reset: false });
				};
			}}
		>
			<h2>Scouter</h2>
			<p class="muted">Ändra fram till att anmälan stänger {data.closesText}.</p>
			<MembersEditor bind:members {errors} />
			<h2 class="mt">Kontaktperson</h2>
			<div class="field">
				<label for="contactName">Namn</label>
				<input id="contactName" name="contactName" bind:value={contactName} autocomplete="name" aria-invalid={errors.contactName ? 'true' : undefined} />
				{#if errors.contactName}<span class="error-text">{errors.contactName}</span>{/if}
			</div>
			<div class="field">
				<label for="contactPhone">Mobilnummer</label>
				<input id="contactPhone" name="contactPhone" type="tel" inputmode="tel" bind:value={contactPhone} autocomplete="tel" aria-invalid={errors.contactPhone ? 'true' : undefined} />
				{#if errors.contactPhone}<span class="error-text">{errors.contactPhone}</span>{/if}
			</div>
			<div class="field">
				<label for="contactEmail">E-post</label>
				<input id="contactEmail" name="contactEmail" type="email" inputmode="email" bind:value={contactEmail} autocomplete="email" aria-invalid={errors.contactEmail ? 'true' : undefined} />
				{#if errors.contactEmail}<span class="error-text">{errors.contactEmail}</span>{/if}
			</div>
			{#if errors.form}<p class="error-text" role="alert">{errors.form}</p>{/if}
			<div class="act">
				<button class="btn btn-primary save" disabled={saving}>{saving ? 'Sparar…' : 'Spara ändringar'}</button>
				{#if saved}<span class="pill pill-ok" role="status">Sparat</span>{/if}
			</div>
		</form>
	{:else}
		<section class="card stack-s" aria-labelledby="h-members">
			<h2 id="h-members">Scouter</h2>
			<ol class="ro">
				{#each data.members as m, i (i)}<li>{m.firstName} {m.lastName}</li>{/each}
			</ol>
			<h2 class="mt">Kontaktperson</h2>
			<p>{p.contactName}<br /><span class="muted">{p.contactPhone} · {p.contactEmail}</span></p>
			{#if data.comp.status !== 'closed'}
				<p class="muted small" data-testid="edit-closed">Anmälan är stängd. Kontakta arrangören{data.comp.hqPhone ? ` (${data.comp.hqPhone})` : ''} om något behöver ändras.</p>
			{/if}
		</section>
	{/if}
</PublicShell>

<style>
	.note {
		margin: 0;
		background: var(--ok-tint);
		border-radius: var(--r-md);
		padding: 12px 14px;
		font-weight: 700;
		color: var(--brand);
	}
	.pass {
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: var(--r-xl);
		overflow: hidden;
		box-shadow: 0 8px 28px rgb(15 31 23 / 10%);
	}
	.pass-top {
		background: var(--brand);
		color: #fff;
		padding: 16px 18px;
		display: flex;
		flex-direction: column;
		gap: 10px;
		border-bottom: 6px solid var(--event-stripe, var(--orange));
	}
	.trk {
		display: inline-flex;
		align-items: center;
		gap: 8px;
	}
	.pass-comp {
		font-size: 13px;
		font-weight: 800;
		color: var(--on-brand);
	}
	.pass-head {
		display: flex;
		align-items: center;
		gap: 14px;
	}
	.pass-nr {
		flex: none;
		font-family: var(--font-display);
		font-weight: 800;
		font-size: 44px;
		line-height: 1;
		background: #fff;
		color: var(--ink);
		border-radius: var(--r-md);
		padding: 8px 12px;
	}
	.pass-name {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.pass-name h1 {
		font-size: 28px;
		font-weight: 800;
		overflow-wrap: anywhere;
	}
	.pass-name span {
		color: var(--on-brand);
		font-weight: 700;
	}
	.pass-body {
		padding: 16px 18px 18px;
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
	dl {
		margin: 0;
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 12px;
	}
	dl div:last-child {
		grid-column: 1 / -1;
	}
	dt {
		font-size: 12px;
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--ink-3);
	}
	dd {
		margin: 2px 0 0;
		font-weight: 800;
		font-size: 17px;
	}
	.qr {
		margin: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 6px;
	}
	.qr :global(svg) {
		width: min(240px, 70vw);
		height: auto;
		display: block;
	}
	figcaption {
		font-size: 14px;
		color: var(--ink-2);
		font-weight: 700;
	}
	.bookmark {
		border: 2px solid var(--orange);
		background: var(--warn-tint);
	}
	.bookmark p {
		margin: 6px 0 0;
	}
	h2 {
		font-size: 20px;
		font-weight: 800;
	}
	.mt {
		margin-top: 8px;
	}
	.stack-s {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.stack-s p {
		margin: 0;
	}
	.act {
		display: flex;
		align-items: center;
		gap: 12px;
	}
	.save {
		min-height: 56px;
		flex: 1;
	}
	.ro {
		margin: 0;
		padding-left: 22px;
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-weight: 700;
	}
	.small {
		font-size: 14px;
	}
	[aria-invalid='true'] {
		border-color: var(--danger);
	}
</style>

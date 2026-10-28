<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import PublicShell from '#lib/ui/public/PublicShell.svelte';
	import TrackChip from '#lib/ui/brand/TrackChip.svelte';
	import MembersEditor from '#lib/ui/public/MembersEditor.svelte';
	import CopyLink from '#lib/ui/public/CopyLink.svelte';
	import { stepOf, validateRegistration, type FormErrors, type RawRegistration } from '#lib/registration/rules.ts';

	let { data, form } = $props();

	// Initial values only (after a no-JS failed post); the wizard owns the state afterwards.
	const init = untrack(() => (form && 'values' in form ? form.values : null) as RawRegistration | null);
	let patrolName = $state(init?.patrolName ?? '');
	let troop = $state(init?.troop ?? '');
	let trackId = $state(init?.trackId ?? '');
	let members = $state(
		init?.members.length
			? init.members
			: [
					{ firstName: '', lastName: '' },
					{ firstName: '', lastName: '' },
					{ firstName: '', lastName: '' }
				]
	);
	let contactName = $state(init?.contactName ?? '');
	let contactPhone = $state(init?.contactPhone ?? '');
	let contactEmail = $state(init?.contactEmail ?? '');

	let step = $state<1 | 2 | 3>(1);
	let js = $state(false);
	let sending = $state(false);
	let clientErrors = $state<FormErrors>({});
	const serverErrors = $derived((form && 'errors' in form ? form.errors : {}) as FormErrors);
	let showServer = $state(true);
	const errors = $derived<FormErrors>(showServer ? { ...serverErrors, ...clientErrors } : { form: serverErrors.form, ...clientErrors });
	const done = $derived(form && 'done' in form ? form.done : null);
	const open = $derived(data.window.state === 'open');
	const STEPS = ['Patrullen', 'Scouterna', 'Kontaktperson'];

	onMount(() => {
		js = true;
		const first = Object.keys(serverErrors).find((k) => k !== 'form');
		if (first) step = stepOf(first);
	});

	function compact() {
		const rows = members.filter((m) => m.firstName.trim() || m.lastName.trim());
		members = rows.length ? rows : [{ firstName: '', lastName: '' }];
	}

	function check(upTo: 1 | 2 | 3, quiet = false): boolean {
		// Blank rows are ignored; errors are mapped back to the row the user sees.
		const rowOf = members.flatMap((m, i) => (m.firstName.trim() || m.lastName.trim() ? [i] : []));
		const raw: RawRegistration = { patrolName, troop, trackId, contactName, contactPhone, contactEmail, members: rowOf.map((i) => members[i]) };
		const r = validateRegistration(
			raw,
			data.tracks.map((t) => t.id)
		);
		const errs: FormErrors = {};
		if (!r.ok)
			for (const [k, msg] of Object.entries(r.errors)) {
				if (stepOf(k) > upTo) continue;
				errs[k.replace(/^member_(\d+)_/, (_, n) => `member_${rowOf[Number(n)]}_`)] = msg;
			}
		clientErrors = errs;
		const first = Object.keys(errs)[0];
		if (first && !quiet) {
			step = stepOf(first);
			void focusFirstError();
			return false;
		}
		return !first;
	}

	/** Once errors are showing, re-check as the user types so fixed fields clear (no jumping). */
	function recheck() {
		if (Object.keys(clientErrors).length || Object.keys(serverErrors).length) {
			showServer = false;
			check(step, true);
		}
	}

	async function focusFirstError() {
		await tick();
		document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
	}

	async function next() {
		if (!check(step)) return;
		if (step === 2) compact();
		step = (step + 1) as 2 | 3;
		await tick();
		document.getElementById('step-title')?.focus();
	}
	async function back() {
		clientErrors = {};
		step = (step - 1) as 1 | 2;
		await tick();
		document.getElementById('step-title')?.focus();
	}
</script>

<svelte:head>
	<title>Anmäl en patrull · {data.comp.name}</title>
	<meta name="robots" content="noindex" />
	<meta name="referrer" content="no-referrer" />
</svelte:head>

<PublicShell title={data.comp.name} href="/t/{data.comp.slug}" eyebrow={done ? 'Anmälan klar' : 'Anmäl en patrull'} branding={data.branding}>
	{#if done}
		<section class="card done" aria-labelledby="h-done" data-testid="confirmation">
			<span class="badge" aria-hidden="true">
				<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"
					><path d="M5 12.5l4.5 4.5L19 7.5" /></svg
				>
			</span>
			<h1 id="h-done" tabindex="-1">{done.patrolName} är anmäld!</h1>
			<p class="lead">Patrull <strong class="nr" data-testid="patrol-number">{done.number}</strong> · {done.track}</p>
		</section>

		<section class="card save" aria-labelledby="h-save">
			<h2 id="h-save">Spara länken</h2>
			<p>
				Med den här länken ser du patrullpasset med QR-koden och kan ändra scouter och kontaktuppgifter fram till att anmälan stänger. <strong
					>Bokmärk den eller skicka den till dig själv nu</strong
				> – den visas bara här.
			</p>
			<CopyLink url={done.manageUrl} label="Patrullpass och ändringar" testid="manage-link" />
			<a class="btn btn-accent wide" href={done.manageUrl}>Öppna patrullpasset</a>
		</section>

		<section class="card" aria-labelledby="h-follow">
			<h2 id="h-follow">Följ patrullen</h2>
			<p class="muted">
				Dela den här länken med ledare och föräldrar. Den visar var patrullen är och hur det går under tävlingsdagen, men inga namn på scouterna eller
				kontaktuppgifter. Dela den bara med dem som ska följa patrullen.
			</p>
			<CopyLink url={done.followUrl} label="Följ-länk" testid="follow-link" />
			{#if !done.followEnabled}<p class="muted small">Arrangören slår på Följ patrullen närmare tävlingen. Länken fungerar då.</p>{/if}
		</section>

		{#if done.confirmationText}
			<section class="card" aria-labelledby="h-org">
				<h2 id="h-org">Från arrangören</h2>
				<p class="pre">{done.confirmationText}</p>
			</section>
		{/if}
		<a class="back-link" href="/t/{data.comp.slug}">Till tävlingssidan</a>
	{:else if !open}
		<section class="card closed" data-testid="reg-closed">
			<h1>{data.window.text}</h1>
			<p class="muted">Det går inte att anmäla en patrull just nu.</p>
			<a class="btn" href="/t/{data.comp.slug}">Till tävlingssidan</a>
		</section>
	{:else}
		<form
			method="POST"
			class="card wizard"
			novalidate
			oninput={recheck}
			onchange={recheck}
			use:enhance={({ cancel }) => {
				if (!check(3)) return cancel();
				compact();
				sending = true;
				return async ({ update, result }) => {
					sending = false;
					await update({ reset: false });
					if (result.type === 'failure') {
						showServer = true;
						const keys = Object.keys((result.data?.errors ?? {}) as FormErrors).filter((k) => k !== 'form');
						if (keys[0]) step = stepOf(keys[0]);
						void focusFirstError();
					} else if (result.type === 'success') {
						await tick();
						document.getElementById('h-done')?.focus();
						scrollTo({ top: 0 });
					}
				};
			}}
		>
			{#if js}
				<div class="progress" aria-hidden="true">
					{#each STEPS as _, i (i)}<span class:on={i < step}></span>{/each}
				</div>
				<p class="stepno">Steg {step} av 3</p>
			{/if}

			<fieldset class="step" hidden={js && step !== 1}>
				<legend><h1 id={step === 1 ? 'step-title' : undefined} tabindex="-1">Patrullen</h1></legend>
				<div class="field">
					<label for="patrolName">Patrullens namn</label>
					<input
						id="patrolName"
						name="patrolName"
						bind:value={patrolName}
						autocomplete="off"
						maxlength="40"
						aria-invalid={errors.patrolName ? 'true' : undefined}
						aria-describedby={errors.patrolName ? 'e-patrolName' : 'h-patrolName'}
					/>
					{#if errors.patrolName}<span id="e-patrolName" class="error-text">{errors.patrolName}</span>{:else}<span id="h-patrolName" class="muted small"
							>Visas i resultaten och arkivet. Använd inte scouternas namn.</span
						>{/if}
				</div>
				<div class="field">
					<label for="troop">Kår</label>
					<input
						id="troop"
						name="troop"
						bind:value={troop}
						autocomplete="organization"
						placeholder="t.ex. Ekbackens scoutkår"
						maxlength="80"
						aria-invalid={errors.troop ? 'true' : undefined}
						aria-describedby={errors.troop ? 'e-troop' : undefined}
					/>
					{#if errors.troop}<span id="e-troop" class="error-text">{errors.troop}</span>{/if}
				</div>
				<div class="field" role="radiogroup" aria-labelledby="l-track" aria-describedby={errors.trackId ? 'e-track' : undefined}>
					<span id="l-track" class="label">Klass</span>
					<div class="options">
						{#each data.tracks as t (t.id)}
							<label class="option" class:sel={trackId === t.id}>
								<input type="radio" name="trackId" value={t.id} bind:group={trackId} />
								<span class="on"><TrackChip color={t.color} />{t.name}</span>
								<span class="oc">{t.patrols} {t.patrols === 1 ? 'patrull' : 'patruller'} anmälda</span>
							</label>
						{/each}
					</div>
					{#if errors.trackId}<span id="e-track" class="error-text">{errors.trackId}</span>{/if}
				</div>
			</fieldset>

			<fieldset class="step" hidden={js && step !== 2}>
				<legend><h1 id={step === 2 ? 'step-title' : undefined} tabindex="-1">Scouterna</h1></legend>
				<p class="muted lead">För- och efternamn på de som går i patrullen. Vi frågar aldrig efter personnummer eller födelsedatum.</p>
				<MembersEditor bind:members {errors} />
			</fieldset>

			<fieldset class="step" hidden={js && step !== 3}>
				<legend><h1 id={step === 3 ? 'step-title' : undefined} tabindex="-1">Kontaktperson</h1></legend>
				<p class="muted lead">
					Ledaren som arrangören kan nå under tävlingen. Namn och telefon syns för arrangören och för funktionärerna vid start och mål, så att de kan ringa om
					något händer på banan.
				</p>
				<div class="field">
					<label for="contactName">Namn</label>
					<input
						id="contactName"
						name="contactName"
						bind:value={contactName}
						autocomplete="name"
						aria-invalid={errors.contactName ? 'true' : undefined}
						aria-describedby={errors.contactName ? 'err-contactName' : undefined}
					/>
					{#if errors.contactName}<span class="error-text" id="err-contactName">{errors.contactName}</span>{/if}
				</div>
				<div class="field">
					<label for="contactPhone">Mobilnummer</label>
					<input
						id="contactPhone"
						name="contactPhone"
						type="tel"
						inputmode="tel"
						bind:value={contactPhone}
						autocomplete="tel"
						placeholder="070-123 45 67"
						aria-invalid={errors.contactPhone ? 'true' : undefined}
						aria-describedby={errors.contactPhone ? 'err-contactPhone' : undefined}
					/>
					{#if errors.contactPhone}<span class="error-text" id="err-contactPhone">{errors.contactPhone}</span>{/if}
				</div>
				<div class="field">
					<label for="contactEmail">E-post</label>
					<input
						id="contactEmail"
						name="contactEmail"
						type="email"
						inputmode="email"
						bind:value={contactEmail}
						autocomplete="email"
						aria-invalid={errors.contactEmail ? 'true' : undefined}
						aria-describedby={errors.contactEmail ? 'err-contactEmail' : undefined}
					/>
					{#if errors.contactEmail}<span class="error-text" id="err-contactEmail">{errors.contactEmail}</span>{/if}
				</div>
				<div class="hp" aria-hidden="true">
					<label for="website">Lämna tomt</label>
					<input id="website" name="website" tabindex="-1" autocomplete="off" />
				</div>
			</fieldset>

			{#if errors.form}<p class="error-text formerr" role="alert">{errors.form}</p>{/if}

			<div class="nav">
				{#if js && step > 1}<button type="button" class="btn" onclick={back}>Tillbaka</button>{/if}
				{#if js && step < 3}
					<button type="button" class="btn btn-primary grow" onclick={next}>Nästa</button>
				{:else}
					<button class="btn btn-accent grow" disabled={sending}>{sending ? 'Skickar…' : 'Skicka anmälan'}</button>
				{/if}
			</div>
			<p class="muted small privacy">
				Uppgifterna sparas av {data.comp.organiser ?? 'arrangören'}. <a href="/personuppgifter?t={data.comp.slug}">Så hanterar vi personuppgifter</a>
			</p>
		</form>
		{#if data.window.spotsLeft !== null}<p class="muted center small">
				{data.window.spotsLeft}
				{data.window.spotsLeft === 1 ? 'plats kvar' : 'platser kvar'}
			</p>{/if}
	{/if}
</PublicShell>

<style>
	h1 {
		font-size: 30px;
		font-weight: 800;
		outline: none;
	}
	h2 {
		font-size: 20px;
		font-weight: 800;
	}
	.wizard {
		display: flex;
		flex-direction: column;
		gap: 16px;
		padding: 20px 18px;
	}
	.progress {
		display: flex;
		gap: 6px;
	}
	.progress span {
		flex: 1;
		height: 6px;
		border-radius: 999px;
		background: var(--line);
	}
	.progress span.on {
		background: var(--orange);
	}
	.stepno {
		margin: -6px 0 0;
		font-size: 13px;
		font-weight: 800;
		color: var(--ink-2);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	fieldset {
		border: 0;
		margin: 0;
		padding: 0;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	fieldset[hidden] {
		display: none;
	}
	legend {
		padding: 0;
		margin-bottom: 14px;
	}
	.lead {
		margin: -8px 0 0;
		font-size: 15px;
	}
	.options {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 10px;
	}
	.option {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 14px;
		min-height: 76px;
		border: 2px solid var(--line-strong);
		border-radius: var(--r-md);
		background: var(--surface);
		cursor: pointer;
	}
	.option input {
		position: absolute;
		opacity: 0;
		inset: 0;
		margin: 0;
		cursor: pointer;
	}
	.option:has(input:focus-visible) {
		outline: 3px solid var(--orange);
		outline-offset: 2px;
	}
	.option.sel,
	.option:has(input:checked) {
		border-color: var(--brand);
		background: var(--ok-tint);
		box-shadow: inset 0 0 0 1px var(--brand);
	}
	.on {
		font-family: var(--font-display);
		font-weight: 800;
		font-size: 18px;
		display: inline-flex;
		align-items: center;
		gap: 10px;
	}
	.oc {
		font-size: 13px;
		color: var(--ink-2);
	}
	.hp {
		position: absolute;
		left: -10000px;
		width: 1px;
		height: 1px;
		overflow: hidden;
	}
	.nav {
		display: flex;
		gap: 10px;
		margin-top: 4px;
	}
	.grow {
		flex: 1;
		min-height: 56px;
		font-size: 17px;
	}
	.nav .btn:not(.grow) {
		min-height: 56px;
	}
	.formerr {
		margin: 0;
	}
	[aria-invalid='true'] {
		border-color: var(--danger);
	}
	.center {
		text-align: center;
		margin: 0;
	}
	.small {
		font-size: 14px;
	}
	.done {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: 8px;
		padding: 24px 18px;
	}
	.badge {
		width: 60px;
		height: 60px;
		border-radius: 50%;
		background: var(--brand);
		color: #fff;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.lead.lead {
		margin: 0;
	}
	.done .lead {
		font-size: 17px;
		color: var(--ink-2);
	}
	.nr {
		font-family: var(--font-display);
		font-size: 22px;
		color: var(--ink);
	}
	.save {
		display: flex;
		flex-direction: column;
		gap: 12px;
		border: 2px solid var(--orange);
		background: var(--warn-tint);
	}
	.save p,
	section p {
		margin: 0;
	}
	section.card:not(.done) {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.wide {
		width: 100%;
		min-height: 56px;
		font-size: 17px;
	}
	.pre {
		white-space: pre-line;
	}
	.back-link {
		align-self: center;
		font-weight: 700;
		padding: 12px;
	}
	.closed {
		display: flex;
		flex-direction: column;
		gap: 10px;
		align-items: flex-start;
	}
	.closed p {
		margin: 0;
	}
</style>

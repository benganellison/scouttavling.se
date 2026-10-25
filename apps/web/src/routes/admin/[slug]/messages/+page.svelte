<script lang="ts">
	import { enhance } from '$app/forms';
	import { LiveStream } from '#lib/ui/live/liveStore.svelte.ts';

	let { data, form } = $props();

	new LiveStream(() => ({ url: `/api/v1/live/${data.comp.slug}/events`, depends: `live:${data.comp.slug}` }));

	const TEMPLATES = [
		{ name: 'Lunch', title: 'Lunch', body: 'Lunchen serveras nu vid Rastplatsen. Släpp iväg patrullerna som är klara och ta själva en paus i tur och ordning.', important: false },
		{ name: 'Väderomslag', title: 'Väderomslag', body: 'Åska närmar sig. Avbryt aktiviteter vid vatten och i höga träd, samla patrullerna i skydd och invänta besked från ledningen.', important: true },
		{ name: 'Reservläge', title: 'Reservläge — skriv på papper', body: 'Vi har tekniska problem. Skriv patrullnummer, poäng och stilpoäng på papperslappen tills vidare. Appen tar inte emot nya poäng förrän reservläget avslutas.', important: true },
		{ name: 'Avslut', title: 'Tävlingen är slut', body: 'Alla patruller är i mål. Packa ihop kontrollen, lämna material vid Mål och kom till prisutdelningen. Tack för i dag!', important: false }
	];

	let title = $state('');
	let body = $state('');
	let important = $state(false);
	let audience = $state<string[]>(['all']);

	function useTemplate(t: (typeof TEMPLATES)[number]) {
		title = t.title;
		body = t.body;
		important = t.important;
	}
	const toggle = (id: string) => {
		if (id === 'all') audience = audience.includes('all') ? [] : ['all'];
		else audience = audience.includes(id) ? audience.filter((a) => a !== id) : [...audience.filter((a) => a !== 'all'), id];
	};
</script>

<svelte:head><title>Meddelanden · {data.comp.name}</title></svelte:head>

<div class="page cols">
	<section class="card stack" aria-labelledby="new-h">
		<h1 id="new-h">Nytt meddelande</h1>
		<div class="stack tight">
			<span class="label">Mallar</span>
			<div class="chips">
				{#each TEMPLATES as t (t.name)}
					<button type="button" class="chip-btn" onclick={() => useTemplate(t)}>{t.name}</button>
				{/each}
			</div>
		</div>
		<form
			method="POST"
			action="?/send"
			class="stack"
			use:enhance={() =>
				async ({ result, update }) => {
					await update({ reset: false });
					if (result.type === 'success') {
						title = '';
						body = '';
						important = false;
						audience = ['all'];
					}
				}}
		>
			<div class="field">
				<label for="title">Rubrik</label>
				<input id="title" name="title" type="text" bind:value={title} maxlength="80" required />
			</div>
			<div class="field">
				<label for="body">Meddelande</label>
				<textarea id="body" name="body" rows="4" bind:value={body} maxlength="600" required></textarea>
			</div>
			<fieldset class="stack tight">
				<legend class="label">Mottagare</legend>
				<div class="chips">
					<label class="chip"><input type="checkbox" name="audience" value="all" checked={audience.includes('all')} onchange={() => toggle('all')} /><span>Alla funktionärer</span></label>
					<label class="chip"><input type="checkbox" name="audience" value="startfinish" checked={audience.includes('startfinish')} onchange={() => toggle('startfinish')} /><span>Start &amp; mål</span></label>
					{#each data.stations as s (s.id)}
						<label class="chip"><input type="checkbox" name="audience" value={s.id} checked={audience.includes(s.id)} onchange={() => toggle(s.id)} /><span>{s.code} {s.name}</span></label>
					{/each}
				</div>
			</fieldset>
			<label class="switch-row">
				<input type="checkbox" name="important" bind:checked={important} />
				<span class="sw" aria-hidden="true"></span>
				<span><strong>Viktigt — kräver kvittens</strong><br /><span class="muted small">Visas i helskärm på telefonen tills funktionären trycker OK.</span></span>
			</label>
			<div class="row">
				<button class="btn btn-accent">Skicka meddelande</button>
				{#if form?.message}<span class={form && 'sent' in form ? 'ok-text' : 'error-text'} role="status">{form.message}</span>{/if}
			</div>
		</form>
	</section>

	<section class="stack" aria-labelledby="sent-h">
		<h2 id="sent-h">Skickade</h2>
		{#if data.sent.length === 0}
			<p class="muted">Inga meddelanden skickade ännu.</p>
		{/if}
		<ul class="sent">
			{#each data.sent as m (m.id)}
				<li class="card stack tight" data-testid="sent-message">
					<div class="row between">
						<strong>{m.title}</strong>
						<span class="muted small">{m.time}</span>
					</div>
					<p class="body">{m.body}</p>
					<div class="row small-gap">
						{#if m.important}<span class="pill pill-warn">Kräver kvittens</span>{/if}
						{#each m.audience as a (a)}<span class="pill">{a}</span>{/each}
					</div>
					<div class="receipt">
						{#if m.total === 0}
							<span class="muted small">Inga enheter anslutna för mottagarna ännu.</span>
						{:else}
							<div class="bar" aria-hidden="true"><span style="width: {(m.read / m.total) * 100}%"></span></div>
							<span class="small"><strong>{m.read} av {m.total}</strong> har läst</span>
							{#if m.unread.length}<span class="muted small">Inte läst: {m.unread.join(', ')}</span>{/if}
						{/if}
					</div>
				</li>
			{/each}
		</ul>
	</section>
</div>

<style>
	.cols {
		display: grid;
		grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
		gap: 22px;
		align-items: start;
	}
	@media (max-width: 1000px) {
		.cols {
			grid-template-columns: 1fr;
		}
	}
	h1 {
		font-size: 28px;
	}
	h2 {
		font-size: 22px;
	}
	.tight {
		gap: 6px;
	}
	.small {
		font-size: 13px;
	}
	.between {
		justify-content: space-between;
	}
	.small-gap {
		gap: 6px;
	}
	fieldset {
		border: 0;
		padding: 0;
		margin: 0;
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.chip-btn,
	.chip span {
		display: inline-flex;
		align-items: center;
		min-height: 40px;
		padding: 0 14px;
		border-radius: 999px;
		border: 1.5px solid var(--line-strong);
		background: var(--surface);
		font-weight: 700;
		font-size: 14px;
		cursor: pointer;
	}
	.chip input {
		position: absolute;
		opacity: 0;
		width: 1px;
		height: 1px;
	}
	.chip input:checked + span {
		background: var(--brand);
		border-color: var(--brand);
		color: #fff;
	}
	.chip input:focus-visible + span {
		outline: 3px solid var(--orange);
		outline-offset: 2px;
	}
	.switch-row {
		display: flex;
		gap: 12px;
		align-items: center;
		cursor: pointer;
		min-height: var(--tap);
	}
	.switch-row input {
		position: absolute;
		opacity: 0;
	}
	.sw {
		width: 44px;
		height: 26px;
		border-radius: 999px;
		background: var(--line-strong);
		position: relative;
		flex: none;
	}
	.sw::after {
		content: '';
		position: absolute;
		top: 3px;
		left: 3px;
		width: 20px;
		height: 20px;
		border-radius: 50%;
		background: #fff;
		transition: left 0.15s;
	}
	.switch-row input:checked + .sw {
		background: var(--cta);
	}
	.switch-row input:checked + .sw::after {
		left: 21px;
	}
	.switch-row input:focus-visible + .sw {
		outline: 3px solid var(--orange);
		outline-offset: 2px;
	}
	.ok-text {
		color: var(--brand-2);
		font-weight: 700;
	}
	.sent {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.body {
		margin: 0;
		color: var(--ink-2);
		font-size: 14px;
	}
	.receipt {
		display: flex;
		flex-direction: column;
		gap: 4px;
		border-top: 1px solid var(--line);
		padding-top: 10px;
	}
	.bar {
		height: 6px;
		background: var(--tint);
		border-radius: 999px;
		overflow: hidden;
	}
	.bar span {
		display: block;
		height: 100%;
		background: var(--ok);
	}
</style>

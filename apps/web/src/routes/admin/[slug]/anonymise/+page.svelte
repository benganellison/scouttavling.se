<script lang="ts">
	import { enhance } from '$app/forms';

	let { data, form } = $props();
	const c = $derived(data.competition);
	const k = $derived(data.counts);
	let typed = $state('');
	let busy = $state(false);
	const matches = $derived(typed.trim().toLocaleLowerCase('sv-SE') === c.name.trim().toLocaleLowerCase('sv-SE'));
	const n = (v: number, one: string, many: string) => `${v} ${v === 1 ? one : many}`;
</script>

<svelte:head><title>Ta bort personuppgifter · {c.name}</title></svelte:head>

<header class="head">
	<a class="back" href="/admin/{c.slug}">Översikt</a>
	<h1>Ta bort personuppgifter</h1>
	<p class="muted">{c.name} är avslutad. När resultaten är klara behövs inga personuppgifter längre. Tävlingen blir sedan skrivskyddad och resultaten ligger kvar exakt som nu.</p>
</header>

<div class="cols">
	<section class="card col" aria-labelledby="rm-h">
		<h2 id="rm-h">Tas bort</h2>
		<ul class="list rm">
			<li><strong>Scouternas namn</strong> <span class="muted">{n(k.members, 'scout', 'scouter')}</span></li>
			<li><strong>Kontaktpersoner</strong> <span class="muted">namn, e-post och telefon för {n(k.patrols, 'patrull', 'patruller')}</span></li>
			<li><strong>Patrullernas länkar</strong> <span class="muted">hantera anmälan och Följ patrullen visar sedan "arkiverad"</span></li>
			<li><strong>Funktionärer</strong> <span class="muted">{n(k.devices, 'telefon', 'telefoner')}, inbjudningar ({k.invites}) och kontaktpersoner på kontrollerna</span></li>
			<li><strong>Meddelanden</strong> <span class="muted">{n(k.messages, 'meddelande', 'meddelanden')} och läskvitton</span></li>
			<li><strong>Anteckningar och spår av vem som gjorde vad</strong> <span class="muted">kommentarer på poäng, ändringsorsaker, vem som rapporterade</span></li>
			<li><strong>Medarrangörer och ledningens telefon</strong> <span class="muted">{k.team ? `${n(k.team, 'person', 'personer')} med andra roller än ägare` : 'ägaren behåller sin åtkomst'}</span></li>
		</ul>
	</section>
	<section class="card col" aria-labelledby="keep-h">
		<h2 id="keep-h">Sparas</h2>
		<ul class="list keep">
			<li><strong>Patruller</strong> <span class="muted">nummer, patrullnamn, kår, klass och status</span></li>
			<li><strong>Poäng</strong> <span class="muted">poäng och stilpoäng per kontroll</span></li>
			<li><strong>Kontroller, dagar och klasser</strong></li>
			<li><strong>Resultat</strong> <span class="muted">placeringarna blir identiska; publika resultat och seriens arkiv fortsätter fungera</span></li>
		</ul>
	</section>
</div>

<section class="card confirm" aria-labelledby="cf-h">
	<h2 id="cf-h">Bekräfta</h2>
	<p class="warn" role="note">
		<strong>Det går inte att ångra.</strong> Appen kan inte ta en egen säkerhetskopia innan, och borttagna uppgifter går inte att få tillbaka här. Exportera resultaten först om du vill ha dem som fil. Behöver du lämna ut eller spara personuppgifterna (till exempel för en begäran från en förälder), <a href="/admin/{c.slug}/personuppgifter.json" download data-testid="export-personal">exportera dem som fil</a> innan.
	</p>
	<p class="muted backups" data-testid="backup-note">
		<strong>Säkerhetskopior och telefoner:</strong> borttagningen rör inte serverns schemalagda säkerhetskopior. Där finns uppgifterna kvar tills kopiorna roteras bort: kopiorna på servern efter ett dygn och de externa kopiorna efter högst åtta veckor. Funktionärernas telefoner glömmer tävlingen när behörigheten kopplas från eller går ut, senast en vecka efter tävlingen.
	</p>
	<form
		method="POST"
		use:enhance={() => {
			busy = true;
			return async ({ update }) => {
				await update({ reset: false });
				busy = false;
			};
		}}
		class="stack"
	>
		<label class="label" for="confirm">Skriv tävlingens namn, <strong>{c.name}</strong>, för att bekräfta</label>
		<input id="confirm" name="confirm" class="field" autocomplete="off" bind:value={typed} aria-invalid={form?.error ? 'true' : undefined} aria-describedby={form?.error ? 'cf-err' : undefined} />
		{#if form?.error}<span id="cf-err" class="error-text" role="alert">{form.error}</span>{/if}
		<div class="act">
			<button class="btn danger" disabled={!matches || busy}>{busy ? 'Tar bort…' : 'Ta bort personuppgifter permanent'}</button>
			<a class="btn btn-ghost" href="/admin/{c.slug}">Avbryt</a>
		</div>
	</form>
</section>

<style>
	.backups {
		margin: 0;
		font-size: 15px;
	}
	.head {
		display: flex;
		flex-direction: column;
		gap: 8px;
		max-width: 760px;
	}
	.head p {
		margin: 0;
		font-size: 16px;
	}
	.back {
		font-weight: 700;
		color: var(--ink-2);
	}
	h1 {
		font-size: clamp(28px, 4vw, 38px);
		font-weight: 800;
		letter-spacing: -0.03em;
	}
	.cols {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 340px), 1fr));
		gap: 16px;
	}
	.col,
	.confirm {
		padding: 22px 24px;
		border-radius: 20px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	h2 {
		font-size: 19px;
		margin: 0;
	}
	.list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.list li {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding-left: 22px;
		position: relative;
	}
	.list li::before {
		content: '';
		position: absolute;
		left: 2px;
		top: 7px;
		width: 10px;
		height: 10px;
		border-radius: 50%;
	}
	.rm li::before {
		background: var(--danger);
	}
	.keep li::before {
		background: var(--ok, #2e7d32);
	}
	.confirm {
		max-width: 760px;
	}
	.warn {
		margin: 0;
		padding: 12px 14px;
		border-radius: 12px;
		border-left: 5px solid var(--danger);
		background: var(--tint);
	}
	.act {
		display: flex;
		gap: 10px;
		flex-wrap: wrap;
		align-items: center;
	}
	.danger {
		background: var(--danger);
		border-color: var(--danger);
		color: #fff;
	}
	.danger:disabled {
		opacity: 0.45;
	}
</style>

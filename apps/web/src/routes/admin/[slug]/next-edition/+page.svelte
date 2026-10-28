<script lang="ts">
	import { page } from '$app/state';
	import { shortDate } from '#lib/ui/admin/format.ts';

	let { data, form } = $props();
	const c = $derived(data.competition);
	const p = $derived(data.plan);
	const e = $derived((form?.errors ?? {}) as Record<string, string>);
	type Values = { name: string; slug: string; dates: string[]; registrationOpensOn: string; registrationClosesOn: string };
	const v = $derived(form && 'values' in form ? (form.values as Values) : null);
	const WD = ['söndag', 'måndag', 'tisdag', 'onsdag', 'torsdag', 'fredag', 'lördag'];
	const wd = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? WD[new Date(`${iso}T12:00:00Z`).getUTCDay()] : '');
	let dates = $state<string[]>([]);
	$effect.pre(() => {
		if (!dates.length) dates = v?.dates ?? p.days.map((d) => d.date);
	});
</script>

<svelte:head><title>Skapa {p.name} · {c.name}</title></svelte:head>

<header class="head">
	<a class="back" href="/admin/{c.slug}">{c.name}</a>
	<h1>Skapa {p.name}</h1>
	<p class="muted">Ett nytt år i serien {p.seriesName}, byggt på {c.name}. Kontrollera datumen; de är flyttade ett år framåt till samma veckodag.</p>
</header>

{#if p.existing}
	<section class="card box">
		<p>{p.existing.name} finns redan.</p>
		<a class="btn btn-primary" href="/admin/{p.existing.slug}">Öppna {p.existing.name}</a>
	</section>
{:else}
	<form method="POST" class="layout" novalidate>
		<section class="card box" aria-labelledby="h-basic">
			<h2 id="h-basic">Namn och datum</h2>
			{#if e.form}<p class="error-text" role="alert">{e.form}</p>{/if}
			<div class="grid2">
				<div class="stack tight">
					<label class="label" for="name">Namn</label>
					<input
						id="name"
						name="name"
						class="field"
						value={v?.name ?? p.name}
						aria-invalid={e.name ? 'true' : undefined}
						aria-describedby={e.name ? 'err-name' : undefined}
					/>
					{#if e.name}<span class="error-text" id="err-name">{e.name}</span>{/if}
				</div>
				<div class="stack tight">
					<label class="label" for="slug">Adress</label>
					<div class="prefix">
						<span class="muted">{page.data.siteHost}/</span><input
							id="slug"
							name="slug"
							class="field"
							value={v?.slug ?? p.slug}
							aria-invalid={e.slug ? 'true' : undefined}
							aria-describedby={e.slug ? 'err-slug' : undefined}
						/>
					</div>
					{#if e.slug}<span class="error-text" id="err-slug">{e.slug}</span>{/if}
				</div>
			</div>
			<ul class="days" aria-label="Dagar">
				{#each p.days as d, i (d.sort)}
					<li>
						<label class="label" for="date_{i}">{p.multiDay ? `Dag ${i + 1}${d.name ? ` · ${d.name}` : ''}` : 'Datum'}</label>
						<div class="dayrow">
							<input id="date_{i}" name="date_{i}" type="date" class="field" bind:value={dates[i]} aria-invalid={e[`date_${i}`] ? 'true' : undefined} />
							<span class="muted small">{wd(dates[i] ?? '')} · förra året {shortDate(d.from)}</span>
						</div>
						{#if e[`date_${i}`]}<span class="error-text">{e[`date_${i}`]}</span>{/if}
					</li>
				{/each}
			</ul>
		</section>

		<section class="card box" aria-labelledby="h-reg">
			<h2 id="h-reg">Anmälan</h2>
			<p class="muted small">Självanmälan är stängd tills du öppnar den under Inställningar. Datumen nedan är flyttade lika mycket som tävlingen.</p>
			<div class="grid2">
				<div class="stack tight">
					<label class="label" for="ro">Öppnar</label>
					<input id="ro" name="registrationOpensOn" type="date" class="field" value={v?.registrationOpensOn ?? p.registrationOpensOn ?? ''} />
					{#if e.registrationOpensOn}<span class="error-text" id="err-registrationOpensOn">{e.registrationOpensOn}</span>{/if}
				</div>
				<div class="stack tight">
					<label class="label" for="rc">Stänger</label>
					<input id="rc" name="registrationClosesOn" type="date" class="field" value={v?.registrationClosesOn ?? p.registrationClosesOn ?? ''} />
					{#if e.registrationClosesOn}<span class="error-text" id="err-registrationClosesOn">{e.registrationClosesOn}</span>{/if}
				</div>
			</div>
		</section>

		<section class="card box" aria-labelledby="h-copy">
			<h2 id="h-copy">Det här följer med</h2>
			<div class="copy">
				<ul class="yes">
					<li>{p.counts.tracks} klasser med färger</li>
					<li>{p.counts.stations} kontroller med roller och {p.counts.items} poängregler</li>
					<li>Dagar, stilpoäng och inställningar för resultat och anmälan</li>
					{#if p.counts.invites}<li>{p.counts.invites} funktionärsinbjudningar, med nya QR-koder</li>{/if}
					<li>Seriens utseende (logga, färg och bild)</li>
				</ul>
				<ul class="no">
					<li>Patruller och scouter</li>
					<li>Poäng och resultat</li>
					<li>Funktionärernas telefoner och meddelanden</li>
					<li>Kontaktpersoner och telefonnummer</li>
				</ul>
			</div>
			<p class="muted small roles" data-testid="roles-note">
				Ägare och arrangörer följer med till det nya året; roller för ledningscentral och start &amp; mål gör det inte.
			</p>
			<div class="act">
				<button class="btn btn-accent">Skapa {p.name}</button>
				<a class="btn btn-ghost" href="/admin/{c.slug}">Avbryt</a>
			</div>
		</section>
	</form>
{/if}

<style>
	.roles {
		margin: 0;
	}
	.head {
		display: flex;
		flex-direction: column;
		gap: 8px;
		max-width: 760px;
	}
	.head p {
		margin: 0;
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
	.layout {
		display: flex;
		flex-direction: column;
		gap: 16px;
		max-width: 860px;
	}
	.box {
		padding: 22px 24px;
		border-radius: 20px;
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	h2 {
		font-size: 19px;
		margin: 0;
	}
	.tight {
		gap: 6px;
	}
	.grid2 {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr));
		gap: 14px;
	}
	.prefix {
		display: flex;
		align-items: center;
		gap: 6px;
		flex-wrap: wrap;
	}
	.prefix input {
		flex: 1 1 160px;
		min-width: 0;
	}
	.days {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.days li {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.dayrow {
		display: flex;
		gap: 12px;
		align-items: center;
		flex-wrap: wrap;
	}
	.dayrow input {
		max-width: 220px;
	}
	.small {
		font-size: 13px;
	}
	.copy {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr));
		gap: 10px 24px;
	}
	.copy ul {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.copy li {
		padding-left: 24px;
		position: relative;
	}
	.copy li::before {
		position: absolute;
		left: 0;
		font-weight: 900;
	}
	.yes li::before {
		content: '+';
		color: var(--ok);
	}
	.no li::before {
		content: '–';
		color: var(--ink-2);
	}
	.no li {
		color: var(--ink-2);
	}
	.act {
		display: flex;
		gap: 10px;
		flex-wrap: wrap;
	}
</style>

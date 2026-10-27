<script lang="ts">
	import { page } from '$app/state';
	import { enhance } from '$app/forms';
	import { daysBetween } from '@scouttavling/domain';
	import ScouternaSymbol from '#lib/ui/brand/ScouternaSymbol.svelte';
	import Toggle from '#lib/ui/admin/Toggle.svelte';
	import { slugify, shortDate } from '#lib/ui/admin/format.ts';

	let { data, form } = $props();

	const AGES: Record<string, string> = { Spårare: '8–10 år', Upptäckare: '10–12 år', Äventyrare: '12–15 år', Utmanare: '15–18 år', Rover: '18–25 år' };

	// Initial values: a failed submit echoes what was posted.
	// svelte-ignore state_referenced_locally
	const v = form?.values;
	let name = $state(v?.name ?? '');
	let slugTyped = $state(v?.slug ?? '');
	let editSlug = $state(Boolean(v?.slug));
	let length = $state<'one' | 'multi'>((v?.length as 'one' | 'multi') ?? 'one');
	let date = $state(v?.date ?? '');
	let startDate = $state(v?.startDate ?? '');
	let endDate = $state(v?.endDate ?? '');
	let location = $state(v?.location ?? '');
	let hqPhone = $state(v?.hqPhone ?? '');
	// svelte-ignore state_referenced_locally
	let owner = $state(v?.owner ?? data.groups[0]?.groupNo ?? '');
	let tracks = $state<string[]>(v?.tracks ?? ['Spårare', 'Upptäckare', 'Äventyrare', 'Utmanare']);
	let customTracks = $state<string[]>(v?.customTracks ?? []);
	let styleEnabled = $state(v?.styleEnabled ?? true);
	let stations = $state(v?.stations ?? 10);
	let publicResults = $state(v?.publicResults ?? false);
	let registrationOpen = $state(v?.registrationOpen ?? false);
	let prefixes = $state<Record<string, string>>({});
	// Part of a series (step 1).
	let seriesMode = $state<'single' | 'new' | 'existing'>((v?.seriesMode as 'single' | 'new' | 'existing') ?? 'single');
	let seriesName = $state(v?.seriesName ?? '');
	let seriesNameTouched = $state(Boolean(v?.seriesName));
	let seriesSlugTyped = $state(v?.seriesSlug ?? '');
	let editSeriesSlug = $state(Boolean(v?.seriesSlug));
	// svelte-ignore state_referenced_locally
	let seriesId = $state(data.series.length === 1 ? data.series[0].id : '');
	let submitting = $state(false);

	const errors = $derived<Record<string, string>>(form?.errors ?? {});
	/** "GökOpen 2027" → "GökOpen" (same rule as the server's stripYear). */
	const stripYear = (n: string) => n.replace(/\b(19|20)\d{2}\b/g, '').replace(/\s+/g, ' ').trim();
	const seriesNameEff = $derived(seriesNameTouched ? seriesName : stripYear(name));
	const seriesSlug = $derived(editSeriesSlug ? slugify(seriesSlugTyped) : slugify(seriesNameEff));
	const editionYear = $derived((length === 'one' ? date : startDate).slice(0, 4) || null);
	const picked = $derived(data.series.find((o) => o.id === seriesId) ?? null);
	const nameSlug = $derived(editSlug ? slugify(slugTyped) : slugify(name));
	// Mirrors the server: a generated address equal to the new series' address gets the year.
	const slug = $derived(!editSlug && seriesMode === 'new' && nameSlug && nameSlug === seriesSlug && editionYear ? `${nameSlug}-${editionYear}` : nameSlug);
	const days = $derived(length === 'multi' && startDate && endDate && endDate > startDate ? daysBetween(startDate, endDate) : []);
	const perDay = $derived(days.length ? Math.ceil(stations / days.length) : 0);
	const ALL_SECTIONS = [
		{ id: 'serie', t: 'Serie', d: 'Fristående eller del av en serie' },
		{ id: 'grund', t: 'Grundinfo', d: 'Namn, datum, plats' },
		{ id: 'klasser', t: 'Klasser', d: 'Vilka tävlar?' },
		{ id: 'bana', t: 'Banan', d: 'Kontroller & stilpoäng' },
		{ id: 'anmalan', t: 'Anmälan & resultat', d: 'Vem ser vad?' }
	];
	// A new year in an existing series is created by the next-year flow, so only step 1 is shown.
	const sections = $derived((seriesMode === 'existing' ? ALL_SECTIONS.slice(0, 1) : ALL_SECTIONS).map((x, i) => ({ ...x, n: i + 1 })));
	const stepNo = (id: string) => ALL_SECTIONS.findIndex((x) => x.id === id) + 1;
	const doneSection = $derived<Record<string, boolean>>({
		serie: seriesMode === 'single' || (seriesMode === 'new' ? seriesNameEff.length >= 2 && Boolean(seriesSlug) : Boolean(picked)),
		grund: name.trim().length >= 2 && (length === 'one' ? Boolean(date) : days.length > 0),
		klasser: tracks.length + customTracks.filter((t) => t.trim()).length > 0,
		bana: true,
		anmalan: true
	});
	const sectionOf: Record<string, string> = {
		seriesName: 'serie', seriesSlug: 'serie', seriesId: 'serie',
		name: 'grund', slug: 'grund', date: 'grund', startDate: 'grund', endDate: 'grund', owner: 'grund', hqPhone: 'grund',
		tracks: 'klasser', stations: 'bana'
	};
	const errorSections = $derived(new Set(Object.keys(errors).map((k) => sectionOf[k] ?? (k.startsWith('prefix_') ? 'grund' : ''))));

	function toggleTrack(t: string) {
		tracks = tracks.includes(t) ? tracks.filter((x) => x !== t) : [...tracks, t];
	}
	function prefixFor(d: { date: string; prefix: string }) {
		return prefixes[d.date] ?? d.prefix;
	}
	function codeExample(p: string) {
		return `${p}S, ${p}1 … ${p}M`;
	}
</script>

{#snippet brandingSummary(b: (typeof data.series)[number]['branding'], seriesName: string)}
	<div class="inherit" data-testid="inherited-branding">
		<span class="label">Ärvs från serien {seriesName}</span>
		<div class="inherit-row">
			{#if b.eventLogo}<img class="logo" src={b.eventLogo.url} alt={b.eventLogo.alt} />{/if}
			<span class="swatch" style:background={b.accent ?? 'var(--brand)'} aria-hidden="true"></span>
			<span>{b.accent ? `Färg ${b.accent}` : 'Scoutblå (standard)'}, {b.eventLogo ? 'logga' : 'ingen logga'} och {b.cover ? 'omslagsbild' : 'ingen omslagsbild'}</span>
		</div>
		{#if b.classColors.length}
			<ul class="classes" aria-label="Klassfärger">
				{#each b.classColors as c (c.name)}<li><span class="dot-c" style:background={c.color} aria-hidden="true"></span>{c.name}</li>{/each}
			</ul>
		{/if}
	</div>
{/snippet}

<svelte:head><title>Ny tävling · Scouttävling</title></svelte:head>

<div class="page">
	<header class="top">
		<a class="brand" href="/admin"><ScouternaSymbol size={36} /> <span>Scouttävling</span></a>
		<a href="/admin" class="cancel">Avbryt</a>
	</header>

	<div class="layout">
		<nav class="steps" aria-label="Steg">
			<h1>Ny tävling på tre minuter.</h1>
			<ol>
				{#each sections as s (s.id)}
					<li>
						<a href="#{s.id}" class:err={errorSections.has(s.id)}>
							<span class="dot" class:done={doneSection[s.id] && !errorSections.has(s.id)} aria-hidden="true">
								{#if errorSections.has(s.id)}!{:else if doneSection[s.id]}<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>{:else}{s.n}{/if}
							</span>
							<span class="st"><span class="t">{s.t}</span><span class="d">{s.d}</span></span>
						</a>
					</li>
				{/each}
			</ol>
			<p class="muted hint">Allt går att ändra senare under Inställningar och Kontroller.</p>
		</nav>

		<form
			method="POST"
			class="main"
			novalidate
			use:enhance={() => {
				submitting = true;
				return async ({ update, result }) => {
					await update({ reset: false });
					submitting = false;
					// Focus (not just scroll to) the first problem: keyboard and screen-reader users land on the
					// field, and its linked error text is read out with it.
					if (result.type === 'failure') {
						const el = document.querySelector<HTMLElement>('[aria-invalid="true"], .form-error');
						el?.scrollIntoView({ block: 'center' });
						if (el && !el.matches('input, select, textarea, button')) el.tabIndex = -1;
						el?.focus({ preventScroll: true });
					}
				};
			}}
		>
			{#if errors.form}<p class="form-error card" role="alert">{errors.form}</p>{/if}

			<section id="serie" class="card sec" aria-labelledby="h-serie">
				<span class="num">Steg 1</span>
				<h2 id="h-serie">Är tävlingen en del av en serie?</h2>
				<p class="muted lead">En serie är samma tävling år efter år, t.ex. GökOpen 2026, 2027 … Alla år delar logga, färger och ett publikt arkiv.</p>
				<fieldset class="fs">
					<legend class="sr-only">Serie</legend>
					<div class="choice3">
						<label class="choice" class:on={seriesMode === 'single'}>
							<input type="radio" name="seriesMode" value="single" bind:group={seriesMode} />
							<span class="ct">Fristående tävling</span>
							<span class="cd">En enstaka tävling. Kan bli en serie senare.</span>
						</label>
						<label class="choice" class:on={seriesMode === 'new'}>
							<input type="radio" name="seriesMode" value="new" bind:group={seriesMode} />
							<span class="ct">Ny tävlingsserie</span>
							<span class="cd">Första året i en serie som återkommer.</span>
						</label>
						<label class="choice" class:on={seriesMode === 'existing'} class:off={!data.series.length}>
							<input type="radio" name="seriesMode" value="existing" bind:group={seriesMode} disabled={!data.series.length} />
							<span class="ct">Nytt år i en befintlig serie</span>
							<span class="cd">{data.series.length ? 'Bygger på seriens senaste år.' : 'Du arrangerar ingen serie än.'}</span>
						</label>
					</div>
				</fieldset>

				{#if seriesMode === 'new'}
					<div class="field">
						<label for="seriesName">Seriens namn</label>
						<input
							id="seriesName"
							name="seriesName"
							value={seriesNameEff}
							oninput={(e) => { seriesName = e.currentTarget.value; seriesNameTouched = true; }}
							autocomplete="off"
							placeholder="t.ex. GökOpen"
							aria-invalid={errors.seriesName ? 'true' : undefined}
							aria-describedby="series-help"
						/>
						{#if errors.seriesName}<span class="error-text" id="err-seriesName">{errors.seriesName}</span>{/if}
						<span id="series-help" class="help">
							Seriens sida blir <strong class="url">{page.data.siteHost}/{seriesSlug || '…'}</strong>
							{#if !editSeriesSlug}<button type="button" class="linkish" onclick={() => { editSeriesSlug = true; seriesSlugTyped = seriesSlug; }}>Ändra adress</button>{/if}
							· Året ({editionYear ?? 'från datumet'}) läggs till per upplaga.
						</span>
					</div>
					{#if editSeriesSlug}
						<div class="field">
							<label for="seriesSlug">Seriens adress</label>
							<div class="prefixed"><span aria-hidden="true">{page.data.siteHost}/</span><input id="seriesSlug" name="seriesSlug" bind:value={seriesSlugTyped} aria-invalid={errors.seriesSlug ? 'true' : undefined} aria-describedby={errors.seriesSlug ? 'err-seriesSlug' : undefined} /></div>
						</div>
					{/if}
					{#if errors.seriesSlug}<span class="error-text" id="err-seriesSlug">{errors.seriesSlug}</span>{/if}
				{:else if seriesMode === 'existing'}
					<fieldset class="fs">
						<legend class="label">Vilken serie?</legend>
						<div class="series-list">
							{#each data.series as o (o.id)}
								<label class="choice srs" class:on={seriesId === o.id}>
									<input type="radio" name="seriesId" value={o.id} bind:group={seriesId} />
									<span class="ct">{o.name}</span>
									<span class="cd">{o.latest ? `Senast: ${o.latest.name}` : 'Inga år än'}</span>
								</label>
							{/each}
						</div>
					</fieldset>
					{#if errors.seriesId}<span class="error-text" id="err-seriesId">{errors.seriesId}</span>{/if}
					{#if picked}
						<div class="summary" data-testid="series-summary" aria-live="polite">
							<span class="ik">Sammanfattning</span>
							{#if picked.nextExists}
								<p class="iv">{picked.nextName} finns redan.</p>
								<div><a class="btn" href="/admin/{picked.nextExists}">Öppna {picked.nextName}</a></div>
							{:else if picked.latest}
								<p class="iv">{picked.nextName}</p>
								<p class="muted small">Kopierar dagar, klasser, kontroller, poängregler och inställningar från {picked.latest.name}. Datumen flyttas ett år fram; du kontrollerar dem i nästa steg. Patruller, poäng och funktionärer följer inte med.</p>
								{@render brandingSummary(picked.branding, picked.name)}
								{#if picked.canCopy}
									<div><a class="btn btn-accent big" href="/admin/{picked.latest.slug}/next-edition" data-testid="series-continue">Fortsätt: Skapa {picked.nextName}</a></div>
								{:else}
									<p class="note">Du är inte arrangör för {picked.latest.name}. Be dess ägare skapa {picked.nextName} eller lägga till dig.</p>
								{/if}
							{/if}
						</div>
					{/if}
					<noscript><button class="btn btn-accent" type="submit">Fortsätt</button></noscript>
				{/if}
			</section>

			{#if seriesMode !== 'existing'}
			<section id="grund" class="card sec" aria-labelledby="h-grund">
				<span class="num">Steg {stepNo('grund')}</span>
				<h2 id="h-grund">Berätta om tävlingen</h2>

				<div class="field">
					<label for="name">Namn</label>
					<input id="name" name="name" bind:value={name} autocomplete="off" placeholder="t.ex. GökOpen 2027" aria-invalid={errors.name ? 'true' : undefined} aria-describedby="name-help" class="big" />
					{#if errors.name}<span class="error-text" id="err-name">{errors.name}</span>{/if}
					<span id="name-help" class="help">
						Tävlingssidan blir <strong class="url">{page.data.siteHost}/{slug || '…'}</strong>
						{#if !editSlug}<button type="button" class="linkish" onclick={() => { editSlug = true; slugTyped = slug; }}>Ändra adress</button>{/if}
					</span>
				</div>
				{#if editSlug}
					<div class="field">
						<label for="slug">Adress</label>
						<div class="prefixed"><span aria-hidden="true">{page.data.siteHost}/</span><input id="slug" name="slug" bind:value={slugTyped} aria-invalid={errors.slug ? 'true' : undefined} aria-describedby={errors.slug ? 'err-slug' : undefined} /></div>
					</div>
				{/if}
				{#if errors.slug}<span class="error-text" id="err-slug">{errors.slug}</span>{/if}

				<fieldset class="fs">
					<legend class="label">Hur länge pågår tävlingen?</legend>
					<div class="choice2">
						<label class="choice" class:on={length === 'one'}>
							<input type="radio" name="length" value="one" bind:group={length} />
							<span class="ct">En dag</span>
							<span class="cd">Kontroller K1, K2, K3 …</span>
						</label>
						<label class="choice" class:on={length === 'multi'}>
							<input type="radio" name="length" value="multi" bind:group={length} />
							<span class="ct">Flera dagar</span>
							<span class="cd">Hajk, läger: kontroller per dag (FS, F1 … SM)</span>
						</label>
					</div>
				</fieldset>

				{#if length === 'one'}
					<div class="grid2">
						<div class="field">
							<label for="date">Datum</label>
							<input id="date" name="date" type="date" bind:value={date} aria-invalid={errors.date ? 'true' : undefined} aria-describedby={errors.date ? 'err-date' : undefined} />
							{#if errors.date}<span class="error-text" id="err-date">{errors.date}</span>{/if}
						</div>
					</div>
				{:else}
					<div class="grid2">
						<div class="field">
							<label for="startDate">Första dagen</label>
							<input id="startDate" name="startDate" type="date" bind:value={startDate} aria-invalid={errors.startDate ? 'true' : undefined} aria-describedby={errors.startDate ? 'err-startDate' : undefined} />
							{#if errors.startDate}<span class="error-text" id="err-startDate">{errors.startDate}</span>{/if}
						</div>
						<div class="field">
							<label for="endDate">Sista dagen</label>
							<input id="endDate" name="endDate" type="date" min={startDate || undefined} bind:value={endDate} aria-invalid={errors.endDate ? 'true' : undefined} aria-describedby={errors.endDate ? 'err-endDate' : undefined} />
							{#if errors.endDate}<span class="error-text" id="err-endDate">{errors.endDate}</span>{/if}
						</div>
					</div>
					{#if days.length}
						<div class="days">
							<span class="label">{days.length} dagar skapas. Prefixet används i kontrollkoderna.</span>
							<div class="day-list">
								{#each days as d (d.date)}
									<div class="day">
										<span class="day-t"><strong>{d.name}</strong><span>{shortDate(d.date)} · {codeExample(prefixFor(d))}</span></span>
										<label class="sr-only" for="prefix_{d.date}">Prefix för {d.name}</label>
										<input
											id="prefix_{d.date}"
											name="prefix_{d.date}"
											value={prefixFor(d)}
											oninput={(e) => (prefixes[d.date] = e.currentTarget.value.toUpperCase())}
											maxlength="3"
											class="prefix"
											aria-invalid={errors[`prefix_${d.date}`] ? 'true' : undefined}
										/>
									</div>
									{#if errors[`prefix_${d.date}`]}<span class="error-text">{d.name}: {errors[`prefix_${d.date}`]}</span>{/if}
								{/each}
							</div>
						</div>
					{/if}
				{/if}

				<div class="field">
					<label for="location">Plats</label>
					<input id="location" name="location" bind:value={location} placeholder="t.ex. Gökskogens lägerplats" />
				</div>
				<div class="field">
					<label for="hqPhone">Telefon till tävlingsledningen under dagen</label>
					<input id="hqPhone" name="hqPhone" type="tel" bind:value={hqPhone} placeholder="070-123 45 67" aria-describedby="hq-help" aria-invalid={errors.hqPhone ? 'true' : undefined} />
					{#if errors.hqPhone}<span class="error-text" id="err-hqPhone">{errors.hqPhone}</span>{/if}
					<span id="hq-help" class="help">Visas för funktionärer och ledare som ”Ring HQ”.</span>
				</div>
				<div class="field">
					<label for="owner">Arrangör</label>
					{#if data.groups.length}
						<select id="owner" name="owner" bind:value={owner} aria-invalid={errors.owner ? 'true' : undefined} aria-describedby="owner-help">
							{#each data.groups as g (g.groupNo)}<option value={g.groupNo}>{g.name}</option>{/each}
						</select>
						<span id="owner-help" class="help">Kåren eller distriktet som står bakom tävlingen. Hämtas från ditt Scoutnet-medlemskap.</span>
					{:else}
						<p class="muted">Ditt konto är inte kopplat till någon kår i Scoutnet, så du kan inte välja arrangör.</p>
					{/if}
					{#if errors.owner}<span class="error-text" id="err-owner">{errors.owner}</span>{/if}
				</div>
			</section>

			<section id="klasser" class="card sec" aria-labelledby="h-klasser">
				<span class="num">Steg {stepNo('klasser')}</span>
				<h2 id="h-klasser">Vilka klasser tävlar?</h2>
				<p class="muted lead">Varje patrull tävlar i en klass och får en egen resultatlista.</p>
				<fieldset class="fs">
					<legend class="sr-only">Klasser</legend>
					<div class="chips">
						{#each data.presets as t (t)}
							<label class="chip" class:on={tracks.includes(t)}>
								<input type="checkbox" name="track" value={t} checked={tracks.includes(t)} onchange={() => toggleTrack(t)} />
								<span class="ct">{t}</span>
								<span class="cd">{AGES[t]}</span>
							</label>
						{/each}
					</div>
				</fieldset>
				{#each customTracks as _, i (i)}
					<div class="custom">
						<div class="field grow">
							<label for="ct-{i}">Egen klass {i + 1}</label>
							<input id="ct-{i}" name="customTrack" bind:value={customTracks[i]} placeholder="t.ex. Ledare" maxlength="40" />
						</div>
						<button type="button" class="btn btn-ghost" onclick={() => (customTracks = customTracks.filter((_, j) => j !== i))} aria-label="Ta bort egen klass {i + 1}">Ta bort</button>
					</div>
				{/each}
				<div><button type="button" class="btn dashed" onclick={() => (customTracks = [...customTracks, ''])}>+ Egen klass</button></div>
				{#if errors.tracks}<span class="error-text" id="err-tracks">{errors.tracks}</span>{/if}
			</section>

			<section id="bana" class="card sec" aria-labelledby="h-bana">
				<span class="num">Steg {stepNo('bana')}</span>
				<h2 id="h-bana">Hur ser banan ut?</h2>
				<div class="counter-row">
					<label for="stations" class="label lg">Antal kontroller</label>
					<div class="counter">
						<button type="button" aria-label="Färre kontroller" onclick={() => (stations = Math.max(0, stations - 1))}>−</button>
						<input id="stations" name="stations" type="number" min="0" max="60" bind:value={stations} aria-invalid={errors.stations ? 'true' : undefined} aria-describedby={errors.stations ? 'err-stations' : undefined} />
						<button type="button" aria-label="Fler kontroller" onclick={() => (stations = Math.min(60, stations + 1))}>+</button>
					</div>
				</div>
				{#if errors.stations}<span class="error-text" id="err-stations">{errors.stations}</span>{/if}
				<div class="grid2">
					<div class="info strong">
						<span class="ik">Standard för alla kontroller</span>
						<span class="iv">Poäng 0–20{styleEnabled ? ' + stil 0–5' : ''}</span>
						<span class="muted small">Ändra per kontroll senare, t.ex. 0/5/10/15/20, flera delar eller checkpoint utan poäng.</span>
					</div>
					<div class="info">
						<span class="ik">Så skapas de</span>
						{#if length === 'multi' && days.length}
							<span class="iv">{days.length} × start + mål, ~{perDay} kontroller per dag</span>
							<span class="muted small">Varje dag får en start- och målcheckpoint ({days.map((d) => prefixFor(d) + 'S').join(', ')} …). Kontrollerna fördelas över dagarna.</span>
						{:else}
							<span class="iv">Kontroll 1 … Kontroll {stations || 0}</span>
							<span class="muted small">Får koderna K1, K2 … Byt namn och regler under Kontroller.</span>
						{/if}
					</div>
				</div>
				<div class="tint">
					<Toggle
						name="styleEnabled"
						bind:checked={styleEnabled}
						label="Använd stilpoäng"
						description="Extra poäng för samarbete och glädje. Av = stilpoäng försvinner överallt: funktionärens skärm, protokoll och resultat."
					/>
				</div>
			</section>

			<section id="anmalan" class="card sec" aria-labelledby="h-anmalan">
				<span class="num">Steg {stepNo('anmalan')}</span>
				<h2 id="h-anmalan">Anmälan och resultat</h2>
				<div class="toggles">
					<Toggle name="registrationOpen" bind:checked={registrationOpen} label="Öppna självanmälan" description="Patrulledare anmäler via tävlingssidan. Du kan också importera en fil." />
					<Toggle name="publicResults" bind:checked={publicResults} label="Publika resultat" description="Resultatlistan syns för alla under dagen. Av = spara spänningen till prisutdelningen." />
				</div>
			</section>

			<section class="card sec summary-card" aria-labelledby="h-sum" data-testid="wizard-summary">
				<h2 id="h-sum">Sammanfattning</h2>
				<dl class="sum">
					<dt>Tävling</dt><dd>{name.trim() || '–'} · <span class="url">{page.data.siteHost}/{slug || '…'}</span></dd>
					<dt>Serie</dt>
					<dd>
						{#if seriesMode === 'new'}Ny serie <strong>{seriesNameEff || '…'}</strong> · <span class="url">{page.data.siteHost}/{seriesSlug || '…'}</span>{#if editionYear} · upplaga {editionYear}{/if}{:else}Fristående{/if}
					</dd>
					<dt>Utseende</dt>
					<dd>Scouternas grundutseende. {seriesMode === 'new' ? 'Logga, färg och omslagsbild för serien lägger du till under Serien; alla år ärver dem.' : 'Logga, färg och omslagsbild lägger du till under Inställningar.'}</dd>
				</dl>
			</section>

			<div class="submit-row">
				<a class="btn" href="/admin">Avbryt</a>
				<button class="btn btn-accent big" type="submit" disabled={submitting}>
					{submitting ? 'Skapar …' : `Skapa ${name.trim() || 'tävlingen'}`}
				</button>
			</div>
			{/if}
		</form>
	</div>
</div>

<style>
	.page {
		max-width: 1180px;
		margin: 0 auto;
		padding: 28px 24px 64px;
		display: flex;
		flex-direction: column;
		gap: 28px;
	}
	.top {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 16px;
	}
	.brand {
		display: inline-flex;
		align-items: center;
		gap: 12px;
		text-decoration: none;
		color: var(--ink);
		font-family: var(--font-display);
		font-weight: 800;
		font-size: 22px;
	}
	.cancel {
		font-weight: 700;
	}
	.layout {
		display: flex;
		flex-wrap: wrap;
		gap: 28px;
		align-items: flex-start;
	}
	.steps {
		flex: 1 1 240px;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	@media (min-width: 900px) {
		.steps {
			position: sticky;
			top: 24px;
		}
	}
	.steps h1 {
		font-size: 40px;
		font-weight: 800;
		line-height: 1.02;
		letter-spacing: -0.03em;
		margin-bottom: 14px;
	}
	.steps ol {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.steps a {
		display: flex;
		gap: 14px;
		align-items: center;
		padding: 10px 12px;
		border-radius: var(--r-md);
		text-decoration: none;
		color: var(--ink);
	}
	.steps a:hover {
		background: var(--surface);
	}
	.dot {
		width: 30px;
		height: 30px;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		font-weight: 800;
		font-size: 14px;
		flex: none;
		background: var(--surface);
		border: 2px solid var(--line-strong);
		color: var(--ink-2);
	}
	.dot.done {
		background: var(--ok);
		border-color: var(--ok);
		color: #fff;
	}
	.err .dot {
		background: var(--danger);
		border-color: var(--danger);
		color: #fff;
	}
	.st {
		display: flex;
		flex-direction: column;
	}
	.st .t {
		font-weight: 800;
	}
	.st .d {
		font-size: 13px;
		color: var(--ink-2);
	}
	.hint {
		font-size: 14px;
		padding: 8px 12px;
	}
	.main {
		flex: 999 1 560px;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
	.sec {
		border-radius: var(--r-xl);
		padding: 28px 32px;
		display: flex;
		flex-direction: column;
		gap: 18px;
		scroll-margin-top: 20px;
	}
	.num {
		font-size: 12px;
		font-weight: 800;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--ink-2); /* green text on white is only 3.1:1 */
		margin-bottom: -10px;
	}
	.sec h2 {
		font-size: 28px;
		font-weight: 800;
	}
	.lead {
		margin: -6px 0 0;
	}
	input.big {
		min-height: 52px;
		font-size: 18px;
	}
	.help {
		font-size: 13px;
		color: var(--ink-2);
	}
	.url {
		color: var(--ink);
	}
	.linkish {
		border: 0;
		background: none;
		padding: 0 4px;
		color: var(--brand);
		text-decoration: underline;
		font-weight: 700;
		cursor: pointer;
		font-size: 13px;
	}
	.prefixed {
		display: flex;
		align-items: center;
		border: 1.5px solid var(--line-strong);
		border-radius: var(--r-sm);
		background: var(--surface);
		padding-left: 12px;
	}
	.prefixed span {
		color: var(--ink-2);
		white-space: nowrap;
	}
	.prefixed input {
		border: 0;
		padding-left: 2px;
		min-width: 0;
	}
	.fs {
		border: 0;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.fs legend {
		padding: 0;
		margin-bottom: 8px;
	}
	.choice2,
	.grid2 {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr));
		gap: 12px;
	}
	.choice,
	.chip {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 12px 16px;
		border-radius: var(--r-md);
		border: 1.5px solid var(--line-strong);
		background: var(--surface);
		cursor: pointer;
		min-height: 64px;
		justify-content: center;
	}
	.choice input,
	.chip input {
		position: absolute;
		opacity: 0;
		inset: 0;
		margin: 0;
		cursor: pointer;
	}
	.choice:has(input:focus-visible),
	.chip:has(input:focus-visible) {
		outline: 3px solid var(--orange);
		outline-offset: 2px;
	}
	.choice.on,
	.chip.on {
		background: var(--brand);
		border-color: var(--brand);
		color: #fff;
	}
	/* Text sits above the full-size invisible input; let taps fall through to it. */
	.choice > span,
	.chip > span {
		pointer-events: none;
	}
	.ct {
		font-weight: 800;
		font-size: 16px;
	}
	.cd {
		font-size: 13px;
		opacity: 0.85;
	}
	.choice3 {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 200px), 1fr));
		gap: 12px;
	}
	.choice.off {
		opacity: 0.55;
		cursor: not-allowed;
	}
	.series-list {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr));
		gap: 10px;
	}
	.summary {
		display: flex;
		flex-direction: column;
		gap: 12px;
		border: 1.5px solid var(--brand);
		border-radius: var(--r-md);
		padding: 16px;
	}
	.summary p {
		margin: 0;
	}
	.summary .btn {
		text-align: center;
	}
	.note {
		background: var(--tint);
		border-radius: var(--r-md);
		padding: 12px 14px;
		font-weight: 600;
	}
	.inherit {
		display: flex;
		flex-direction: column;
		gap: 8px;
		background: var(--ground);
		border-radius: var(--r-md);
		padding: 12px 14px;
	}
	.inherit-row {
		display: flex;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
	}
	.logo {
		height: 40px;
		width: auto;
		max-width: 120px;
		object-fit: contain;
	}
	.swatch {
		width: 28px;
		height: 28px;
		border-radius: 50%;
		border: 1px solid var(--line);
		flex: none;
	}
	.classes {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 6px 14px;
		font-size: 14px;
	}
	.classes li {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}
	.dot-c {
		width: 14px;
		height: 14px;
		border-radius: 50%;
	}
	.sum {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: 8px 16px;
		margin: 0;
	}
	.sum dt {
		font-weight: 800;
	}
	.sum dd {
		margin: 0;
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
	}
	.chip {
		flex: 0 1 auto;
		min-width: 140px;
	}
	.days {
		display: flex;
		flex-direction: column;
		gap: 10px;
		background: var(--ground);
		border-radius: var(--r-md);
		padding: 14px;
	}
	.day-list {
		display: flex;
		gap: 10px;
		flex-wrap: wrap;
	}
	.day {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		background: var(--surface);
		border: 1.5px solid var(--line-strong);
		border-radius: var(--r-md);
		padding: 6px 6px 6px 12px;
	}
	.day-t {
		display: flex;
		flex-direction: column;
		font-size: 14px;
	}
	.day-t span {
		font-size: 12px;
		color: var(--ink-2);
	}
	input.prefix {
		width: 52px;
		min-height: 42px;
		text-align: center;
		font-weight: 800;
		font-size: 17px;
		border-color: var(--brand);
		padding: 0 4px;
	}
	.custom {
		display: flex;
		align-items: flex-end;
		gap: 8px;
	}
	.grow {
		flex: 1;
	}
	.dashed {
		border-style: dashed;
		color: var(--brand);
	}
	.counter-row {
		display: flex;
		align-items: center;
		gap: 18px;
		flex-wrap: wrap;
	}
	.lg {
		font-size: 16px;
	}
	.counter {
		display: flex;
		align-items: center;
		gap: 4px;
		background: var(--tint);
		border-radius: var(--r-md);
		padding: 4px;
	}
	.counter button {
		width: 48px;
		height: 48px;
		border-radius: var(--r-sm);
		border: 0;
		background: var(--surface);
		font-size: 24px;
		font-weight: 800;
		cursor: pointer;
	}
	.counter input {
		width: 80px;
		border: 0;
		background: transparent;
		text-align: center;
		font-family: var(--font-display);
		font-weight: 800;
		font-size: 30px;
		appearance: textfield;
		-moz-appearance: textfield;
	}
	.counter input::-webkit-inner-spin-button {
		appearance: none;
	}
	.info {
		border: 1px solid var(--line);
		border-radius: var(--r-md);
		padding: 16px;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.info.strong {
		border: 1.5px solid var(--brand);
	}
	.ik {
		font-size: 12px;
		font-weight: 800;
		color: var(--brand);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	.iv {
		font-weight: 800;
		font-size: 19px;
	}
	.small {
		font-size: 14px;
	}
	.tint {
		background: var(--ground);
		border-radius: var(--r-md);
		padding: 4px 16px;
	}
	.toggles :global(.toggle + .toggle) {
		border-top: 1px solid var(--line);
	}
	.submit-row {
		display: flex;
		justify-content: flex-end;
		gap: 12px;
		flex-wrap: wrap;
	}
	.btn.big {
		min-height: 56px;
		padding: 0 28px;
		font-size: 17px;
	}
	.form-error {
		color: var(--danger);
		font-weight: 700;
		background: var(--danger-tint);
		border-color: #f3c3bd;
		margin: 0;
	}
	[aria-invalid='true'] {
		border-color: var(--danger);
	}
	@media (max-width: 600px) {
		.page {
			padding: 18px 16px 48px;
		}
		.sec {
			padding: 22px 18px;
		}
		.steps h1 {
			font-size: 30px;
		}
		.steps ol {
			flex-direction: row;
			flex-wrap: wrap;
		}
		.steps .d {
			display: none;
		}
		.steps a {
			padding: 6px 8px;
			gap: 8px;
		}
		.sum {
			grid-template-columns: 1fr;
			gap: 2px;
		}
		.sum dd {
			margin-bottom: 8px;
		}
	}
</style>

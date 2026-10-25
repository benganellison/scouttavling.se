<script lang="ts">
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import Toggle from '#lib/ui/admin/Toggle.svelte';
	import { shortDate } from '#lib/ui/admin/format.ts';
	import ColorField from '#lib/ui/brand/ColorField.svelte';
	import EventLogo from '#lib/ui/brand/EventLogo.svelte';
	import ScouternaLogo from '#lib/ui/brand/ScouternaLogo.svelte';
	import TrackChip from '#lib/ui/brand/TrackChip.svelte';
	import ScouternaSymbol from '#lib/ui/brand/ScouternaSymbol.svelte';
	import { SCOUTBLA, parseHex, readableText, trackColors } from '#lib/brand/colors.ts';
	import { effectiveCoverFit, type AssetKind } from '#lib/brand/branding.ts';

	let { data, form } = $props();

	const c = $derived(data.competition);
	const errs = (section: string): Record<string, string> => (form && form.section === section && 'errors' in form ? (form.errors as Record<string, string>) : {});
	const ok = (section: string) => Boolean(form && form.section === section && 'ok' in form && form.ok);
	const ROLE: Record<string, string> = { owner: 'Ägare', organiser: 'Arrangör', hq: 'Ledningscentral', startfinish: 'Start & mål' };
	const keep = () => async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) => update({ reset: false });
	const ownerOptions = $derived(
		data.groups.some((g) => g.groupNo === c.ownerGroupNo) || !c.ownerGroupNo
			? data.groups
			: [{ groupNo: c.ownerGroupNo, name: c.ownerGroupName ?? c.ownerGroupNo }, ...data.groups]
	);
	const eB = $derived(errs('basics'));
	const eD = $derived(errs('days'));
	const eT = $derived(errs('tracks'));
	const eM = $derived(errs('members'));
	const eR = $derived(errs('registration'));
	const canEdit = $derived(data.roles.includes('owner') || data.roles.includes('organiser'));
	const eA = $derived(errs('appearance'));

	/** What "Standard" would give each class (its own colour ignored, the others kept). */
	const trackDefault = (id: string) => trackColors(data.tracks.map((t) => (t.id === id ? { ...t, color: null } : t)))[id];

	// Live preview state for the accent (the saved value until the organiser picks another).
	let accent = $state(untrack(() => data.competition.accentColor ?? ''));
	// Follow the saved value after a save (or another organiser's change).
	let savedAccent = $state(untrack(() => data.competition.accentColor ?? ''));
	$effect(() => {
		const v = c.accentColor ?? '';
		if (v !== untrack(() => savedAccent)) {
			savedAccent = v;
			accent = v;
		}
	});
	const accentHex = $derived(parseHex(accent) ?? SCOUTBLA);
	const accentCustom = $derived(!!parseHex(accent));
	const stripe = $derived(accentCustom ? accentHex : 'var(--orange)');
	const chipText = $derived(readableText(accentHex).text);
	const b = $derived(data.branding);
	let fit = $state<string>(untrack(() => data.competition.coverFit ?? ''));
	const previewFit = $derived(fit === 'contain' || fit === 'cover' ? fit : effectiveCoverFit(null, b.cover));
	const IMAGES: { kind: AssetKind; title: string; help: string }[] = [
		{ kind: 'event_logo', title: 'Tävlingens logga', help: 'Visas i sidhuvudet på tävlingssidan, funktionärernas telefoner, utskrifter och i menyn här.' },
		{ kind: 'organiser_logo', title: 'Arrangörens logga', help: 'Kårens eller distriktets logga. Visas i sidfoten bredvid Scouternas logga.' },
		{ kind: 'cover', title: 'Omslagsbild', help: 'Stor bild överst på tävlingssidan. Ingen text läggs ovanpå bilden.' }
	];
	const current = (k: AssetKind) => (k === 'event_logo' ? b.eventLogo : k === 'organiser_logo' ? b.organiserLogo : b.cover);
</script>

<svelte:head><title>Inställningar · {c.name}</title></svelte:head>

<header class="head">
	<h1>Inställningar</h1>
	<span class="muted">Adress: <strong>scouttavling.se/{c.slug}</strong></span>
</header>
{#if !canEdit}<p class="pill pill-warn">Du kan se men inte ändra inställningarna.</p>{/if}

<section class="card sec" aria-labelledby="h-basics">
	<h2 id="h-basics">Grundinfo</h2>
	<form method="POST" action="?/basics" class="stack" use:enhance={keep} novalidate>
		
		<div class="field">
			<label for="name">Namn</label>
			<input id="name" name="name" value={c.name} aria-invalid={eB.name ? 'true' : undefined} />
			{#if eB.name}<span class="error-text">{eB.name}</span>{/if}
		</div>
		<div class="grid2">
			{#if !c.multiDay}
				<div class="field">
					<label for="date">Datum</label>
					<input id="date" name="date" type="date" value={c.startDate} aria-invalid={eB.date ? 'true' : undefined} />
					{#if eB.date}<span class="error-text">{eB.date}</span>{/if}
				</div>
			{/if}
			<div class="field">
				<label for="location">Plats</label>
				<input id="location" name="location" value={c.location ?? ''} />
			</div>
			<div class="field">
				<label for="hqPhone">Telefon till tävlingsledningen</label>
				<input id="hqPhone" name="hqPhone" type="tel" value={c.hqPhone ?? ''} aria-invalid={eB.hqPhone ? 'true' : undefined} />
				{#if eB.hqPhone}<span class="error-text">{eB.hqPhone}</span>{/if}
			</div>
			<div class="field">
				<label for="owner">Arrangör</label>
				<select id="owner" name="owner" value={c.ownerGroupNo ?? ''} aria-invalid={eB.owner ? 'true' : undefined}>
					{#each ownerOptions as g (g.groupNo)}<option value={g.groupNo}>{g.name}</option>{/each}
				</select>
				{#if eB.owner}<span class="error-text">{eB.owner}</span>{/if}
			</div>
		</div>
		<div class="toggles">
			<Toggle name="styleEnabled" checked={c.styleEnabled} label="Använd stilpoäng" description="Av = stilpoäng försvinner på funktionärens skärm, protokoll och resultat." />
			<Toggle name="publicResults" checked={c.publicResults} label="Publika resultat" description="Resultatlistan syns för alla under dagen." />
		</div>
		<div class="act">
			<button class="btn btn-primary" disabled={!canEdit}>Spara grundinfo</button>
			{#if ok('basics')}<span class="pill pill-ok" role="status">Sparat</span>{/if}
		</div>
	</form>
</section>

<section class="card sec" id="anmalan" aria-labelledby="h-reg">
	<div class="sec-head">
		<h2 id="h-reg">Anmälan och tävlingssida</h2>
		<a class="btn btn-ghost sm" href="/t/{c.slug}" target="_blank" rel="noopener">Visa tävlingssidan</a>
	</div>
	<p class="muted lead">Tävlingssidan <strong>scouttavling.se/t/{c.slug}</strong> syns för alla när tävlingen inte är ett utkast.</p>
	<form method="POST" action="?/registration" class="stack" use:enhance={keep} novalidate>
		<div class="toggles">
			<Toggle name="registrationOpen" checked={c.registrationOpen} label="Öppen självanmälan" description="Patrulledare kan anmäla via tävlingssidan." />
		</div>
		<div class="grid2">
			<div class="field">
				<label for="registrationOpensOn">Anmälan öppnar</label>
				<input id="registrationOpensOn" name="registrationOpensOn" type="date" value={c.registrationOpensOn ?? ''} aria-invalid={eR.registrationOpensOn ? 'true' : undefined} />
				{#if eR.registrationOpensOn}<span class="error-text">{eR.registrationOpensOn}</span>{:else}<span class="muted small">Tomt = direkt</span>{/if}
			</div>
			<div class="field">
				<label for="registrationClosesOn">Sista anmälningsdag</label>
				<input id="registrationClosesOn" name="registrationClosesOn" type="date" value={c.registrationClosesOn ?? ''} aria-invalid={eR.registrationClosesOn ? 'true' : undefined} />
				{#if eR.registrationClosesOn}<span class="error-text">{eR.registrationClosesOn}</span>{:else}<span class="muted small">Tomt = till och med tävlingsdagen</span>{/if}
			</div>
			<div class="field">
				<label for="maxPatrols">Max antal patruller</label>
				<input id="maxPatrols" name="maxPatrols" inputmode="numeric" value={c.maxPatrols ?? ''} placeholder="Obegränsat" aria-invalid={eR.maxPatrols ? 'true' : undefined} />
				{#if eR.maxPatrols}<span class="error-text">{eR.maxPatrols}</span>{/if}
			</div>
		</div>
		<div class="field">
			<label for="infoText">Information på tävlingssidan</label>
			<textarea id="infoText" name="infoText" rows="5" maxlength="4000" placeholder="Samlingstid, vad patrullerna ska ta med, startavgift …" aria-invalid={eR.infoText ? 'true' : undefined}>{c.infoText ?? ''}</textarea>
			{#if eR.infoText}<span class="error-text">{eR.infoText}</span>{/if}
		</div>
		<div class="field">
			<label for="confirmationText">Text i bekräftelsen</label>
			<textarea id="confirmationText" name="confirmationText" rows="3" maxlength="1000" placeholder="Visas när en patrull har anmält sig, t.ex. hur avgiften betalas." aria-invalid={eR.confirmationText ? 'true' : undefined}>{c.confirmationText ?? ''}</textarea>
			{#if eR.confirmationText}<span class="error-text">{eR.confirmationText}</span>{/if}
		</div>
		<div class="toggles">
			<Toggle name="followEnabled" checked={c.followEnabled} label="Följ patrullen" description="Ledare och föräldrar kan följa sin patrull live via patrullens egen länk." />
			<Toggle name="followShowScores" checked={c.followShowScores} label="Visa poäng och placering" description="Av = följ-sidan visar bara vilka kontroller patrullen klarat." />
		</div>
		<div class="act">
			<button class="btn btn-primary" disabled={!canEdit}>Spara anmälan</button>
			{#if ok('registration')}<span class="pill pill-ok" role="status">Sparat</span>{/if}
		</div>
	</form>
</section>

<section class="card sec" id="utseende" aria-labelledby="h-look">
	<h2 id="h-look">Utseende</h2>
	<p class="muted lead">Grunden följer Scouternas grafiska profil. Tävlingens egen logga, färg och bild syns på tävlingssidan, patrullpasset, följ-sidan, resultaten, funktionärernas telefoner och utskrifterna. Scouternas logga står alltid med som avsändare.</p>

	<form method="POST" action="?/appearance" class="stack" use:enhance={keep} novalidate>
		<ColorField id="accentColor" name="accentColor" label="Tävlingens färg" bind:value={accent} fallback={SCOUTBLA} fallbackLabel="Scoutblå (standard)" showContrast disabled={!canEdit} />
		{#if eA.accentColor}<span class="error-text">{eA.accentColor}</span>{/if}
		<p class="muted small">Färgen används som rand och markering. Sidhuvuden och knappar är alltid Scoutblå, så Scouterna syns tydligt.</p>
		<fieldset class="fit" disabled={!canEdit}>
			<legend class="label">Omslagsbild</legend>
			<label><input type="radio" name="coverFit" value="" bind:group={fit} /> Automatiskt <span class="muted small">(breda banderoller visas hela)</span></label>
			<label><input type="radio" name="coverFit" value="contain" bind:group={fit} /> Visa hela bilden <span class="muted small">(text i bilden beskärs aldrig)</span></label>
			<label><input type="radio" name="coverFit" value="cover" bind:group={fit} /> Fyll ytan (beskär)</label>
		</fieldset>
		<div class="act">
			<button class="btn btn-primary" disabled={!canEdit}>Spara utseende</button>
			{#if ok('appearance') && !(form && 'uploaded' in form)}<span class="pill pill-ok" role="status">Sparat</span>{/if}
		</div>
	</form>

	<div class="imgs">
		{#each IMAGES as im (im.kind)}
			{@const cur = current(im.kind)}
			<div class="img" data-testid="img-{im.kind}">
				<div class="img-prev" class:cover={im.kind === 'cover'}>
					{#if cur}<img src={cur.url} alt={cur.alt} />{:else}<span class="muted small">Ingen bild</span>{/if}
				</div>
				<div class="img-txt">
					<strong>{im.title}</strong>
					<span class="muted small">{im.help}</span>
					<form method="POST" action="?/upload" enctype="multipart/form-data" class="up" use:enhance>
						<input type="hidden" name="kind" value={im.kind} />
						<label class="sr-only" for="file-{im.kind}">Välj bild: {im.title}</label>
						<input id="file-{im.kind}" type="file" name="file" accept="image/png,image/jpeg,image/webp" disabled={!canEdit} />
						<button class="btn sm" disabled={!canEdit}>{cur ? 'Byt bild' : 'Ladda upp'}</button>
					</form>
					{#if cur}
						<form method="POST" action="?/removeImage" use:enhance>
							<input type="hidden" name="kind" value={im.kind} />
							<button class="btn btn-ghost rm sm" disabled={!canEdit}>Ta bort {im.title.toLowerCase()}</button>
						</form>
					{/if}
					{#if eA[im.kind]}<span class="error-text" role="alert">{eA[im.kind]}</span>{/if}
					{#if form && 'uploaded' in form && form.uploaded === im.kind}<span class="pill pill-ok" role="status">Uppladdad</span>{/if}
				</div>
			</div>
		{/each}
		<p class="muted small">PNG, JPEG eller WebP, högst 2 MB. SVG går inte (av säkerhetsskäl). Bildinformation som plats och kamera tas bort vid uppladdning.</p>
	</div>

	<div class="previews" aria-label="Förhandsvisning">
		<div class="pv-web">
			<span class="pv-label">Tävlingssidan</span>
			<div class="pv-frame" data-testid="preview-public">
				{#if b.cover}<img class="pv-cover {previewFit}" src={b.cover.url} alt="" data-testid="preview-cover" />{/if}
				<div class="pv-top" style="border-bottom-color:{accentCustom ? accentHex : 'transparent'}">
					<div class="pv-brand">
						{#if b.eventLogo}<EventLogo logo={b.eventLogo} height={30} onDark />{:else}<ScouternaSymbol size={22} onDark />{/if}
						<span>{c.name}</span>
					</div>
					{#if chipText && accentCustom}<span class="pv-chip" style="background:{accentHex};color:{chipText}">Anmälan öppen</span>{/if}
				</div>
				<div class="pv-foot">
					{#if b.organiserLogo}<img class="pv-org" src={b.organiserLogo.url} alt="" />{/if}
					<span class="small">Arrangeras av {c.ownerGroupName ?? '…'} · Scouterna</span>
				</div>
			</div>
		</div>
		<div class="pv-phone">
			<span class="pv-label">Funktionärens telefon</span>
			<div class="pv-ph" data-testid="preview-phone" style="border-top-color:{stripe}">
				<div class="pv-ph-top">
					{#if b.eventLogo}<EventLogo logo={b.eventLogo} height={24} />{/if}
					<span class="small muted">Hej Anna · {c.name}</span>
				</div>
				<strong class="pv-ph-h">K3 · Kojbygge</strong>
				<span class="pv-ph-btn">Skanna patrull</span>
			</div>
		</div>
	</div>
	<div class="sender-row">
		<span class="muted small">Avsändare i sidfoten:</span>
		<ScouternaLogo tagline />
	</div>
</section>

{#if c.multiDay}
	<section class="card sec" aria-labelledby="h-days">
		<h2 id="h-days">Dagar</h2>
		<p class="muted lead">Prefixet används i kontrollkoderna, t.ex. F → FS, F1 … FM.</p>
		
		<form method="POST" action="?/days" class="stack" use:enhance={keep} novalidate id="days-form">
			<ul class="days">
				{#each data.days as d (d.id)}
					<li class="day">
						<div class="field">
							<label for="date_{d.id}">Datum</label>
							<input id="date_{d.id}" name="date_{d.id}" type="date" value={d.date} aria-invalid={eD[`date_${d.id}`] ? 'true' : undefined} />
						</div>
						<div class="field grow">
							<label for="name_{d.id}">Namn</label>
							<input id="name_{d.id}" name="name_{d.id}" value={d.name} aria-invalid={eD[`name_${d.id}`] ? 'true' : undefined} />
						</div>
						<div class="field pre">
							<label for="prefix_{d.id}">Prefix</label>
							<input id="prefix_{d.id}" name="prefix_{d.id}" value={d.prefix} maxlength="3" class="prefix" aria-invalid={eD[`prefix_${d.id}`] ? 'true' : undefined} />
						</div>
						<button
							class="btn btn-ghost rm"
							formaction="?/removeDay"
							name="id"
							value={d.id}
							disabled={!canEdit || data.days.length <= 2 || (data.dayStations[d.id] ?? 0) > 0}
							title={(data.dayStations[d.id] ?? 0) > 0 ? `${data.dayStations[d.id]} kontroller på dagen` : undefined}
							aria-label="Ta bort {d.name} {shortDate(d.date)}">Ta bort</button
						>
						{#each ['date', 'name', 'prefix'] as k (k)}
							{#if eD[`${k}_${d.id}`]}<span class="error-text full">{d.name}: {eD[`${k}_${d.id}`]}</span>{/if}
						{/each}
					</li>
				{/each}
			</ul>
			{#if eD.days}<span class="error-text" role="alert">{eD.days}</span>{/if}
			<div class="act">
				<button class="btn btn-primary" disabled={!canEdit}>Spara dagar</button>
				<button class="btn" formaction="?/addDay" disabled={!canEdit}>+ Lägg till dag</button>
				{#if ok('days')}<span class="pill pill-ok" role="status">Sparat</span>{/if}
			</div>
		</form>
	</section>
{/if}

<section class="card sec" id="klasser" aria-labelledby="h-tracks">
	<h2 id="h-tracks">Klasser</h2>
	<p class="muted lead">Varje patrull tävlar i en klass och får en egen resultatlista. Klassfärgen är en markering i listor, diagram och utskrifter (aldrig textfärg). Spårare–Rover får åldersgruppens färg och Ledare Scoutblå automatiskt.</p>
	
	<form method="POST" action="?/tracks" class="stack" use:enhance={keep} novalidate>
		<ul class="tracks">
			{#each data.tracks as t (t.id)}
				<li>
					<TrackChip color={parseHex(t.color) ?? data.trackColors[t.id]} size={22} />
					<div class="field grow">
						<label for="track_{t.id}" class="sr-only">Namn på klass</label>
						<input id="track_{t.id}" name="track_{t.id}" value={t.name} aria-invalid={eT[`track_${t.id}`] ? 'true' : undefined} />
					</div>
					<span class="muted small">{data.trackPatrols[t.id] ?? 0} patruller</span>
					<button class="btn btn-ghost rm" formaction="?/removeTrack" name="id" value={t.id} disabled={!canEdit || (data.trackPatrols[t.id] ?? 0) > 0} aria-label="Ta bort klassen {t.name}">Ta bort</button>
					<div class="full">
						<ColorField id="color-{t.id}" name="color_{t.id}" label="Färg för {t.name}" value={t.color ?? ''} fallback={trackDefault(t.id)} compact disabled={!canEdit} />
					</div>
					{#if eT[`track_${t.id}`]}<span class="error-text full">{eT[`track_${t.id}`]}</span>{/if}
				</li>
			{/each}
		</ul>
		<div class="field">
			<label for="newTrack">Ny klass</label>
			<input id="newTrack" name="newTrack" placeholder="t.ex. Rover" aria-invalid={eT.newTrack ? 'true' : undefined} />
			{#if eT.newTrack}<span class="error-text">{eT.newTrack}</span>{/if}
		</div>
		{#if eT.tracks}<span class="error-text" role="alert">{eT.tracks}</span>{/if}
		<div class="act">
			<button class="btn btn-primary" disabled={!canEdit}>Spara klasser</button>
			{#if ok('tracks')}<span class="pill pill-ok" role="status">Sparat</span>{/if}
		</div>
	</form>
</section>

<section class="card sec" aria-labelledby="h-members">
	<h2 id="h-members">Arrangörer</h2>
	<p class="muted lead">Medarrangörer kan ändra allt utom ägarskapet. De loggar in med ScoutID.</p>
	
	<ul class="members">
		{#each data.members as m (m.userId + m.role)}
			<li>
				<span class="mn"><strong>{m.name}</strong><span class="muted small">Medlemsnr {m.memberNo}</span></span>
				<span class="pill">{ROLE[m.role] ?? m.role}</span>
				{#if m.role === 'organiser' && m.userId !== data.user.id && canEdit}
					<form method="POST" action="?/removeMember" use:enhance>
						<input type="hidden" name="userId" value={m.userId} />
						<button class="btn btn-ghost rm" aria-label="Ta bort {m.name} som arrangör">Ta bort</button>
					</form>
				{/if}
			</li>
		{/each}
	</ul>
	{#if eM.members}<span class="error-text">{eM.members}</span>{/if}
	<form method="POST" action="?/invite" class="invite" use:enhance novalidate>
		<div class="field grow">
			<label for="memberNo">Bjud in med medlemsnummer</label>
			<input id="memberNo" name="memberNo" inputmode="numeric" value={form && form.section === 'members' && 'memberNo' in form ? form.memberNo : ''} placeholder="t.ex. 3000002" aria-invalid={eM.memberNo ? 'true' : undefined} aria-describedby="mn-help" />
		</div>
		<button class="btn btn-accent" disabled={!canEdit}>Lägg till arrangör</button>
		<span id="mn-help" class="muted small full">Personen måste ha loggat in på scouttavling.se minst en gång.</span>
		{#if eM.memberNo}<span class="error-text full" role="alert">{eM.memberNo}</span>{/if}
		{#if form && form.section === 'members' && 'added' in form && form.added}<span class="pill pill-ok full" role="status">{form.added} är nu arrangör</span>{/if}
	</form>
</section>

<style>
	.head {
		display: flex;
		align-items: baseline;
		gap: 16px;
		flex-wrap: wrap;
		justify-content: space-between;
	}
	h1 {
		font-size: 34px;
		font-weight: 800;
		letter-spacing: -0.03em;
	}
	.sec {
		border-radius: 20px;
		padding: 24px;
		display: flex;
		flex-direction: column;
		gap: 14px;
		max-width: 860px;
		scroll-margin-top: 16px;
	}
	.sec h2 {
		font-size: 22px;
		font-weight: 800;
	}
	.lead {
		margin: -8px 0 0;
	}
	.sec-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
	}
	.sm {
		min-height: 40px;
		font-size: 14px;
	}
	.grid2 {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr));
		gap: 14px;
	}
	.toggles :global(.toggle + .toggle) {
		border-top: 1px solid var(--line);
	}
	.act {
		display: flex;
		gap: 10px;
		align-items: center;
		flex-wrap: wrap;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.day,
	.tracks li,
	.members li {
		display: flex;
		gap: 10px;
		align-items: flex-end;
		flex-wrap: wrap;
	}
	.tracks li,
	.members li {
		align-items: center;
	}
	.members li {
		padding: 10px 0;
		border-top: 1px solid var(--line);
		gap: 12px;
	}
	.mn {
		display: flex;
		flex-direction: column;
		flex: 1;
	}
	.grow {
		flex: 1 1 180px;
	}
	.pre {
		width: 80px;
	}
	.prefix {
		text-align: center;
		font-weight: 800;
		text-transform: uppercase;
	}
	.rm {
		color: var(--danger);
	}
	.small {
		font-size: 13px;
	}
	.full {
		flex-basis: 100%;
	}
	.invite {
		display: flex;
		gap: 10px;
		align-items: flex-end;
		flex-wrap: wrap;
	}
	.tracks li {
		padding-bottom: 10px;
		border-bottom: 1px solid var(--line);
	}
	.imgs {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.img {
		display: flex;
		gap: 14px;
		align-items: flex-start;
		flex-wrap: wrap;
		padding: 12px 0;
		border-top: 1px solid var(--line);
	}
	.img-prev {
		width: 120px;
		height: 72px;
		border: 1px solid var(--line);
		border-radius: 10px;
		background: var(--tint);
		display: grid;
		place-items: center;
		overflow: hidden;
		flex: none;
	}
	.img-prev img {
		max-width: 100%;
		max-height: 100%;
		object-fit: contain;
	}
	.img-prev.cover img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.img-txt {
		display: flex;
		flex-direction: column;
		gap: 6px;
		flex: 1 1 260px;
		min-width: 0;
	}
	.up {
		display: flex;
		gap: 8px;
		align-items: center;
		flex-wrap: wrap;
	}
	.up input[type='file'] {
		max-width: 100%;
		font-size: 14px;
	}
	.previews {
		display: flex;
		gap: 18px;
		flex-wrap: wrap;
		align-items: flex-start;
	}
	.pv-label {
		display: block;
		font-size: 12px;
		font-weight: 800;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--ink-2);
		margin-bottom: 6px;
	}
	.pv-web {
		flex: 1 1 320px;
		min-width: 0;
	}
	.pv-frame {
		border: 1px solid var(--line);
		border-radius: 14px;
		overflow: hidden;
		background: var(--ground);
	}
	.pv-cover {
		display: block;
		width: 100%;
		height: 90px;
		object-fit: cover;
		background: var(--brand);
	}
	.pv-cover.contain {
		object-fit: contain;
	}
	.fit {
		border: 0;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.fit label {
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: 40px;
	}
	.pv-top {
		background: var(--brand);
		color: #fff;
		padding: 12px 14px;
		border-bottom: 5px solid transparent;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.pv-brand {
		display: flex;
		align-items: center;
		gap: 8px;
		font-weight: 800;
	}
	.pv-chip {
		align-self: flex-start;
		font-size: 12px;
		font-weight: 800;
		padding: 3px 10px;
		border-radius: 999px;
	}
	.pv-foot {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 10px 14px;
		color: var(--ink-2);
	}
	.pv-org {
		height: 24px;
		width: auto;
	}
	.pv-phone {
		flex: 0 0 200px;
	}
	.pv-ph {
		width: 200px;
		border: 2px solid var(--ink);
		border-top: 6px solid var(--orange);
		border-radius: 18px;
		background: var(--ground);
		padding: 10px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.pv-ph-top {
		display: flex;
		gap: 6px;
		align-items: center;
		min-width: 0;
	}
	.pv-ph-top span {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.pv-ph-h {
		font-family: var(--font-display);
		font-size: 18px;
	}
	.pv-ph-btn {
		background: var(--brand);
		color: #fff;
		border-radius: 12px;
		padding: 12px;
		text-align: center;
		font-weight: 800;
		font-size: 14px;
	}
	.sender-row {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
	}
	[aria-invalid='true'] {
		border-color: var(--danger);
	}
</style>

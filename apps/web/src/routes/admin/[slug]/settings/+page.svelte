<script lang="ts">
	import { page } from '$app/state';
	import { enhance } from '$app/forms';
	import Toggle from '#lib/ui/admin/Toggle.svelte';
	import { shortDate } from '#lib/ui/admin/format.ts';
	import ColorField from '#lib/ui/brand/ColorField.svelte';
	import BrandingEditor from '#lib/ui/admin/BrandingEditor.svelte';
	import TrackChip from '#lib/ui/brand/TrackChip.svelte';
	import { parseHex, trackColors } from '#lib/brand/colors.ts';
	import MembersPanel from '#lib/ui/admin/MembersPanel.svelte';
	import AuditList from '#lib/ui/admin/AuditList.svelte';

	let { data, form } = $props();

	const c = $derived(data.competition);
	const errs = (section: string): Record<string, string> => (form && form.section === section && 'errors' in form ? (form.errors as Record<string, string>) : {});
	const ok = (section: string) => Boolean(form && form.section === section && 'ok' in form && form.ok);
	const keep = () => async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) => update({ reset: false });
	const ownerOptions = $derived(
		data.groups.some((g) => g.groupNo === c.ownerGroupNo) || !c.ownerGroupNo
			? data.groups
			: [{ groupNo: c.ownerGroupNo, name: c.ownerGroupName ?? c.ownerGroupNo }, ...data.groups]
	);
	const eB = $derived(errs('basics'));
	const eD = $derived(errs('days'));
	const eT = $derived(errs('tracks'));
	const eR = $derived(errs('registration'));
	const canEdit = $derived(data.roles.includes('owner') || data.roles.includes('organiser'));
	const eA = $derived(errs('appearance'));

	/** What "Standard" would give each class (its own colour ignored, the others kept). */
	const trackDefault = (id: string) => trackColors(data.tracks.map((t) => (t.id === id ? { ...t, color: null } : t)), data.classTemplate)[id];

</script>

<svelte:head><title>Inställningar · {c.name}</title></svelte:head>

<header class="head">
	<h1>Inställningar</h1>
	<span class="muted">Adress: <strong>{page.data.siteHost}/{c.slug}</strong></span>
</header>
{#if !canEdit}<p class="pill pill-warn">Du kan se men inte ändra inställningarna.</p>{/if}

<section class="card sec" aria-labelledby="h-basics">
	<h2 id="h-basics">Grundinfo</h2>
	<form method="POST" action="?/basics" class="stack" use:enhance={keep} novalidate>
		
		<div class="field">
			<label for="name">Namn</label>
			<input id="name" name="name" value={c.name} aria-invalid={eB.name ? 'true' : undefined} aria-describedby={eB.name ? 'err-name' : undefined} />
			{#if eB.name}<span class="error-text" id="err-name">{eB.name}</span>{/if}
		</div>
		<div class="grid2">
			{#if !c.multiDay}
				<div class="field">
					<label for="date">Datum</label>
					<input id="date" name="date" type="date" value={c.startDate} aria-invalid={eB.date ? 'true' : undefined} aria-describedby={eB.date ? 'err-date' : undefined} />
					{#if eB.date}<span class="error-text" id="err-date">{eB.date}</span>{/if}
				</div>
			{/if}
			<div class="field">
				<label for="location">Plats</label>
				<input id="location" name="location" value={c.location ?? ''} />
			</div>
			<div class="field">
				<label for="hqPhone">Telefon till tävlingsledningen</label>
				<input id="hqPhone" name="hqPhone" type="tel" value={c.hqPhone ?? ''} aria-invalid={eB.hqPhone ? 'true' : undefined} aria-describedby={eB.hqPhone ? 'err-hqPhone' : undefined} />
				{#if eB.hqPhone}<span class="error-text" id="err-hqPhone">{eB.hqPhone}</span>{/if}
			</div>
			<div class="field">
				<label for="owner">Arrangör</label>
				<select id="owner" name="owner" value={c.ownerGroupNo ?? ''} aria-invalid={eB.owner ? 'true' : undefined} aria-describedby={eB.owner ? 'err-owner' : undefined}>
					{#each ownerOptions as g (g.groupNo)}<option value={g.groupNo}>{g.name}</option>{/each}
				</select>
				{#if eB.owner}<span class="error-text" id="err-owner">{eB.owner}</span>{/if}
			</div>
		</div>
		<div class="toggles">
			<Toggle name="styleEnabled" checked={c.styleEnabled} label="Använd stilpoäng" description="Av = stilpoäng försvinner på funktionärens skärm, protokoll och resultat." />
			<Toggle name="publicResults" checked={c.publicResults} label="Publika resultat" description="Resultatlistan syns för alla under dagen." />
			<Toggle
				name="stationResultsLive"
				checked={c.stationResultsLive}
				label="Visa poäng per kontroll under tävlingen"
				description="Av = de publika resultaten visar bara totalen tills tävlingen är avslutad, så att ingen ser en kontrolls poäng innan de har varit där. Efteråt, och i arkivet, syns poängen per kontroll alltid."
			/>
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
	<p class="muted lead">Tävlingssidan <strong>{page.data.siteHost}/{c.slug}</strong> syns för alla när tävlingen inte är ett utkast.</p>
	<form method="POST" action="?/registration" class="stack" use:enhance={keep} novalidate>
		<div class="toggles">
			<Toggle name="registrationOpen" checked={c.registrationOpen} label="Öppen självanmälan" description="Patrulledare kan anmäla via tävlingssidan." />
		</div>
		<div class="grid2">
			<div class="field">
				<label for="registrationOpensOn">Anmälan öppnar</label>
				<input id="registrationOpensOn" name="registrationOpensOn" type="date" value={c.registrationOpensOn ?? ''} aria-invalid={eR.registrationOpensOn ? 'true' : undefined} aria-describedby={eR.registrationOpensOn ? 'err-registrationOpensOn' : undefined} />
				{#if eR.registrationOpensOn}<span class="error-text" id="err-registrationOpensOn">{eR.registrationOpensOn}</span>{:else}<span class="muted small">Tomt = direkt</span>{/if}
			</div>
			<div class="field">
				<label for="registrationClosesOn">Sista anmälningsdag</label>
				<input id="registrationClosesOn" name="registrationClosesOn" type="date" value={c.registrationClosesOn ?? ''} aria-invalid={eR.registrationClosesOn ? 'true' : undefined} aria-describedby={eR.registrationClosesOn ? 'err-registrationClosesOn' : undefined} />
				{#if eR.registrationClosesOn}<span class="error-text" id="err-registrationClosesOn">{eR.registrationClosesOn}</span>{:else}<span class="muted small">Tomt = till och med tävlingsdagen</span>{/if}
			</div>
			<div class="field">
				<label for="maxPatrols">Max antal patruller</label>
				<input id="maxPatrols" name="maxPatrols" inputmode="numeric" value={c.maxPatrols ?? ''} placeholder="Obegränsat" aria-invalid={eR.maxPatrols ? 'true' : undefined} aria-describedby={eR.maxPatrols ? 'err-maxPatrols' : undefined} />
				{#if eR.maxPatrols}<span class="error-text" id="err-maxPatrols">{eR.maxPatrols}</span>{/if}
			</div>
			<div class="field">
				<label for="feePerPatrol">Avgift per patrull (kr)</label>
				<input id="feePerPatrol" name="feePerPatrol" inputmode="numeric" value={c.feePerPatrol ?? ''} placeholder="Ingen avgift" aria-invalid={eR.feePerPatrol ? 'true' : undefined} aria-describedby="feePerPatrol-help" />
				{#if eR.feePerPatrol}<span class="error-text" id="err-feePerPatrol">{eR.feePerPatrol}</span>{:else}<span class="muted small" id="feePerPatrol-help">Bocka i "Betald" på Patruller när pengarna har kommit in.</span>{/if}
			</div>
		</div>
		<div class="field">
			<label for="infoText">Information på tävlingssidan</label>
			<textarea id="infoText" name="infoText" rows="5" maxlength="4000" placeholder="Samlingstid, vad patrullerna ska ta med, startavgift …" aria-invalid={eR.infoText ? 'true' : undefined} aria-describedby={eR.infoText ? 'err-infoText' : undefined}>{c.infoText ?? ''}</textarea>
			{#if eR.infoText}<span class="error-text" id="err-infoText">{eR.infoText}</span>{/if}
		</div>
		<div class="field">
			<label for="confirmationText">Text i bekräftelsen</label>
			<textarea id="confirmationText" name="confirmationText" rows="3" maxlength="1000" placeholder="Visas när en patrull har anmält sig, t.ex. hur avgiften betalas." aria-invalid={eR.confirmationText ? 'true' : undefined} aria-describedby={eR.confirmationText ? 'err-confirmationText' : undefined}>{c.confirmationText ?? ''}</textarea>
			{#if eR.confirmationText}<span class="error-text" id="err-confirmationText">{eR.confirmationText}</span>{/if}
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
	<BrandingEditor
		level="edition"
		name={c.name}
		organiserName={c.ownerGroupName}
		accentColor={c.accentColor}
		coverFit={c.coverFit}
		branding={data.branding}
		{canEdit}
		errors={eA}
		saved={ok('appearance')}
		uploaded={form && 'uploaded' in form ? String(form.uploaded) : null}
	/>
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
			{#if eD.days}<span class="error-text" role="alert" id="err-days">{eD.days}</span>{/if}
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
			<input id="newTrack" name="newTrack" placeholder="t.ex. Rover" aria-invalid={eT.newTrack ? 'true' : undefined} aria-describedby={eT.newTrack ? 'err-newTrack' : undefined} />
			{#if eT.newTrack}<span class="error-text" id="err-newTrack">{eT.newTrack}</span>{/if}
		</div>
		{#if eT.tracks}<span class="error-text" role="alert" id="err-tracks">{eT.tracks}</span>{/if}
		<div class="act">
			<button class="btn btn-primary" disabled={!canEdit}>Spara klasser</button>
			{#if ok('tracks')}<span class="pill pill-ok" role="status">Sparat</span>{/if}
		</div>
	</form>
</section>

<section class="card sec" id="agare" aria-labelledby="h-members">
	<h2 id="h-members">Ägare och arrangörer</h2>
	<MembersPanel
		members={data.members}
		meId={data.user.id}
		power={data.roles.includes('owner') ? 'owner' : canEdit ? 'organiser' : null}
		{form}
		lead="Ägare kan ändra allt, även vilka som är ägare. Arrangörer kan ändra allt utom ägarna. Tävlingen har alltid minst en ägare. Alla loggar in med ScoutID."
	/>
</section>

{#if data.roles.includes('owner')}
	<section class="card sec" id="logg" aria-labelledby="h-audit">
		<h2 id="h-audit">Händelselogg</h2>
		<p class="muted lead">Ändringar av ägare och arrangörer, borttagning av personuppgifter och allt plattformsadministratören gör med tävlingen. Loggen kan inte ändras.</p>
		{#if data.notices.length}
			<div class="notices" data-testid="access-notices">
				<h3>Tillfällig åtkomst från plattformsadmin (30 dagar)</h3>
				<ul>
					{#each data.notices as n (n.id)}
						<li>
							<strong>{n.adminName}</strong>
							{n.active ? 'har åtkomst' : 'hade åtkomst'} som arrangör
							{new Date(n.grantedAt).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Stockholm' })}–{new Date(n.until).toLocaleTimeString('sv-SE', { timeStyle: 'short', timeZone: 'Europe/Stockholm' })}.
							<span class="muted">Anledning: {n.reason}</span>
						</li>
					{/each}
				</ul>
			</div>
		{/if}
		<AuditList rows={data.audit} />
	</section>
{/if}

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
	.tracks li {
		display: flex;
		gap: 10px;
		align-items: flex-end;
		flex-wrap: wrap;
	}
	.tracks li {
		align-items: center;
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
	.tracks li {
		padding-bottom: 10px;
		border-bottom: 1px solid var(--line);
	}
	[aria-invalid='true'] {
		border-color: var(--danger);
	}
	.notices {
		background: var(--tint);
		border-radius: var(--r-md);
		padding: 14px 16px;
	}
	.notices h3 {
		font-size: 16px;
		font-weight: 800;
		margin: 0 0 6px;
	}
	.notices ul {
		gap: 6px;
	}
</style>

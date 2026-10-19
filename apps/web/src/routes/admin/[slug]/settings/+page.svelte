<script lang="ts">
	import { enhance } from '$app/forms';
	import Toggle from '#lib/ui/admin/Toggle.svelte';
	import { shortDate } from '#lib/ui/admin/format.ts';

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
	const canEdit = $derived(data.roles.includes('owner') || data.roles.includes('organiser'));
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
			<Toggle name="registrationOpen" checked={c.registrationOpen} label="Öppen självanmälan" description="Patrulledare kan anmäla via tävlingssidan." />
		</div>
		<div class="act">
			<button class="btn btn-primary" disabled={!canEdit}>Spara grundinfo</button>
			{#if ok('basics')}<span class="pill pill-ok" role="status">Sparat</span>{/if}
		</div>
	</form>
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
	<p class="muted lead">Varje patrull tävlar i en klass och får en egen resultatlista.</p>
	
	<form method="POST" action="?/tracks" class="stack" use:enhance={keep} novalidate>
		<ul class="tracks">
			{#each data.tracks as t (t.id)}
				<li>
					<div class="field grow">
						<label for="track_{t.id}" class="sr-only">Namn på klass</label>
						<input id="track_{t.id}" name="track_{t.id}" value={t.name} aria-invalid={eT[`track_${t.id}`] ? 'true' : undefined} />
					</div>
					<span class="muted small">{data.trackPatrols[t.id] ?? 0} patruller</span>
					<button class="btn btn-ghost rm" formaction="?/removeTrack" name="id" value={t.id} disabled={!canEdit || (data.trackPatrols[t.id] ?? 0) > 0} aria-label="Ta bort klassen {t.name}">Ta bort</button>
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
	[aria-invalid='true'] {
		border-color: var(--danger);
	}
</style>

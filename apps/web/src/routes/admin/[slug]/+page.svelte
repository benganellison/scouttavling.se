<script lang="ts">
	import { enhance } from '$app/forms';
	import Kpi from '#lib/ui/admin/Kpi.svelte';
	import Stepper from '#lib/ui/admin/Stepper.svelte';
	import StatusPill from '#lib/ui/admin/StatusPill.svelte';
	import { dateRange, daysUntil, greeting, phaseOf } from '#lib/ui/admin/format.ts';

	let { data } = $props();

	const c = $derived(data.competition);
	const s = $derived(data.stats);
	const a = $derived(data.after);
	const base = $derived(`/admin/${c.slug}`);
	const phase = $derived(phaseOf(c));
	const left = $derived(daysUntil(c.startDate));
	const leftText = $derived(
		c.anonymisedAt
			? 'Tävlingen är arkiverad'
			: c.status === 'closed'
			? 'Tävlingen är avslutad'
			: left > 1
				? `${left} dagar kvar`
				: left === 1
					? 'I morgon!'
					: left === 0
						? 'Tävlingsdag idag'
						: daysUntil(c.endDate) >= 0
							? 'Tävlingen pågår'
							: 'Tävlingsdagarna är passerade'
	);

	type State = 'done' | 'warn' | 'todo';
	interface Todo {
		state: State;
		title: string;
		desc: string;
		cta?: string;
		href?: string;
		cta2?: string;
		href2?: string;
	}

	const todos = $derived.by<Todo[]>(() => {
		const basics = Boolean(c.location && c.hqPhone);
		const missing = [!c.location && 'plats', !c.hqPhone && 'telefon till HQ'].filter(Boolean).join(' och ');
		const vol = s.withoutInvite;
		return [
			{
				state: basics ? 'done' : 'todo',
				title: 'Grundinfo',
				desc: basics ? `${c.name} · ${dateRange(c.startDate, c.endDate)} · ${c.location}` : `Saknar ${missing}`,
				cta: basics ? 'Ändra' : 'Fyll i',
				href: `${base}/settings`
			},
			{
				state: s.trackNames.length ? 'done' : 'todo',
				title: 'Klasser',
				desc: s.trackNames.length ? s.trackNames.join(', ') : 'Inga klasser ännu',
				cta: 'Ändra',
				href: `${base}/settings#klasser`
			},
			{
				state: s.stations > 0 && s.stationsWithoutItems === 0 ? 'done' : s.stationsWithoutItems > 0 ? 'warn' : 'todo',
				title: 'Kontroller & poängregler',
				desc:
					s.stations === 0
						? 'Inga kontroller ännu'
						: `${s.stations} kontroller${s.checkpoints ? `, ${s.checkpoints} checkpoint${s.checkpoints > 1 ? 's' : ''}` : ''}${s.stationsWithoutItems ? ` · ${s.stationsWithoutItems} saknar poängregel` : ''}`,
				cta: s.stations ? 'Redigera' : 'Lägg till',
				href: `${base}/stations`
			},
			{
				state: s.patrols > 0 ? 'done' : 'todo',
				title: 'Patruller',
				desc: s.patrols ? `${s.patrols} patruller · ${s.members} scouter` : 'Inga patruller ännu. Importera en fil eller lägg till för hand.',
				cta: 'Importera',
				href: `${base}/import`,
				cta2: 'Lägg till',
				href2: `${base}/patrols`
			},
			{
				state: s.patrols > 0 && s.startAssigned === s.patrols ? 'done' : 'todo',
				title: 'Fördela startkontroller',
				desc: s.patrols === 0 ? 'Görs när patrullerna är på plats' : `${s.startAssigned} av ${s.patrols} patruller har en startkontroll`,
				cta: s.startAssigned === s.patrols && s.patrols ? 'Visa' : 'Fördela',
				href: `${base}/distribution`
			},
			{
				state: s.stations === 0 ? 'todo' : vol.length === 0 ? 'done' : 'warn',
				title: vol.length ? `${vol.length} ${vol.length === 1 ? 'kontroll saknar' : 'kontroller saknar'} funktionär` : 'Funktionärer',
				desc: vol.length ? vol.slice(0, 4).join(', ') + (vol.length > 4 ? ` och ${vol.length - 4} till` : '') : s.stations ? 'Alla kontroller har en inbjudan' : 'Skapa kontroller först',
				cta: 'Bjud in',
				href: `${base}/invites`
			},
			{
				state: c.registrationOpen || c.infoText ? 'done' : 'todo',
				title: 'Tävlingssida & anmälan',
				desc: c.registrationOpen
					? `Självanmälan öppen${c.maxPatrols ? ` · max ${c.maxPatrols} patruller` : ''}${c.followEnabled ? ' · Följ patrullen på' : ''}`
					: 'Självanmälan är avstängd. Tävlingssidan visar info och klasser.',
				cta: c.status === 'draft' ? 'Förhandsgranska' : 'Visa sidan',
				href: `/t/${c.slug}`,
				cta2: 'Ändra',
				href2: `${base}/settings#anmalan`
			},
			{
				state: 'todo',
				title: 'Utskrifter',
				desc: 'Kontrollskyltar med QR-kod, patrullpass och reservprotokoll',
				cta: 'Utskrifter',
				href: `${base}/print`
			}
		];
	});
	const doneCount = $derived(todos.filter((t) => t.state === 'done').length + (c.status !== 'draft' ? 1 : 0));
</script>

<svelte:head><title>Översikt · {c.name}</title></svelte:head>

<header class="head">
	<div class="hello">
		<span class="left">{leftText}</span>
		<h1>{greeting()}, {data.firstName}.</h1>
	</div>
	<Stepper steps={['Före', 'Tävlingsdag', 'Efter']} current={phase} />
</header>

<div class="kpis">
	<Kpi label="Patruller" value={s.patrols} note={s.patrols ? `${s.startAssigned} med startkontroll` : 'Inga än'} />
	{#if c.anonymisedAt}
		<Kpi label="Scouter" value="–" note="namnen togs bort vid arkivering" />
	{:else}
	<Kpi label="Scouter" value={s.members} note={s.patrols ? `snitt ${(s.members / s.patrols).toLocaleString('sv-SE', { maximumFractionDigits: 1 })} per patrull` : ''} />
	{/if}
	<Kpi label="Kontroller" value={s.stations} note={s.checkpoints ? `varav ${s.checkpoints} checkpoints` : ''} />
	{#if c.status === 'closed'}
		<Kpi label="I mål" value={s.finished} of={s.patrols ? ` / ${s.patrols}` : ''} note="patruller" />
	{:else}
	<Kpi
		label="Utan funktionär"
		value={s.withoutInvite.length}
		of={s.stations ? ` / ${s.stations}` : ''}
		note={s.withoutInvite.length ? 'saknar inbjudan' : s.stations ? 'alla inbjudna' : ''}
		tone={s.withoutInvite.length ? 'warn' : 'ok'}
	/>
	{/if}
</div>

{#if c.status === 'closed'}
{#if a && !c.anonymisedAt}
<section class="card remind" aria-labelledby="pd-h" data-testid="personal-data-reminder">
	<span class="remind-mark" aria-hidden="true">!</span>
	<div class="remind-txt">
		<h2 id="pd-h">{a.personalLeft ? `Personuppgifter finns kvar för ${a.personalLeft} ${a.personalLeft === 1 ? 'patrull' : 'patruller'}` : 'Tävlingen är inte arkiverad än'} – ta bort när resultaten är klara</h2>
		<p class="d">Scouternas namn, kontaktuppgifter, patrullernas länkar, funktionärer och meddelanden behövs inte längre. Poäng, patrullnamn, kårer och resultat sparas.</p>
	</div>
	<a class="btn btn-primary" href="{base}/anonymise">Ta bort personuppgifter</a>
</section>
{/if}
<section class="card closed" aria-labelledby="closed-h" data-testid="closed-summary">
	<div class="cl-head">
		<h2 id="closed-h">{c.anonymisedAt ? 'Tävlingen är arkiverad' : 'Tävlingen är avslutad'}</h2>
		{#if c.anonymisedAt}<span class="pill archived">Arkiverad</span>{:else}<StatusPill status={c.status} />{/if}
	</div>
	{#if c.anonymisedAt}
		<p class="d" data-testid="archived-note">
			Personuppgifterna togs bort {new Date(c.anonymisedAt).toLocaleDateString('sv-SE', { day: 'numeric', month: 'long', year: 'numeric' })}. Tävlingen är skrivskyddad; resultaten finns kvar oförändrade. {s.finished} av {s.patrols} patruller gick i mål.
		</p>
	{:else}
		<p class="d">Resultaten är låsta för funktionärer. {s.finished} av {s.patrols} patruller gick i mål.</p>
	{/if}
	<div class="closed-links">
		<a class="btn btn-primary" href="{base}/results">Resultat</a>
		<a class="btn" href="{base}/results.csv" download>Exportera (CSV)</a>
		{#if c.publicResults}<a class="btn" href="/r/{c.slug}">Publika resultat</a>{/if}
		{#if !c.anonymisedAt}<a class="btn" href="/r/{c.slug}/ceremony">Prisutdelning</a>{/if}
		{#if data.series}<a class="btn" href="/admin/series/{data.series.slug}">Serien {data.series.name}</a>{/if}
	</div>
	{#if !c.anonymisedAt}
		<form method="POST" action="?/status" use:enhance class="reopen">
			<button class="cta" name="to" value="live">Öppna tävlingen igen</button>
		</form>
	{/if}
</section>
{#if a}
<section class="card next" aria-labelledby="next-h" data-testid="next-edition">
	<div class="next-txt">
		<h2 id="next-h">Nästa år</h2>
		{#if a.nextExists}
			<p class="d">{a.nextName} finns redan.</p>
		{:else}
			<p class="d">Börja planera {a.nextName} med samma dagar, klasser, kontroller och poängregler. Patruller, poäng och funktionärer följer inte med.</p>
		{/if}
	</div>
	{#if a.nextExists}
		<a class="btn" href="/admin/{a.nextExists}">Öppna {a.nextName}</a>
	{:else}
		<a class="btn btn-accent" href="{base}/next-edition">Skapa {a.nextName}</a>
	{/if}
</section>
{/if}
{:else}
<section class="card checklist" aria-labelledby="cl">
	<div class="cl-head">
		<h2 id="cl">Att göra innan tävlingsdagen</h2>
		<span class="count">{doneCount} av {todos.length + 1} klart</span>
	</div>
	<ul>
		{#each todos as t (t.title)}
			<li class={t.state}>
				<span class="mark" aria-hidden="true">
					{#if t.state === 'done'}<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>{:else if t.state === 'warn'}!{/if}
				</span>
				<span class="sr-only">{t.state === 'done' ? 'Klart:' : t.state === 'warn' ? 'Behöver åtgärdas:' : 'Att göra:'}</span>
				<div class="txt">
					<span class="t">{t.title}</span>
					<span class="d">{t.desc}</span>
				</div>
				<div class="ctas">
					{#if t.cta2}<a class="cta" href={t.href2}>{t.cta2}</a>{/if}
					{#if t.cta}<a class="cta" class:hot={t.state === 'warn'} href={t.href}>{t.cta}</a>{/if}
				</div>
			</li>
		{/each}
		<li class={c.status === 'draft' ? 'todo' : 'done'}>
			<span class="mark" aria-hidden="true">
				{#if c.status !== 'draft'}<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>{/if}
			</span>
			<div class="txt">
				<span class="t">Status <StatusPill status={c.status} /></span>
				<span class="d">
					{#if c.status === 'draft'}Gör tävlingen live när allt är klart. Funktionärer kan då rapportera poäng.
					{:else if c.status === 'live'}Tävlingen är live. Avsluta när prisutdelningen är klar.
					{:else}Tävlingen är avslutad. Resultaten är låsta för funktionärer.{/if}
				</span>
			</div>
			<form method="POST" action="?/status" class="ctas" use:enhance>
				{#if c.status === 'draft'}
					<button class="btn btn-accent sm" name="to" value="live">Gör tävlingen live</button>
				{:else if c.status === 'live'}
					<button class="cta" name="to" value="draft">Tillbaka till utkast</button>
					<button class="btn btn-primary sm" name="to" value="closed">Avsluta</button>
				{:else}
					<button class="cta" name="to" value="live">Öppna igen</button>
				{/if}
			</form>
		</li>
	</ul>
</section>
{/if}

<style>
	.head {
		display: flex;
		justify-content: space-between;
		align-items: flex-end;
		gap: 20px;
		flex-wrap: wrap;
	}
	.hello {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.left {
		font-size: 14px;
		font-weight: 700;
		color: var(--ink-2);
	}
	h1 {
		font-size: clamp(30px, 4vw, 40px);
		font-weight: 800;
		letter-spacing: -0.03em;
	}
	.kpis {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 170px), 1fr));
		gap: 14px;
	}
	.closed {
		border-radius: 20px;
		padding: 22px 24px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.closed .d {
		margin: 0;
		font-size: 15px;
	}
	.closed-links {
		display: flex;
		gap: 10px;
		flex-wrap: wrap;
	}
	.reopen {
		margin: 0;
	}
	.remind,
	.next {
		border-radius: 20px;
		padding: 20px 24px;
		display: flex;
		gap: 16px;
		align-items: center;
		flex-wrap: wrap;
	}
	.remind {
		border: 2px solid var(--orange);
		background: var(--surface, #fff);
	}
	.remind-mark {
		flex: none;
		width: 34px;
		height: 34px;
		border-radius: 50%;
		background: var(--orange);
		color: #000;
		font-weight: 900;
		display: grid;
		place-items: center;
	}
	.remind-txt,
	.next-txt {
		flex: 1 1 320px;
		display: flex;
		flex-direction: column;
		gap: 6px;
		min-width: 0;
	}
	.remind h2,
	.next h2 {
		font-size: 18px;
		margin: 0;
	}
	.remind .d,
	.next .d {
		margin: 0;
		font-size: 15px;
		color: var(--ink-2);
	}
	.archived {
		background: var(--tint);
		color: var(--ink);
		border: 1px solid var(--line);
	}
	.checklist {
		border-radius: 20px;
		padding: 22px 24px;
	}
	.cl-head {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 12px;
		flex-wrap: wrap;
		margin-bottom: 8px;
	}
	.cl-head h2 {
		font-size: 20px;
		font-weight: 800;
	}
	.count {
		font-size: 14px;
		font-weight: 700;
		color: var(--ink-2);
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	li {
		display: flex;
		align-items: center;
		gap: 14px;
		padding: 12px 0;
		border-top: 1px solid var(--tint);
		flex-wrap: wrap;
	}
	.mark {
		width: 28px;
		height: 28px;
		border-radius: 50%;
		flex: none;
		display: flex;
		align-items: center;
		justify-content: center;
		border: 2px solid var(--line-strong);
		background: var(--surface);
		color: #fff;
		font-weight: 800;
		font-size: 14px;
	}
	.done .mark {
		background: var(--ok);
		border-color: var(--ok);
	}
	.warn .mark {
		background: var(--cta);
		border-color: var(--cta);
	}
	.txt {
		display: flex;
		flex-direction: column;
		flex: 1 1 260px;
		min-width: 0;
	}
	.t {
		font-weight: 800;
		font-size: 15px;
		display: inline-flex;
		align-items: center;
		gap: 8px;
	}
	.done .t {
		color: var(--ink-2);
	}
	.d {
		font-size: 13px;
		color: var(--ink-2);
	}
	.warn .d {
		color: var(--warn-ink);
	}
	.ctas {
		display: flex;
		gap: 8px;
		margin-left: auto;
		flex-wrap: wrap;
	}
	.cta {
		text-decoration: none;
		min-height: 40px;
		padding: 0 14px;
		border-radius: var(--r-sm);
		font-weight: 800;
		font-size: 14px;
		display: inline-flex;
		align-items: center;
		white-space: nowrap;
		background: var(--tint);
		color: var(--brand);
		border: 0;
		cursor: pointer;
	}
	.cta:hover {
		background: var(--ok-tint);
		color: var(--brand);
	}
	.cta.hot {
		background: var(--cta);
		color: #fff;
	}
	.cta.hot:hover {
		background: var(--warn-ink);
	}
	.btn.sm {
		min-height: 40px;
		font-size: 14px;
		padding: 0 14px;
	}
	@media (max-width: 480px) {
		.checklist {
			padding: 18px 16px;
		}
		.ctas {
			margin-left: 42px;
		}
	}
</style>

<script lang="ts">
	import { goto } from '$app/navigation';
	import { forgetCompetition, useField, hhmm, shortTroop } from '#lib/field/app.svelte.ts';
	import Icon from '#lib/field/ui/Icon.svelte';
	import SyncPill from '#lib/field/ui/SyncPill.svelte';
	import TabBar from '#lib/field/ui/TabBar.svelte';
	import { scoreKey } from '#lib/field/db.ts';

	const app = useField();
	const base = `/f/${app.slug}`;
	let q = $state('');
	let open = $state<string | null>(null);
	let confirmForget = $state(false);

	/** The volunteer is done: the competition (patrol list, contacts, reports) leaves this phone. */
	async function forget() {
		await forgetCompetition(app.slug, { keepUnsent: false });
		location.href = '/';
	}

	const styleOn = $derived(app.items.some((i) => i.styleEnabled));
	const checkin = $derived(app.items.length > 0 && app.items.every((i) => i.mode === 'CHECKIN' || i.mode === 'AUTO_ON_SCAN'));

	/** One row per patrol that has (or had, pending a void) a report at this station. */
	const rows = $derived.by(() => {
		const out = [];
		for (const p of app.patrols) {
			const scores = app.items.map((it) => ({ it, s: app.scoreByKey.get(scoreKey(app.slug, p.id, it.id)), d: app.display(p.id, it.id) }));
			if (!scores.some((x) => x.d)) continue;
			const res = app.stationResult(p.id);
			const voidPending = !res && scores.some((x) => x.d?.state === 'void' && x.d.sync === 'pending');
			if (!res && !voidPending && !scores.some((x) => x.s?.conflict || x.s?.problem)) continue;
			const conflict = scores.find((x) => x.s?.conflict);
			const problem = scores.find((x) => x.s?.problem)?.s?.problem ?? null;
			const at = Math.max(...scores.map((x) => x.d?.at ?? 0));
			const sync: 'conflict' | 'problem' | 'review' | 'pending' | 'synced' = conflict ? 'conflict' : problem ? 'problem' : scores.some((x) => x.d?.sync === 'review') ? 'review' : scores.some((x) => x.d?.sync === 'pending') ? 'pending' : 'synced';
			let serverText = '';
			if (conflict?.s?.conflict) {
				const c = conflict.s.conflict;
				serverText = c.state === 'void' ? 'borttagen' : styleOn ? `${c.points} + ${c.stylePoints}` : `${c.points + c.stylePoints}`;
			}
			out.push({ p, res, at, sync, voidPending, conflict: !!conflict, serverText, problem });
		}
		const needle = q.trim().toLowerCase();
		return out
			.filter((r) => !needle || String(r.p.number).startsWith(needle) || r.p.name.toLowerCase().includes(needle))
			.sort((a, b) => b.at - a.at);
	});
	const syncLabel = { synced: 'Skickad', pending: 'Väntar på täckning', conflict: 'Konflikt', problem: 'Nekad', review: 'Granskas av HQ' } as const;
	const offline = $derived(!app.online || (app.pendingCount > 0 && !!app.lastFailedAt));

	function pts(r: (typeof rows)[number]) {
		if (r.voidPending) return 'tas bort';
		if (!r.res) return '–';
		if (checkin) return 'incheckad';
		return styleOn ? `${r.res.points} + ${r.res.style}` : `${r.res.total}`;
	}
</script>

<div class="screen">
	<header>
		<div class="top">
			<span class="sub">{app.station?.code} · {app.station?.name}</span>
			<SyncPill />
		</div>
		<h1>Logg</h1>
	</header>

	{#if offline && app.pendingCount > 0}
		<div class="offline" role="status">
			<Icon name="offline" />
			<div>
				<strong>Ingen täckning just nu</strong>
				<span>{app.pendingCount} {app.pendingCount === 1 ? 'rapport väntar' : 'rapporter väntar'} · Inget går förlorat</span>
			</div>
		</div>
	{/if}

	<div class="search">
		<label for="sok" class="sr-only">Sök patrull</label>
		<Icon name="search" size={20} />
		<input id="sok" type="search" placeholder="Sök namn eller nummer" bind:value={q} autocomplete="off" />
	</div>

	<main>
		{#if rows.length}
			<ul class="list">
				{#each rows as r (r.p.id)}
					<li class:alert={r.sync === 'conflict' || r.sync === 'problem'}>
						<button type="button" class="row" aria-expanded={open === r.p.id} onclick={() => (open = open === r.p.id ? null : r.p.id)}>
							<span class="t">{hhmm(r.at)}</span>
							<span class="who">
								<span class="name">{r.p.name} <span class="nr">{r.p.number}</span></span>
								<span class="track">{r.p.track} · {shortTroop(r.p.troop)}</span>
							</span>
							<span class="pts">{pts(r)}</span>
							<span class="sync {r.sync}" title={syncLabel[r.sync]} aria-label={syncLabel[r.sync]} data-testid="sync-{r.p.number}" data-sync={r.sync}>
								<Icon name={r.sync === 'synced' ? 'check' : r.sync === 'pending' ? 'clock' : 'alert'} size={16} stroke={3} />
							</span>
						</button>
						{#if r.conflict}
							<div class="inline-alert">
								<p><strong>Konflikt:</strong> Din: {pts(r)} · Servern: {r.serverText}. Någon annan har ändrat samtidigt.</p>
								<div class="actions">
									<button type="button" class="act ghost" onclick={() => app.keepServer(r.p.id)}>Behåll serverns</button>
									<button type="button" class="act primary" onclick={() => app.resendMine(r.p.id)}>Skicka min igen</button>
								</div>
							</div>
						{:else if r.problem}
							<div class="inline-alert">
								<p><strong>Nekad:</strong> {r.problem}</p>
								<div class="actions"><button type="button" class="act ghost" onclick={() => app.keepServer(r.p.id)}>Ta bort från loggen</button></div>
							</div>
						{:else if r.sync === 'review'}
							<p class="review">Väntar på granskning av tävlingsledningen.</p>
						{/if}
						{#if open === r.p.id && r.res}
							<div class="actions expand">
								<button type="button" class="act primary" onclick={() => goto(`${base}/score/${r.p.number}`)}>Ändra poäng</button>
								<button type="button" class="act danger" onclick={async () => { await app.voidPatrol(r.p.id); open = null; }}>Ta bort</button>
							</div>
						{/if}
					</li>
				{/each}
			</ul>
		{:else}
			<p class="empty">{q ? 'Ingen träff.' : 'Inga rapporter ännu. Skanna första patrullen från Kontroll.'}</p>
		{/if}

		<section class="forget" aria-labelledby="forget-h">
			<h2 id="forget-h">Klar med tävlingen?</h2>
			<p>Telefonen glömmer tävlingen av sig själv en vecka efter att den är slut. Du kan också ta bort den nu: patrullerna, meddelandena och dina rapporter försvinner från telefonen (de som är skickade finns kvar hos tävlingsledningen).</p>
			{#if !confirmForget}
				<button type="button" class="btn-forget" onclick={() => (confirmForget = true)}>Ta bort tävlingen från telefonen</button>
			{:else}
				<div class="confirm" role="alertdialog" aria-labelledby="forget-q">
					<p id="forget-q">
						{#if app.pendingCount}<strong>{app.pendingCount} {app.pendingCount === 1 ? 'rapport är' : 'rapporter är'} inte skickade och försvinner.</strong> Vänta på täckning först om de ska med.{:else}Allt är skickat.{/if}
						Ta bort tävlingen från telefonen?
					</p>
					<button type="button" class="btn-forget danger" onclick={forget}>Ja, ta bort</button>
					<button type="button" class="btn-forget" onclick={() => (confirmForget = false)}>Avbryt</button>
				</div>
			{/if}
		</section>
	</main>

	<TabBar current="log" />
</div>

<style>
	.screen {
		height: 100dvh;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}
	header {
		padding: 14px 16px 10px;
	}
	.top {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 8px;
	}
	.sub {
		font-size: 14px;
		font-weight: 700;
		color: var(--ink-2);
	}
	h1 {
		font-size: 30px;
		font-weight: 800;
	}
	.offline {
		margin: 0 16px 10px;
		display: flex;
		gap: 12px;
		align-items: center;
		background: var(--ink);
		color: #fff;
		border-radius: var(--r-md);
		padding: 12px 14px;
	}
	.offline :global(svg) {
		color: var(--on-brand-hi);
		flex: none;
	}
	.offline div {
		display: flex;
		flex-direction: column;
		font-size: 15px;
	}
	.offline span {
		color: var(--on-brand);
	}
	.search {
		margin: 0 16px;
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: 52px;
		padding: 0 14px;
		border-radius: 12px;
		background: var(--surface);
		border: 1.5px solid var(--line-strong);
		color: var(--ink-2);
	}
	.search input {
		border: 0;
		outline: 0;
		min-height: 48px;
		padding: 0;
		font-size: 17px;
		flex: 1;
		min-width: 0;
		background: transparent;
	}
	main {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 12px 16px 16px;
	}
	.list {
		list-style: none;
		margin: 0;
		padding: 2px 14px;
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: var(--r-lg);
	}
	.list li + li {
		border-top: 1px solid var(--tint);
	}
	.row {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 12px;
		min-height: 64px;
		border: 0;
		background: none;
		text-align: left;
		padding: 6px 0;
		cursor: pointer;
	}
	.t {
		font-size: 14px;
		font-weight: 700;
		color: var(--ink-2);
		width: 44px;
		flex: none;
	}
	.who {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-width: 0;
	}
	.name {
		font-weight: 800;
		font-size: 17px;
	}
	.nr {
		font-weight: 600;
		color: var(--ink-2);
	}
	.track {
		font-size: 13px;
		color: var(--ink-2);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.pts {
		font-family: var(--font-display);
		font-weight: 800;
		font-size: 22px;
		white-space: nowrap;
	}
	.sync {
		width: 30px;
		height: 30px;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		flex: none;
	}
	.sync.synced {
		background: var(--ok-tint);
		color: var(--brand-2);
	}
	.sync.pending {
		background: var(--warn-tint);
		color: var(--warn-ink);
	}
	.sync.conflict,
	.sync.problem,
	.sync.review {
		background: #fde2de;
		color: var(--danger);
	}
	.inline-alert {
		background: var(--danger-tint);
		border-radius: 12px;
		padding: 10px 12px;
		margin-bottom: 10px;
	}
	.inline-alert p,
	.review {
		margin: 0 0 8px;
		font-size: 15px;
	}
	.review {
		color: var(--danger);
		font-weight: 700;
		padding-bottom: 6px;
	}
	.actions {
		display: flex;
		gap: 8px;
	}
	.forget {
		margin: 28px 0 8px;
		padding-top: 16px;
		border-top: 1px solid var(--line);
		display: grid;
		gap: 10px;
	}
	.forget h2 {
		margin: 0;
		font-size: 17px;
	}
	.forget p {
		margin: 0;
		color: var(--ink-2);
		font-size: 14px;
	}
	.forget .confirm {
		display: grid;
		gap: 8px;
	}
	.forget .confirm p {
		color: var(--ink);
	}
	.btn-forget {
		min-height: var(--tap, 48px);
		border-radius: 12px;
		border: 1.5px solid var(--line-strong);
		background: var(--surface);
		color: var(--ink);
		font: inherit;
		font-weight: 800;
		cursor: pointer;
	}
	.btn-forget.danger {
		background: var(--danger, #b42318);
		border-color: var(--danger, #b42318);
		color: #fff;
	}
	.expand {
		padding: 0 0 12px 56px;
	}
	.act {
		flex: 1;
		min-height: 56px;
		border-radius: 12px;
		font-weight: 800;
		font-size: 16px;
		border: 1.5px solid var(--line-strong);
		background: var(--surface);
		color: var(--ink);
	}
	.act.primary {
		background: var(--brand);
		border-color: var(--brand);
		color: #fff;
	}
	.act.danger {
		flex: 0 0 auto;
		padding: 0 18px;
		color: var(--danger);
	}
	.empty {
		color: var(--ink-2);
		font-size: 16px;
		text-align: center;
		margin-top: 40px;
	}
</style>

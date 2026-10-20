<script lang="ts">
	import { goto } from '$app/navigation';
	import { useField, shortTroop, hhmm } from '#lib/field/app.svelte.ts';
	import Icon from '#lib/field/ui/Icon.svelte';
	import SyncPill from '#lib/field/ui/SyncPill.svelte';
	import TabBar from '#lib/field/ui/TabBar.svelte';

	const app = useField();
	const base = `/f/${app.slug}`;

	$effect(() => {
		if (app.grant?.role === 'startfinish') void goto(`${base}/desk`, { replace: true });
	});

	const firstName = $derived((app.grant?.displayName ?? '').split(' ')[0]);
	const eligible = $derived(app.patrols.filter((p) => app.eligible(p) && app.patrolStatus(p) !== 'resigned'));
	const done = $derived(eligible.filter((p) => app.stationResult(p.id)));
	const avg = $derived.by(() => {
		const totals = done.map((p) => app.stationResult(p.id)!.total);
		if (!totals.length) return '–';
		return (totals.reduce((a, b) => a + b, 0) / totals.length).toLocaleString('sv-SE', { maximumFractionDigits: 1 });
	});

	/** Start-station rotation: patrols that started just before this station arrive first. */
	const rotation = $derived.by(() => {
		const order = (app.pack?.stations ?? []).filter((s) => s.dayId === app.station?.dayId).map((s) => s.id);
		return { order, idx: order.indexOf(app.stationId ?? '') };
	});
	const coming = $derived.by(() => {
		const todo = eligible.filter((p) => !app.stationResult(p.id) && app.patrolStatus(p) !== 'finished');
		const n = rotation.order.length;
		const dist = (startId: string | null) => {
			const s = startId ? rotation.order.indexOf(startId) : -1;
			return s < 0 || rotation.idx < 0 ? n + 1 : (rotation.idx - s + n) % n;
		};
		const anyStart = todo.some((p) => p.startStationId);
		return [...todo].sort((a, b) => (anyStart ? dist(a.startStationId) - dist(b.startStationId) : 0) || a.number - b.number).slice(0, 6);
	});
	const codeOf = (id: string | null) => app.pack?.stations.find((s) => s.id === id)?.code ?? '';
	const latestMsg = $derived((app.pack?.messages ?? []).find((m) => !m.read));
	const multi = $derived((app.pack?.myStationIds.length ?? 0) > 1);
</script>

<div class="screen">
	<header>
		<div class="top">
			<span class="hello">Hej {firstName} · {app.pack?.competition.name}</span>
			<SyncPill />
		</div>
		<h1>{app.station ? `${app.station.code} · ${app.station.name}` : 'Välj kontroll'}</h1>
		{#if multi}
			<label class="sr-only" for="st">Kontroll</label>
			<select id="st" value={app.stationId} onchange={(e) => app.selectStation(e.currentTarget.value)}>
				{#each app.pack?.stations.filter((s) => app.pack?.myStationIds.includes(s.id)) ?? [] as s (s.id)}
					<option value={s.id}>{s.code} · {s.name}</option>
				{/each}
			</select>
		{/if}
	</header>

	<main>
		{#if app.pack?.competition.backupMode}
			<div class="backup" role="alert"><Icon name="alert" /> <span><strong>Reservläge:</strong> skriv poängen på papper tills HQ meddelar annat.</span></div>
		{/if}
		{#if latestMsg}
			<a class="msg" href="{base}/messages">
				<Icon name="bell" />
				<span><strong>Nytt från ledningen:</strong> {latestMsg.title}</span>
				<span class="read">Läs</span>
			</a>
		{/if}

		<div class="kpis">
			<div class="kpi"><span class="n" data-testid="kpi-done">{done.length}</span><span class="l">klara</span></div>
			<div class="kpi"><span class="n">{eligible.length - done.length}</span><span class="l">kvar</span></div>
			<div class="kpi"><span class="n">{avg}</span><span class="l">snittpoäng</span></div>
		</div>

		<a class="scan" href="{base}/scan">
			<Icon name="scan" size={44} stroke={2} />
			<span class="scan-text">
				<span class="big">Skanna patrull</span>
				<span class="small">eller tryck för att ange nummer</span>
			</span>
		</a>

		<section aria-labelledby="soon">
			<div class="sec-head">
				<h2 id="soon">Väntas snart</h2>
				{#if coming.some((p) => p.startStationId)}<span class="muted">efter startkontroll</span>{/if}
			</div>
			{#if coming.length}
				<ul class="list">
					{#each coming as p (p.id)}
						<li>
							<a href="{base}/scan?nr={p.number}">
								<span class="nr">{p.number}</span>
								<span class="who">
									<span class="name">{p.name}</span>
									<span class="sub">{p.track} · {shortTroop(p.troop)}{p.startStationId ? ` · start ${codeOf(p.startStationId)}` : ''}</span>
								</span>
								<span class="st">{app.patrolStatus(p) === 'registered' ? 'ej startad' : ''}</span>
							</a>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="all-done">Alla patruller är klara här. {done.length ? `Senast ${hhmm(Math.max(...done.map((p) => app.stationResult(p.id)!.at)))}.` : ''}</p>
			{/if}
		</section>
	</main>

	<TabBar current="home" />
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
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.top {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 8px;
	}
	.hello {
		font-size: 14px;
		font-weight: 700;
		color: var(--ink-2);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	h1 {
		font-size: 30px;
		font-weight: 800;
	}
	main {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 4px 16px 16px;
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	.msg,
	.backup {
		display: flex;
		gap: 10px;
		align-items: center;
		background: var(--accent-tint);
		border: 1.5px solid #f7b48f;
		border-radius: var(--r-md);
		padding: 12px 14px;
		color: var(--ink);
		text-decoration: none;
		font-size: 15px;
		min-height: 56px;
	}
	.msg :global(svg),
	.backup :global(svg) {
		color: var(--accent);
		flex: none;
	}
	.msg span:nth-child(2) {
		flex: 1;
	}
	.read {
		font-weight: 800;
		color: var(--accent-ink);
	}
	.kpis {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 8px;
	}
	.kpi {
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: var(--r-md);
		padding: 12px 14px;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.n {
		font-family: var(--font-display);
		font-weight: 800;
		font-size: 34px;
		line-height: 1;
	}
	.l {
		font-size: 13px;
		font-weight: 700;
		color: var(--ink-2);
	}
	.scan {
		flex: none;
		height: 112px;
		border-radius: var(--r-xl);
		background: var(--accent);
		color: #fff;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 16px;
		text-decoration: none;
	}
	.scan:hover {
		color: #fff;
		background: var(--accent-ink);
	}
	.scan-text {
		display: flex;
		flex-direction: column;
	}
	.big {
		font-family: var(--font-display);
		font-weight: 800;
		font-size: 28px;
		line-height: 1.1;
	}
	.small {
		font-size: 15px;
		color: #ffe3d3;
		font-weight: 600;
	}
	.sec-head {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		margin-bottom: 8px;
	}
	h2 {
		font-size: 18px;
	}
	.sec-head .muted {
		font-size: 13px;
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
		border-top: 1px solid #eef1ee;
	}
	.list a {
		display: flex;
		align-items: center;
		gap: 12px;
		min-height: 60px;
		color: var(--ink);
		text-decoration: none;
	}
	.nr {
		min-width: 52px;
		height: 42px;
		border-radius: 11px;
		background: var(--sage-tint);
		display: flex;
		align-items: center;
		justify-content: center;
		font-family: var(--font-display);
		font-weight: 800;
		font-size: 19px;
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
	.sub {
		font-size: 13px;
		color: var(--ink-2);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.st {
		font-size: 13px;
		font-weight: 700;
		color: var(--ink-3);
	}
	.all-done {
		margin: 0;
		background: var(--moss-tint);
		color: var(--forest-2);
		font-weight: 700;
		border-radius: var(--r-md);
		padding: 14px;
	}
	select {
		margin-top: 6px;
		min-height: 52px;
		font-weight: 700;
	}
</style>

<script lang="ts">
	import '#lib/ui/patrols/prep.css';

	let { data } = $props();
	let names = $state(false);

	const base = $derived(`/admin/${data.competition.slug}/print`);
	const half = $derived(Math.ceil(data.patrols / 2));
</script>

<svelte:head><title>Utskrifter · {data.competition.name}</title></svelte:head>

<div class="prep">
	<header class="prep-head">
		<div>
			<h1>Utskrifter</h1>
			<p>Allt papper du behöver — och reservrutinen om tekniken krånglar. Varje utskrift öppnas som A4-sidor.</p>
		</div>
	</header>

	<ul class="cards">
		<li class="card pc">
			<div class="top"><h2>Kontrollskyltar</h2><span class="tag new">En per kontroll</span></div>
			<p class="muted">Stor kontrollkod, namn och QR-kod som funktionären skannar för att öppna kontrollen i mobilen.</p>
			<p class="count"><strong>{data.stations}</strong> skyltar{#if data.withInvite < data.stations}<span class="warn"> · {data.stations - data.withInvite} saknar inbjudan</span>{/if}</p>
			<a class="btn btn-primary" href="{base}/signs">Öppna kontrollskyltar</a>
		</li>
		<li class="card pc">
			<div class="top"><h2>Reservprotokoll</h2><span class="tag rec">Rekommenderas</span></div>
			<p class="muted">Poänglistor per kontroll att ringa in — om mobilen dör. Patrullerna i väntad ankomstordning.</p>
			<p class="count"><strong>{data.stations}</strong> protokoll</p>
			<a class="btn btn-primary" href="{base}/protocol">Öppna reservprotokoll</a>
		</li>
		<li class="card pc">
			<div class="top"><h2>Poängkort</h2></div>
			<p class="muted">Patrullens eget kort med QR-kod och en ruta per kontroll{data.competition.multiDay ? ', dag för dag' : ''}. Två kort per A4.</p>
			<p class="count"><strong>{data.patrols}</strong> kort · {half} ark</p>
			<label class="opt"><input type="checkbox" bind:checked={names} /> Visa kontrollernas namn</label>
			<a class="btn btn-primary" href="{base}/scorecards{names ? '?names=1' : ''}">Öppna poängkort</a>
		</li>
		<li class="card pc">
			<div class="top"><h2>Startlistor</h2></div>
			<p class="muted">Vilka patruller som startar på vilken kontroll.</p>
			<p class="count">
				{#if data.distributed}<strong>{data.startStations}</strong> listor{:else}<span class="warn">Startkontrollerna är inte fördelade ännu</span>{/if}
			</p>
			{#if data.distributed}
				<a class="btn btn-primary" href="{base}/startlists">Öppna startlistor</a>
			{:else}
				<a class="btn" href="/admin/{data.competition.slug}/distribution">Fördela start</a>
			{/if}
		</li>
	</ul>
</div>

<style>
	.cards {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
		gap: 16px;
	}
	.pc {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.pc .btn {
		margin-top: auto;
	}
	.top {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 8px;
	}
	h2 {
		font-size: 20px;
	}
	.pc p {
		margin: 0;
		font-size: 14px;
	}
	.count strong {
		font-family: var(--font-display);
		font-size: 26px;
	}
	.warn {
		color: var(--accent-ink);
		font-weight: 700;
	}
	.tag {
		font-size: 11px;
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.tag.new {
		color: var(--forest-2);
	}
	.tag.rec {
		color: var(--accent-ink);
	}
	.opt {
		display: flex;
		gap: 8px;
		align-items: center;
		font-weight: 700;
		font-size: 14px;
		min-height: 40px;
	}
	.opt input {
		width: 20px;
		height: 20px;
		accent-color: var(--forest);
	}
</style>

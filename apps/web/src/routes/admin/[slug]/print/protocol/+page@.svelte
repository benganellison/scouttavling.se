<script lang="ts">
	import '#lib/ui/patrols/print.css';
	import PrintBar from '#lib/ui/patrols/PrintBar.svelte';
	import PrintEventLogo from '#lib/ui/brand/PrintEventLogo.svelte';
	import ScouternaLogo from '#lib/ui/brand/ScouternaLogo.svelte';

	let { data } = $props();

	const rowsOf = (values: number[]) => (values.length > 11 ? [values.slice(0, 11), values.slice(11)] : [values]);
</script>

<svelte:head><title>Reservprotokoll · {data.competition.name}</title></svelte:head>

<div class="print-root">
	<PrintBar back="/admin/{data.competition.slug}/print" title="Reservprotokoll" meta="{data.pages.length} sidor · {data.distributed ? 'i väntad ankomstordning' : 'i nummerordning'}" />
	<div class="sheets">
		{#each data.pages as p (p.key)}
			<section class="sheet proto" aria-label="Reservprotokoll {p.code} {p.station}">
				<header>
					<PrintEventLogo logo={data.branding.eventLogo} mm={15} />
					<div>
						<span class="eyebrow">Reservprotokoll · {data.competition.name}</span>
						<h1>{p.code} {p.station}{#if p.item}<span class="item"> · {p.item}</span>{/if}</h1>
						<span class="rule">{p.rule}</span>
					</div>
				</header>

				<div class="steps">
					<div><strong>1. Ringa in</strong> poängen för varje patrull. Skriv tiden.</div>
					<div><strong>2. Skriv också</strong> poängen på patrullens eget poängkort.</div>
					<div><strong>3. Lämna arket</strong> i mål eller fota det till tävlingsledningen.</div>
				</div>

				<table class:nostyle={!p.style.length} class:novalues={!p.values}>
					<thead>
						<tr>
							<th scope="col" class="c-nr">Nr</th>
							<th scope="col">Patrull · klass</th>
							<th scope="col" class="c-time">Tid</th>
							<th scope="col">{p.values ? 'Poäng — ringa in' : p.rule.startsWith('Bara') ? 'Signatur' : 'Poäng'}</th>
							{#if p.style.length}<th scope="col" class="c-style">Stil — ringa in</th>{/if}
						</tr>
					</thead>
					<tbody>
						{#each p.rows as r (r.nr)}
							<tr>
								<td class="nr">{r.nr}</td>
								<td><span class="pn">{r.name}</span><span class="pt">{r.track}</span></td>
								<td><span class="line"></span></td>
								<td>
									{#if p.values}
										<div class="digits">
											{#each rowsOf(p.values) as row, ri (ri)}
												<div class="drow">{#each row as d (d)}<span>{d}</span>{/each}</div>
											{/each}
										</div>
									{:else}
										<span class="line wide"></span>
									{/if}
								</td>
								{#if p.style.length}
									<td><div class="drow style">{#each p.style as d (d)}<span>{d}</span>{/each}</div></td>
								{/if}
							</tr>
						{:else}
							<tr><td colspan="5">Inga patruller i de klasser som gör den här kontrollen.</td></tr>
						{/each}
					</tbody>
				</table>

				{#if p.page === p.pages}
					<div class="extra">
						<strong>Patruller som inte står på listan</strong>
						<div class="blank"><span></span><span></span></div>
					</div>
				{/if}

				<footer>
					<span>Funktionär: ______________________{#if data.competition.hqPhone} · Tävlingsledningen: {data.competition.hqPhone}{/if}</span>
					<span>Sida {p.page} av {p.pages} · utskriven {data.printedAt}</span>
					<ScouternaLogo print />
				</footer>
			</section>
		{/each}
	</div>
</div>

<style>
	.proto {
		gap: 12px;
		padding: 12mm 13mm;
	}
	header {
		display: flex;
		gap: 14px;
		align-items: center;
		border-bottom: 3px solid #000000;
		padding-bottom: 10px;
	}
	.eyebrow {
		font-size: 10pt;
		font-weight: 800;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}
	h1 {
		font-size: 26pt;
		line-height: 1.05;
	}
	.item {
		font-size: 18pt;
	}
	.rule {
		font-size: 12pt;
	}
	.steps {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 8px;
		font-size: 12pt;
		line-height: 1.35;
	}
	.steps div {
		border: 1.5px solid #000000;
		border-radius: 8px;
		padding: 6px 8px;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 12pt;
		table-layout: fixed;
	}
	th {
		text-align: left;
		font-weight: 800;
		padding: 5px 4px;
		border-top: 2px solid #000000;
		border-bottom: 2px solid #000000;
		font-size: 11pt;
	}
	td {
		padding: 4px 4px;
		border-bottom: 1px solid #7d8794;
		vertical-align: middle;
	}
	.c-nr {
		width: 13mm;
	}
	.c-time {
		width: 17mm;
	}
	.c-style {
		width: 40mm;
	}
	table:not(.novalues) th:nth-child(4) {
		width: 86mm;
	}
	.nostyle:not(.novalues) th:nth-child(4) {
		width: 110mm;
	}
	.nr {
		font-weight: 800;
		font-size: 13pt;
	}
	.pn {
		display: block;
		font-weight: 700;
		line-height: 1.15;
	}
	.pt {
		display: block;
		font-size: 9pt;
	}
	.line {
		display: block;
		border-bottom: 1px solid #000000;
		height: 18px;
		width: 13mm;
	}
	.line.wide {
		width: 60mm;
	}
	.digits {
		display: flex;
		flex-direction: column;
		gap: 1px;
	}
	.drow {
		display: grid;
		grid-template-columns: repeat(11, minmax(0, 1fr));
		justify-items: center;
		font-size: 11.5pt;
		font-weight: 700;
		line-height: 1.3;
	}
	.drow.style {
		grid-template-columns: repeat(6, minmax(0, 1fr));
		font-size: 13pt;
	}
	.extra {
		display: flex;
		flex-direction: column;
		gap: 6px;
		font-size: 12pt;
	}
	.blank {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 20px;
	}
	.blank span {
		border-bottom: 1px solid #000000;
		height: 26px;
	}
	footer {
		margin-top: auto;
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 12px;
		font-size: 10pt;
		border-top: 1px solid #000000;
		padding-top: 6px;
	}
</style>

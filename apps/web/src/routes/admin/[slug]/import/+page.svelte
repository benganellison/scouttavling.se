<script lang="ts">
	import '#lib/ui/patrols/prep.css';
	import { deserialize } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import {
		FIELD_LABELS,
		buildImport,
		guessColumns,
		isScoutnetExport,
		mergeTroops,
		parseFileText,
		parseMembers,
		type ColumnGuess,
		type ImportRow,
		type ParsedMember,
		type Table,
		type TargetField
	} from '@scouttavling/domain';

	let { data } = $props();

	/*
	 * Everything below runs in the browser: the file is read and parsed here,
	 * and only the allow-listed, mapped fields are ever sent to the server.
	 * Sensitive columns (personnummer etc.) are never mapped and never leave.
	 */

	type Step = 1 | 2 | 3 | 4;
	const STEPS: { n: Step; label: string }[] = [
		{ n: 1, label: 'Fil' },
		{ n: 2, label: 'Kolumner' },
		{ n: 3, label: 'Granska' },
		{ n: 4, label: 'Klart' }
	];

	let step = $state<Step>(1);
	let fileName = $state('');
	let table = $state<Table>([]);
	let columns = $state<ColumnGuess[]>([]);
	let fileError = $state('');
	let pasteOpen = $state(false);
	let pasteText = $state('');
	let dragging = $state(false);

	let trackFix = $state<Record<string, { create: true } | { to: string }>>({});
	let mapChoice = $state<Record<string, string>>({});
	let merged = $state<string[][]>([]);
	let memberFix = $state<Record<number, ParsedMember[]>>({});
	let memberDraft = $state<Record<number, string>>({});
	let membersOpen = $state(false);

	let submitting = $state(false);
	let submitError = $state('');
	let done = $state<{ imported: number; created: number; updated: number; linked: number; members: number } | null>(null);

	const scoutnet = $derived(table.length > 0 && isScoutnetExport(table[0]));
	const sensitive = $derived(columns.filter((c) => c.sensitive));
	const mappable = $derived(columns.filter((c) => !c.sensitive));
	const unusedCount = $derived(mappable.filter((c) => c.field === 'ignore').length);
	const knownTracks = $derived(data.tracks.map((t) => t.name));
	const base = $derived(step >= 3 && table.length ? buildImport(table, columns, knownTracks) : { rows: [] as ImportRow[], skipped: 0, issues: [] });

	const isKnown = (t: string) => knownTracks.some((k) => k.toLowerCase() === t.toLowerCase());

	/** Scoutnet: the person who registered is the contact when no contact column is mapped. */
	const nameCols = $derived.by(() => {
		if (columns.some((c) => c.field === 'contactName')) return null;
		const h = table[0] ?? [];
		const f = h.indexOf('Förnamn');
		const l = h.indexOf('Efternamn');
		return f >= 0 && l >= 0 ? { f, l } : null;
	});
	const rows = $derived.by(() => {
		const data = table.slice(1).filter((r) => !base.skipped || !columns.some((c) => c.field === 'registered' && (r[c.index] ?? '').toLowerCase() === 'nej'));
		let out = base.rows.map((r, i) => {
			const src = nameCols ? data[i] : undefined;
			const contactName = src ? `${src[nameCols!.f] ?? ''} ${src[nameCols!.l] ?? ''}`.trim() : r.contactName;
			const fix = r.trackText ? trackFix[r.trackText] : undefined;
			const trackText = fix && 'to' in fix ? fix.to : r.trackText;
			return { ...r, contactName, trackText, members: memberFix[i] ?? r.members, _i: i, _unknown: !!r.trackText && !isKnown(r.trackText) && !fix };
		});
		for (const group of merged) out = mergeTroops(out, group) as typeof out;
		return out;
	});
	const importable = $derived(rows.filter((r) => r.patrolName.trim()));

	function matchStatus(r: { patrolName: string; contactMemberNo: string }) {
		const name = r.patrolName.trim().toLowerCase();
		const both = r.contactMemberNo && data.existing.find((e) => e.contactMemberNo === r.contactMemberNo && e.name.toLowerCase() === name);
		return both || data.existing.find((e) => e.name.toLowerCase() === name) ? 'update' : 'new';
	}

	type RowStatus = { label: string; cls: string };
	function rowStatus(r: (typeof rows)[number]): RowStatus {
		if (!r.patrolName.trim()) return { label: 'Hoppas över', cls: 'pill-bad' };
		if (r._unknown) return { label: 'Okänd klass', cls: 'pill-bad' };
		if (!memberFix[r._i] && r.members.some((m) => m.uncertain)) return { label: 'Granska', cls: 'pill-warn' };
		return matchStatus(r) === 'update' ? { label: 'Uppdateras', cls: '' } : { label: 'Ny', cls: 'pill-ok' };
	}

	const counts = $derived.by(() => {
		let created = 0;
		let updated = 0;
		for (const r of importable) (matchStatus(r) === 'update' ? updated++ : created++);
		return { created, updated, members: importable.reduce((a, r) => a + r.members.length, 0) };
	});
	const unresolvedTracks = $derived(base.issues.filter((i) => i.kind === 'unknownTrack' && !trackFix[i.values[0]]).length);
	const unclearRows = $derived(base.rows.map((r, i) => ({ r, i })).filter(({ r }) => r.members.some((m) => m.uncertain)));
	const openIssues = $derived(
		base.issues.filter((i) =>
			i.kind === 'unknownTrack' ? !trackFix[i.values[0]] : i.kind === 'troopSpelling' ? !isMerged(i.values) : i.kind === 'members' ? unclearRows.some(({ i: ix }) => !memberFix[ix]) : i.kind === 'missingName'
		).length
	);

	function isMerged(values: string[]) {
		return merged.some((g) => g.join('|') === values.join('|'));
	}

	// ---------- step 1: reading ----------

	function readAs(file: File, encoding: string): Promise<string> {
		return new Promise((resolve, reject) => {
			const fr = new FileReader();
			fr.onload = () => resolve(String(fr.result ?? ''));
			fr.onerror = () => reject(fr.error);
			fr.readAsText(file, encoding);
		});
	}

	async function onFile(file: File | undefined | null) {
		fileError = '';
		if (!file) return;
		if (/\.(xlsx|xlsm|ods|numbers)$/i.test(file.name)) {
			fileError = 'Den här filtypen kan inte läsas ännu. Öppna filen i Excel och välj Arkiv → Spara som → CSV, och välj sedan CSV-filen här.';
			return;
		}
		let text = await readAs(file, 'utf-8');
		if (text.startsWith('PK\u0003\u0004')) {
			fileError = 'Filen ser ut att vara en Excel-arbetsbok (.xlsx). Spara som CSV i Excel och försök igen.';
			return;
		}
		if (text.includes('�')) text = await readAs(file, 'windows-1252');
		loadText(file.name, text);
	}

	function loadText(name: string, text: string) {
		const t = parseFileText(name, text).filter((r) => r.some((c) => c.trim()));
		if (t.length < 2) {
			fileError = 'Hittade inga rader. Första raden ska vara kolumnrubriker och sedan en rad per patrull.';
			return;
		}
		fileName = name;
		table = t;
		columns = guessColumns(t);
		trackFix = {};
		mapChoice = {};
		merged = [];
		memberFix = {};
		memberDraft = {};
		done = null;
		submitError = '';
		step = 2;
	}

	function usePaste() {
		fileError = '';
		if (!pasteText.trim()) {
			fileError = 'Klistra in rader först (med rubrikrad).';
			return;
		}
		loadText('Inklistrat', pasteText);
	}

	function onDrop(e: DragEvent) {
		e.preventDefault();
		dragging = false;
		void onFile(e.dataTransfer?.files?.[0]);
	}

	// ---------- step 3: fixes ----------

	function createTrack(name: string) {
		trackFix[name] = { create: true };
	}
	function mapTrack(name: string) {
		const to = mapChoice[name] ?? data.tracks[0]?.name;
		if (to) trackFix[name] = { to };
	}
	function undoTrack(name: string) {
		delete trackFix[name];
	}
	function mergeGroup(values: string[]) {
		if (!isMerged(values)) merged.push([...values]);
	}
	function membersToText(ms: ParsedMember[]) {
		return ms.map((m) => [`${m.firstName} ${m.lastName}`.trim(), m.troopText].filter(Boolean).join(', ')).join('\n');
	}
	function startEditMembers() {
		membersOpen = true;
		for (const { r, i } of unclearRows) memberDraft[i] ??= membersToText(memberFix[i] ?? r.members);
	}
	function saveMembers(i: number) {
		memberFix[i] = parseMembers(memberDraft[i] ?? '').map((m) => ({ ...m, uncertain: false }));
	}
	/** Lines such as "+ en till?" are notes, not scouts. */
	const isNote = (m: ParsedMember) => /^[+(]/.test(m.firstName) || /\?/.test(`${m.firstName} ${m.lastName}`);
	function acceptAllMembers() {
		for (const { r, i } of unclearRows) {
			if (memberFix[i]) continue;
			const list = memberDraft[i] !== undefined ? parseMembers(memberDraft[i]) : r.members;
			memberFix[i] = list.filter((m) => !isNote(m)).map((m) => ({ ...m, uncertain: false }));
		}
	}

	// ---------- step 4: commit ----------

	const PHONE_OK = /^[\d +()-]*$/;
	const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

	/** Builds the payload from allow-listed fields only. */
	function payload() {
		const createTracks = Object.entries(trackFix)
			.filter(([, f]) => 'create' in f)
			.map(([name]) => name);
		return {
			rows: importable.map((r) => ({
				patrolName: r.patrolName.trim(),
				trackText: r.trackText.trim(),
				troop: r.troop.trim(),
				contactName: r.contactName.trim(),
				contactPhone: PHONE_OK.test(r.contactPhone) ? r.contactPhone : '',
				contactEmail: EMAIL_OK.test(r.contactEmail) ? r.contactEmail : '',
				contactMemberNo: r.contactMemberNo.slice(0, 10),
				members: r.members.map((m) => ({ firstName: m.firstName, lastName: m.lastName, troopText: m.troopText })),
				paid: r.paid
			})),
			createTracks
		};
	}

	async function commit() {
		submitError = '';
		submitting = true;
		try {
			const fd = new FormData();
			fd.set('payload', JSON.stringify(payload()));
			const res = await fetch('?/commit', { method: 'POST', body: fd, headers: { 'x-sveltekit-action': 'true', accept: 'application/json' } });
			const result = deserialize(await res.text());
			if (result.type === 'success' && result.data?.done) {
				done = result.data.done as typeof done;
				step = 4;
				await invalidateAll();
			} else if (result.type === 'failure') {
				submitError = String(result.data?.message ?? 'Importen misslyckades');
			} else {
				submitError = 'Importen misslyckades. Försök igen.';
			}
		} catch {
			submitError = 'Kunde inte nå servern. Kontrollera anslutningen och försök igen.';
		} finally {
			submitting = false;
		}
	}

	const base_ = $derived(`/admin/${data.competition.slug}`);
	const fieldOptions = Object.entries(FIELD_LABELS) as [TargetField, string][];
	const canGo = (n: Step) => (n === 1 ? step !== 4 : n === 2 ? table.length > 0 && step !== 4 : n === 3 ? table.length > 0 && step !== 4 : step === 4);
</script>

<svelte:head><title>Importera patruller · {data.competition.name}</title></svelte:head>

<div class="prep">
	<header class="prep-head">
		<div>
			<h1>Importera patruller</h1>
			<p>När anmälan skett någon annanstans — Scoutnet, ett formulär eller ett kalkylark.</p>
		</div>
		<ol class="steps" aria-label="Steg">
			{#each STEPS as s (s.n)}
				<li>
					<button type="button" class:cur={step === s.n} class:past={step > s.n} aria-current={step === s.n ? 'step' : undefined} disabled={!canGo(s.n)} onclick={() => (step = s.n)}>
						<span class="sn">{s.n}</span>{s.label}
					</button>
				</li>
			{/each}
		</ol>
	</header>

	{#if step === 1}
		<section
			class="drop"
			class:dragging
			aria-labelledby="drop-h"
			ondragover={(e) => {
				e.preventDefault();
				dragging = true;
			}}
			ondragleave={() => (dragging = false)}
			ondrop={onDrop}
		>
			<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5"></path><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"></path></svg>
			<h2 id="drop-h">Släpp filen här</h2>
			<p class="muted">Scoutnet-export (.xls) eller CSV — eller klistra in rader direkt från ett kalkylark.</p>
			<div class="row" style="justify-content:center">
				<label class="btn btn-primary file">
					Välj fil
					<input type="file" accept=".xls,.csv,.txt,.tsv,.html,.htm,.xlsx" onchange={(e) => onFile(e.currentTarget.files?.[0])} />
				</label>
				<button type="button" class="btn" aria-expanded={pasteOpen} onclick={() => (pasteOpen = !pasteOpen)}>Klistra in</button>
			</div>
			<p class="muted small">Tips: i Scoutnet, öppna arrangemanget → Deltagare → Exportera. Filen tolkas här i webbläsaren och laddas inte upp.</p>
			{#if fileError}<p class="error-text" role="alert">{fileError}</p>{/if}
		</section>
		{#if pasteOpen}
			<section class="card stack">
				<div class="field">
					<label for="paste">Klistra in rader (första raden är rubriker)</label>
					<textarea id="paste" rows="8" bind:value={pasteText} placeholder={'Patrullnamn\tKlass\tKår\nEkorrarna\tUpptäckare\tExempelkåren'}></textarea>
				</div>
				<div><button type="button" class="btn btn-primary" onclick={usePaste}>Läs in raderna</button></div>
			</section>
		{/if}
	{:else if step === 2}
		<div class="notice" class:notice-warn={!scoutnet}>
			<span class="grow">
				<strong>{fileName}</strong> · {table.length - 1} rader · {columns.length} kolumner{#if scoutnet}
					· känd som <strong>Scoutnet-export</strong> — kolumnerna är redan kopplade.{:else}
					· kontrollera kopplingen nedan.{/if}
			</span>
			<button type="button" class="btn btn-sm" onclick={() => (step = 1)}>Byt fil</button>
		</div>
		<div class="split">
			<section class="card map" aria-labelledby="map-h">
				<h2 id="map-h">Vad betyder kolumnerna?</h2>
				<div class="map-wrap">
					<table class="prep-table">
						<thead><tr><th scope="col">Kolumn i filen</th><th scope="col">Blir</th><th scope="col">Exempel</th></tr></thead>
						<tbody>
							{#each mappable as c (c.index)}
								<tr class:ignored={c.field === 'ignore'}>
									<td class="colname">{c.header || `Kolumn ${c.index + 1}`}</td>
									<td>
										<label class="sr-only" for="map{c.index}">Fält för {c.header}</label>
										<select id="map{c.index}" bind:value={c.field}>
											{#each fieldOptions as [f, label] (f)}<option value={f}>{label}</option>{/each}
										</select>
									</td>
									<td class="ex">{c.example}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</section>
			<section class="never" aria-labelledby="never-h">
				<h2 id="never-h">
					<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"></rect><path d="M8 11V7a4 4 0 0 1 8 0v4"></path></svg>
					Läses aldrig in
				</h2>
				<p>Känsliga uppgifter som tävlingen inte behöver. De lämnar aldrig din dator — filen tolkas i webbläsaren.</p>
				{#if sensitive.length}
					<ul class="chips" aria-label="Kolumner som aldrig läses in">
						{#each sensitive as c (c.index)}<li><s>{c.header}</s></li>{/each}
					</ul>
				{:else}
					<p class="small">Inga känsliga kolumner hittades i filen.</p>
				{/if}
				{#if unusedCount}<p class="small">+ {unusedCount} övriga kolumner som inte används</p>{/if}
			</section>
		</div>
		<div class="row end">
			<button type="button" class="btn" onclick={() => (step = 1)}>Tillbaka</button>
			<button type="button" class="btn btn-accent" disabled={!columns.some((c) => c.field === 'patrolName')} onclick={() => (step = 3)}>Granska</button>
		</div>
		{#if !columns.some((c) => c.field === 'patrolName')}<p class="error-text end-text">Koppla en kolumn till Patrullnamn för att fortsätta.</p>{/if}
	{:else if step === 3}
		<div class="kpis">
			<div class="kpi"><span>Att importera</span><strong>{importable.length}</strong></div>
			<div class="kpi"><span>Nya</span><strong class="good">{counts.created}</strong></div>
			<div class="kpi"><span>Uppdateras</span><strong>{counts.updated}</strong></div>
			<div class="kpi"><span>Scouter</span><strong>{counts.members}</strong></div>
		</div>
		<div class="split">
			<section class="card issues" aria-labelledby="fix-h">
				<h2 id="fix-h">Att titta på {#if openIssues}<span class="open">· {openIssues}</span>{/if}</h2>
				{#each base.issues as issue (issue.kind + issue.values.join('|'))}
					{#if issue.kind === 'unknownTrack'}
						{@const name = issue.values[0]}
						{@const fix = trackFix[name]}
						<div class="issue" class:resolved={!!fix}>
							<strong>{issue.message}</strong>
							{#if !fix}
								<span class="muted">Skapa klassen eller lägg patrullerna i en befintlig klass.</span>
								<div class="row">
									<button type="button" class="btn btn-primary btn-sm" onclick={() => createTrack(name)}>Skapa klassen</button>
									{#if data.tracks.length}
										<label class="sr-only" for="mapto-{name}">Befintlig klass för {name}</label>
										<select id="mapto-{name}" class="sel-sm" bind:value={mapChoice[name]}>
											{#each data.tracks as t (t.id)}<option value={t.name}>{t.name}</option>{/each}
										</select>
										<button type="button" class="btn btn-sm" onclick={() => mapTrack(name)}>Lägg i {mapChoice[name] ?? data.tracks[0].name}</button>
									{/if}
								</div>
							{:else}
								<span class="ok">
									{'create' in fix ? `Klassen ”${name}” skapas vid importen.` : `Läggs i ${fix.to}.`}
									<button type="button" class="link" onclick={() => undoTrack(name)}>Ångra</button>
								</span>
							{/if}
						</div>
					{:else if issue.kind === 'troopSpelling'}
						{@const isDone = isMerged(issue.values)}
						<div class="issue" class:resolved={isDone}>
							<strong>{issue.message}</strong>
							{#if !isDone}
								<div class="row"><button type="button" class="btn btn-primary btn-sm" onclick={() => mergeGroup(issue.values)}>Slå ihop till ”{issue.values[0]}”</button></div>
							{:else}
								<span class="ok">Sammanslagna till ”{issue.values[0]}”.</span>
							{/if}
						</div>
					{:else if issue.kind === 'members'}
						{@const left = unclearRows.filter(({ i }) => !memberFix[i]).length}
						<div class="issue" class:resolved={left === 0}>
							<strong>{issue.message}</strong>
							<span class="muted">Rader som ”+ en till?” eller bara förnamn. Kontrollera och rätta, en scout per rad.</span>
							{#if !membersOpen}
								<div class="row"><button type="button" class="btn btn-primary btn-sm" onclick={startEditMembers}>Visa och rätta</button></div>
							{:else}
								<div class="stack mem-list">
									{#each unclearRows as { r, i } (i)}
										<div class="field">
											<label for="mem{i}">{r.patrolName || 'Utan namn'} {#if memberFix[i]}<span class="ok-inline">klar</span>{/if}</label>
											<textarea id="mem{i}" rows={Math.min(8, Math.max(3, (memberDraft[i] ?? '').split('\n').length + 1))} bind:value={memberDraft[i]}></textarea>
											<div><button type="button" class="btn btn-sm" onclick={() => saveMembers(i)}>Spara {r.patrolName}</button></div>
										</div>
									{/each}
									{#if left}<div><button type="button" class="btn btn-primary btn-sm" onclick={acceptAllMembers}>Godkänn resten (utan anteckningar)</button></div>{/if}
								</div>
							{/if}
							{#if left === 0}<span class="ok">Medlemslistorna är granskade.</span>{/if}
						</div>
					{:else}
						<div class="issue info" class:warn={issue.kind === 'missingName'}>
							<strong>{issue.message}</strong>
							{#if issue.kind === 'missingName'}<span class="muted">Raderna utan patrullnamn importeras inte.</span>{/if}
						</div>
					{/if}
				{:else}
					<p class="muted">Inget att anmärka. Snyggt!</p>
				{/each}
			</section>

			<section class="card preview" aria-labelledby="pv-h">
				<h2 id="pv-h">Patrullerna</h2>
				<div class="pv-wrap">
					<table class="prep-table">
						<thead><tr><th scope="col">Patrull</th><th scope="col">Klass</th><th scope="col">Kår</th><th scope="col">Kontakt</th><th scope="col">Scouter</th><th scope="col">Status</th></tr></thead>
						<tbody>
							{#each rows as r (r._i)}
								{@const st = rowStatus(r)}
								<tr>
									<td class="strong">{r.patrolName || '—'}</td>
									<td class:bad={r._unknown}>{r.trackText || '—'}</td>
									<td>{r.troop}</td>
									<td>{r.contactName}</td>
									<td class="num">{r.members.length}</td>
									<td><span class="pill {st.cls}">{st.label}</span></td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</section>
		</div>
		{#if submitError}<p class="error-text" role="alert">{submitError}</p>{/if}
		<div class="row end">
			<button type="button" class="btn" onclick={() => (step = 2)}>Tillbaka</button>
			<button type="button" class="btn btn-accent" disabled={submitting || unresolvedTracks > 0 || importable.length === 0} onclick={commit}>
				{submitting ? 'Importerar…' : `Importera ${importable.length} patruller`}
			</button>
		</div>
		{#if unresolvedTracks}<p class="muted end-text">Välj vad som ska hända med okända klasser först.</p>{/if}
	{:else if step === 4 && done}
		<section class="donebox" role="status">
			<h2>{done.imported} patruller importerade.</h2>
			<p>
				{done.created} nya, {done.updated} uppdaterade, {done.members} scouter.
				{#if done.linked}{done.linked} kontaktpersoner är kopplade till ScoutID via medlemsnummer.{/if}
			</p>
			<div class="row">
				<a class="btn btn-accent" href="{base_}/distribution">Fördela startkontroller</a>
				<a class="btn btn-onforest" href="{base_}/patrols">Patruller</a>
			</div>
			<p class="small">Kommer det en ny export senare? Importera igen — patruller matchas på medlemsnummer och patrullnamn, så inget dubbleras.</p>
		</section>
	{/if}
</div>

<style>
	.steps {
		list-style: none;
		margin: 0;
		padding: 4px;
		display: flex;
		gap: 4px;
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: 999px;
		flex-wrap: wrap;
	}
	.steps button {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		min-height: 40px;
		padding: 0 14px 0 6px;
		border-radius: 999px;
		border: 0;
		background: transparent;
		font-weight: 700;
		font-size: 14px;
		color: var(--ink-2);
		cursor: pointer;
	}
	.steps button:disabled {
		cursor: default;
		opacity: 0.7;
	}
	.steps .sn {
		width: 28px;
		height: 28px;
		border-radius: 999px;
		background: var(--tint);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font-weight: 800;
	}
	.steps .cur {
		background: var(--brand);
		color: #fff;
		font-weight: 800;
	}
	.steps .cur .sn {
		background: var(--orange);
		color: var(--ink);
	}
	.steps .past .sn {
		background: var(--ok-tint);
		color: var(--brand-2);
	}
	.drop {
		background: var(--surface);
		border: 2px dashed #7d8794;
		border-radius: var(--r-xl);
		padding: 48px 24px;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 12px;
		text-align: center;
		color: var(--brand);
	}
	.drop.dragging {
		border-color: var(--brand);
		background: var(--ok-tint);
	}
	.drop h2 {
		font-size: 26px;
		color: var(--ink);
	}
	.drop p {
		margin: 0;
	}
	.file {
		position: relative;
		overflow: hidden;
	}
	.file input {
		position: absolute;
		inset: 0;
		opacity: 0;
		cursor: pointer;
	}
	.file:focus-within {
		outline: 3px solid var(--orange);
		outline-offset: 2px;
	}
	.small {
		font-size: 13px;
	}
	.grow {
		flex: 1 1 300px;
	}
	.split {
		display: flex;
		flex-wrap: wrap;
		gap: 16px;
		align-items: flex-start;
	}
	.split > .card:first-child {
		flex: 999 1 520px;
		min-width: 0;
	}
	.split h2 {
		font-size: 17px;
		margin-bottom: 8px;
	}
	.map-wrap,
	.pv-wrap {
		overflow-x: auto;
		margin: 0 -20px;
	}
	.map select {
		min-height: 40px;
		font-size: 14px;
		font-weight: 700;
		min-width: 190px;
	}
	.colname {
		font-weight: 700;
		line-height: 1.3;
	}
	.ex {
		font-size: 13px;
		color: var(--ink-2);
		white-space: pre-line;
		max-width: 260px;
	}
	tr.ignored .colname {
		color: var(--ink-3);
		font-weight: 600;
	}
	.never {
		flex: 1 1 300px;
		min-width: 0;
		background: var(--brand-dark);
		color: #fff;
		border-radius: 20px;
		padding: 18px 20px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.never h2 {
		display: flex;
		align-items: center;
		gap: 8px;
		color: #fff;
		margin: 0;
	}
	.never h2 svg {
		color: var(--on-brand-hi);
	}
	.never p {
		margin: 0;
		color: var(--on-brand);
		font-size: 14px;
	}
	.chips {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.chips li {
		font-size: 13px;
		font-weight: 700;
		padding: 6px 10px;
		border-radius: 999px;
		background: var(--brand-dark);
		color: var(--on-brand);
	}
	.chips s {
		text-decoration-color: var(--on-brand-hi);
		text-decoration-thickness: 2px;
	}
	.end {
		justify-content: flex-end;
	}
	.end-text {
		text-align: right;
		margin: 0;
	}
	.issues {
		flex: 1 1 360px !important;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.preview {
		flex: 999 1 520px;
		min-width: 0;
	}
	.open {
		color: var(--warn-ink);
	}
	.issue {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 12px;
		border-radius: 14px;
		background: var(--warn-tint);
		font-size: 14px;
	}
	.issue.resolved,
	.issue.info {
		background: var(--tint);
	}
	.issue.warn {
		background: var(--warn-tint);
	}
	.ok {
		font-weight: 800;
		color: var(--brand-2);
		font-size: 13px;
	}
	.ok-inline {
		font-size: 12px;
		color: var(--brand-2);
		margin-left: 6px;
	}
	.link {
		background: none;
		border: 0;
		padding: 0 4px;
		font: inherit;
		color: var(--brand);
		text-decoration: underline;
		cursor: pointer;
		min-height: 32px;
	}
	.sel-sm {
		min-height: 36px;
		width: auto;
		font-size: 13px;
	}
	.mem-list textarea {
		font-size: 14px;
	}
	.strong {
		font-weight: 800;
	}
	td.bad {
		color: var(--danger);
		font-weight: 800;
	}
	.donebox {
		background: var(--brand);
		color: #fff;
		border-radius: var(--r-xl);
		padding: 36px;
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
	.donebox h2 {
		font-size: 36px;
	}
	.donebox p {
		margin: 0;
		color: var(--on-brand);
		font-size: 16px;
	}
	.donebox .small {
		font-size: 13px;
	}
	.btn-onforest {
		background: transparent;
		border-color: var(--line-on-brand);
		color: #fff;
	}
	.btn-onforest:hover {
		color: #fff;
		border-color: #fff;
	}
</style>

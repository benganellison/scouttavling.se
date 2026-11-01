<script lang="ts">
	/** Read-only list of audit_log rows (names resolved at read time, see #lib/server/audit.ts). */
	interface Row {
		id: string;
		at: Date | string;
		actorKind: string;
		actorName: string;
		actionText: string;
		targetName: string | null;
		targetType: string;
		competition: { slug: string; name: string } | null;
		series: { slug: string; name: string } | null;
		reason: string | null;
		details: Record<string, unknown>;
		subjectName: string | null;
		replacedName?: string | null;
	}
	let { rows, showTarget = false, siteLinks = false }: { rows: Row[]; showTarget?: boolean; siteLinks?: boolean } = $props();

	const KIND: Record<string, string> = { user: 'Användare', site_admin: 'Plattformsadmin', cli: 'Kommandoraden' };
	const fmt = (d: Date | string) => new Date(d).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Stockholm' });
	const roleWord = (r: unknown) => (r === 'owner' ? 'ägare' : r === 'organiser' ? 'arrangör' : null);
	function what(r: Row): string {
		const d = r.details;
		const from = roleWord(d.from);
		const to = roleWord(d.to);
		if (r.replacedName && r.subjectName) return `${r.replacedName} → ${r.subjectName}`;
		if (r.subjectName && (from || to)) return `${r.subjectName}${from && to ? `: ${from} → ${to}` : to ? ` som ${to}` : from ? ` (${from})` : ''}`;
		if (r.subjectName) return r.subjectName;
		if (typeof d.hours === 'number') return `${d.hours} h som arrangör`;
		if (typeof d.patrols === 'number') return `${d.patrols} patruller`;
		return '';
	}
	const targetHref = (r: Row) =>
		!siteLinks ? null : r.competition ? `/site-admin/c/${r.competition.slug}` : r.series ? `/site-admin/s/${r.series.slug}` : null;
</script>

{#if rows.length === 0}
	<p class="muted">Inga händelser än.</p>
{:else}
	<ol class="audit" aria-label="Händelselogg">
		{#each rows as r (r.id)}
			<li data-testid="audit-row">
				<div class="top">
					<time datetime={new Date(r.at).toISOString()}>{fmt(r.at)}</time>
					<span class="pill" class:pill-warn={r.actorKind !== 'user'}>{KIND[r.actorKind] ?? r.actorKind}</span>
				</div>
				<p class="line">
					<strong>{r.actorName}</strong> · {r.actionText}{what(r) ? `: ${what(r)}` : ''}
					{#if showTarget && (r.competition || r.series || r.targetName)}
						{@const href = targetHref(r)}
						<span class="muted">
							· {#if href}<a {href}>{r.competition?.name ?? r.series?.name ?? r.targetName}</a>{:else}{r.competition?.name ??
									r.series?.name ??
									r.targetName}{/if}</span
						>
					{/if}
				</p>
				{#if r.reason}<p class="reason muted">Anledning: {r.reason}</p>{/if}
			</li>
		{/each}
	</ol>
{/if}

<style>
	.audit {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	li {
		padding: 12px 0;
		border-top: 1px solid var(--line);
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.top {
		display: flex;
		gap: 10px;
		align-items: center;
		flex-wrap: wrap;
	}
	time {
		font-size: 13px;
		color: var(--ink-3);
		font-variant-numeric: tabular-nums;
	}
	.line,
	.reason {
		margin: 0;
		overflow-wrap: anywhere;
	}
	.reason {
		font-size: 14px;
	}
</style>

/**
 * Pure helpers shared by the organiser (admin) screens. Safe on client and server.
 */
import type { ItemMode } from '@scouttavling/domain';

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
const WEEKDAYS = ['sön', 'mån', 'tis', 'ons', 'tor', 'fre', 'lör'];

function parts(iso: string) {
	const d = new Date(`${iso}T12:00:00Z`);
	return { wd: WEEKDAYS[d.getUTCDay()], day: d.getUTCDate(), month: MONTHS[d.getUTCMonth()], year: d.getUTCFullYear() };
}

/** "lör 15 maj" */
export function shortDate(iso: string): string {
	const p = parts(iso);
	return `${p.wd} ${p.day} ${p.month}`;
}

/** "15 maj 2027" or "14–16 maj 2027" / "30 apr – 2 maj 2027". */
export function dateRange(start: string, end: string): string {
	const a = parts(start);
	const b = parts(end);
	if (start === end) return `${a.wd} ${a.day} ${a.month} ${a.year}`;
	if (a.month === b.month && a.year === b.year) return `${a.day}–${b.day} ${a.month} ${a.year}`;
	if (a.year === b.year) return `${a.day} ${a.month} – ${b.day} ${b.month} ${a.year}`;
	return `${a.day} ${a.month} ${a.year} – ${b.day} ${b.month} ${b.year}`;
}

/** Today's date in Sweden as ISO yyyy-mm-dd. */
export function todayIso(now = new Date()): string {
	return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function daysUntil(iso: string, now = new Date()): number {
	const a = Date.parse(`${todayIso(now)}T12:00:00Z`);
	const b = Date.parse(`${iso}T12:00:00Z`);
	return Math.round((b - a) / 86400_000);
}

/** URL slug from a competition name: "GökOpen 2027" → "gokopen-2027". */
export function slugify(name: string): string {
	return name
		.toLowerCase()
		.replace(/[åä]/g, 'a')
		.replace(/ö/g, 'o')
		.replace(/é/g, 'e')
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 48)
		.replace(/-+$/g, '');
}

export type CompStatus = 'draft' | 'live' | 'closed';

export const STATUS_LABEL: Record<CompStatus, string> = { draft: 'Utkast', live: 'Live', closed: 'Avslutad' };

/** 1 Före · 2 Tävlingsdag · 3 Efter */
export function phaseOf(c: { status: CompStatus; startDate: string; endDate: string }, now = new Date()): 1 | 2 | 3 {
	if (c.status === 'closed') return 3;
	if (c.status === 'live') return 2;
	const today = todayIso(now);
	if (today > c.endDate) return 3;
	if (today >= c.startDate) return 2;
	return 1;
}

export function greeting(now = new Date()): string {
	const h = Number(new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', hour: '2-digit', hour12: false }).format(now));
	if (h >= 5 && h < 10) return 'God morgon';
	if (h >= 10 && h < 18) return 'God dag';
	return 'God kväll';
}

export const MODE_LABEL: Record<ItemMode, string> = {
	RANGE: 'Intervall',
	DISTINCT: 'Fasta värden',
	COUNT: 'Antal × multiplikator',
	CHECKIN: 'Checkpoint',
	AUTO_ON_SCAN: 'Automatiskt vid skanning'
};

export interface ItemLike {
	mode: ItemMode;
	min: number;
	max: number;
	distinctValues?: { value: number; label?: string }[] | null;
	countMultiplier?: number | null;
	styleEnabled: boolean;
}

/** Short rule text for one item: "0–20", "0/5/10", "0–10 × 2", "Checkpoint". */
export function itemRule(it: ItemLike): string {
	switch (it.mode) {
		case 'RANGE':
			return `${it.min}–${it.max}`;
		case 'DISTINCT': {
			const v = [...new Set((it.distinctValues ?? []).map((d) => d.value))].sort((a, b) => a - b);
			return v.length ? v.join('/') : 'Inga värden';
		}
		case 'COUNT':
			return `${it.min}–${it.max} × ${it.countMultiplier ?? 1}`;
		case 'CHECKIN':
			return 'Checkpoint';
		case 'AUTO_ON_SCAN':
			return 'Automatisk';
	}
}

/** Station row summary: "0–20 + stil · Alla" / "Checkpoint" / "4 delar · Alla". */
export function stationSummary(items: ItemLike[], compStyle: boolean, tracksText: string): string {
	if (items.length === 0) return `Inga delar · ${tracksText}`;
	if (items.length > 1) return `${items.length} delar · ${tracksText}`;
	const it = items[0];
	if (it.mode === 'CHECKIN') return `Checkpoint · ${tracksText}`;
	const style = compStyle && it.styleEnabled && it.mode !== 'AUTO_ON_SCAN' ? ' + stil' : '';
	return `${itemRule(it)}${style} · ${tracksText}`;
}

/** "Alla", "Ej Spårare" or "Upptäckare, Äventyrare". */
export function tracksText(allTracks: boolean, selected: string[], all: { id: string; name: string }[]): string {
	if (allTracks || all.length === 0 || selected.length >= all.length) return 'Alla';
	if (selected.length === 0) return 'Ingen klass';
	const missing = all.filter((t) => !selected.includes(t.id));
	if (missing.length === 1 && all.length > 2) return `Ej ${missing[0].name}`;
	return all.filter((t) => selected.includes(t.id)).map((t) => t.name).join(', ');
}

export interface NavItem {
	label: string;
	href: string;
	/** Path segment that marks this item active ('' = overview). */
	key: string;
}

/** The admin sidebar, grouped by phase (docs/dev/TEAM.md). */
export function adminNav(slug: string): { group: string; items: NavItem[] }[] {
	const b = `/admin/${slug}`;
	return [
		{
			group: 'Före',
			items: [
				{ label: 'Översikt', href: b, key: '' },
				{ label: 'Kontroller', href: `${b}/stations`, key: 'stations' },
				{ label: 'Patruller', href: `${b}/patrols`, key: 'patrols' },
				{ label: 'Importera', href: `${b}/import`, key: 'import' },
				{ label: 'Fördela start', href: `${b}/distribution`, key: 'distribution' },
				{ label: 'Funktionärer', href: `${b}/invites`, key: 'invites' },
				{ label: 'Utskrifter', href: `${b}/print`, key: 'print' },
				{ label: 'Inställningar', href: `${b}/settings`, key: 'settings' }
			]
		},
		{
			group: 'Tävlingsdag',
			items: [
				{ label: 'Ledningscentral', href: `${b}/live`, key: 'live' },
				{ label: 'Start & mål', href: `${b}/invites?role=startfinish`, key: 'invites?startfinish' },
				{ label: 'Meddelanden', href: `${b}/messages`, key: 'messages' }
			]
		},
		{
			group: 'Efter',
			items: [
				{ label: 'Resultat', href: `${b}/results`, key: 'results' },
				{ label: 'Prisutdelning', href: `/r/${slug}/ceremony`, key: 'ceremony' }
			]
		}
	];
}

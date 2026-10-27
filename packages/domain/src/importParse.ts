/**
 * Participant import, run in the BROWSER so sensitive columns never leave the
 * device. Supports Scoutnet event exports (an HTML table saved as .xls) and CSV.
 * Only allow-listed fields are produced; birth data is stripped (decision 2026-10-15).
 */

export type Table = string[][];

export type TargetField =
	| 'patrolName'
	| 'trackText'
	| 'troop'
	| 'contactName'
	| 'contactPhone'
	| 'contactEmail'
	| 'contactMemberNo'
	| 'members'
	| 'registered'
	| 'paid'
	| 'ignore';

export const FIELD_LABELS: Record<TargetField, string> = {
	patrolName: 'Patrullnamn',
	trackText: 'Klass',
	troop: 'Kår',
	contactName: 'Kontaktperson',
	contactPhone: 'Mobil',
	contactEmail: 'E-post',
	contactMemberNo: 'Koppla till ScoutID (medlemsnr)',
	members: 'Medlemmar, en per rad',
	registered: 'Hoppa över om ”Nej”',
	paid: 'Betald',
	ignore: 'Läs inte in'
};

/** Columns that must never be read in, whatever the organiser picks. */
// Anywhere in the column name: health, diet, needs, age, photo consent, guardians, free-text "övrigt".
const DENY = /^personnummer|^födelse|^kön$|(?<!e-?post)adress|^postnummer|^postort|anhörig|registerutdrag|belastning|^trygga möten|allergi|kost|sjukdom|medicin|hälsa|ålder|särskild|behov|foto|bild|övrigt|kommentar|meddelande|vårdnadshavare|förälder|målsman/i;

/** Tested on the column's own name (the part after "Anmälan till X - "), so a
 *  free-text member column that merely mentions "födelseår" is still mappable;
 *  the years themselves are stripped by parseMembers. */
export function isSensitiveHeader(h: string): boolean {
	return DENY.test(h.replace(/^.* [-–] /, '').trim());
}

// ---------- tabular parsing (no DOM needed, works in Node tests and workers) ----------

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(s: string): string {
	return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
		if (e[0] === '#') {
			const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
			return Number.isFinite(code) ? String.fromCodePoint(code) : m;
		}
		return ENTITIES[e.toLowerCase()] ?? m;
	});
}

/** Parses the first <table> of an HTML document (Scoutnet "xls" export). */
export function parseHtmlTable(html: string): Table {
	const rows: Table = [];
	const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
	let tr: RegExpExecArray | null;
	while ((tr = trRe.exec(html))) {
		const cells: string[] = [];
		const tdRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
		let td: RegExpExecArray | null;
		while ((td = tdRe.exec(tr[1]))) {
			const text = td[1].replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '');
			cells.push(decodeEntities(text).replace(/\r/g, '').trim());
		}
		if (cells.length) rows.push(cells);
	}
	return rows;
}

/** RFC 4180-ish CSV with auto-detected separator (`;` common in Swedish Excel). */
export function parseCsv(text: string): Table {
	const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
	const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : firstLine.includes('\t') ? '\t' : ',';
	const rows: Table = [];
	let row: string[] = [];
	let cell = '';
	let q = false;
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (q) {
			if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
			else if (c === '"') q = false;
			else cell += c;
		} else if (c === '"') q = true;
		else if (c === sep) { row.push(cell.trim()); cell = ''; }
		else if (c === '\n' || c === '\r') {
			if (c === '\r' && text[i + 1] === '\n') i++;
			row.push(cell.trim()); cell = '';
			if (row.some((x) => x !== '')) rows.push(row);
			row = [];
		} else cell += c;
	}
	row.push(cell.trim());
	if (row.some((x) => x !== '')) rows.push(row);
	return rows;
}

export function parseFileText(name: string, text: string): Table {
	return /<table/i.test(text.slice(0, 5000)) || /\.html?$|\.xls$/i.test(name) ? parseHtmlTable(text) : parseCsv(text);
}

// ---------- column mapping ----------

export interface ColumnGuess {
	index: number;
	header: string;
	field: TargetField;
	sensitive: boolean;
	example: string;
}

const RULES: [RegExp, TargetField][] = [
	[/patrullnamn/i, 'patrolName'],
	[/vilken klass|^klass$/i, 'trackText'],
	[/alla i patrullen|medlemmar|deltagare i patrullen/i, 'members'],
	[/– ?scoutkår$|- ?scoutkår$|^kår$|^scoutkår$/i, 'troop'],
	[/mobilnummer|^mobil|^telefon/i, 'contactPhone'],
	[/epostadress|^e-?post$/i, 'contactEmail'],
	[/^namn$|kontaktperson/i, 'contactName'],
	[/^medlemsnummer$/i, 'contactMemberNo'],
	[/^anmäld$/i, 'registered'],
	[/betalda skulder|^betald$/i, 'paid']
];

/** True when the headers look like a Scoutnet event export. */
export function isScoutnetExport(headers: string[]): boolean {
	return headers.includes('Medlemsnummer') && headers.includes('Anmäld') && headers.some((h) => / - | – /.test(h));
}

export function guessColumns(table: Table): ColumnGuess[] {
	const headers = table[0] ?? [];
	const taken = new Set<TargetField>();
	return headers.map((header, index) => {
		const sensitive = isSensitiveHeader(header);
		let field: TargetField = 'ignore';
		if (!sensitive) {
			// Prefer the event-form answers ("Anmälan till X - Scoutkår") over profile columns ("Kår").
			const short = header.replace(/^.* [-–] /, '');
			for (const [re, f] of RULES) {
				if ((re.test(short) || re.test(header)) && !taken.has(f)) { field = f; break; }
			}
			if (field === 'troop' && header === 'Kår' && headers.some((h) => / [-–] scoutkår$/i.test(h))) field = 'ignore';
			if (field === 'contactPhone' && header === 'Telefonnummer' && headers.some((h) => /mobilnummer/i.test(h))) field = 'ignore';
			if (field === 'contactEmail' && header === 'E-post' && headers.some((h) => /epostadress/i.test(h))) field = 'ignore';
			if (field !== 'ignore') taken.add(field);
		}
		const example = table.slice(1).map((r) => r[index]).find((v) => v && v !== '-') ?? '';
		return { index, header, field, sensitive, example: sensitive ? '' : example };
	});
}

// ---------- normalisation ----------

/** "0703- 364731" → "070-336 47 31"; +46 numbers kept as national format. */
export function normalizePhone(raw: string): string {
	let d = raw.replace(/[^\d+]/g, '');
	if (d.startsWith('+46')) d = '0' + d.slice(3);
	if (d.startsWith('0046')) d = '0' + d.slice(4);
	d = d.replace(/\+/g, '');
	if (/^07\d{8}$/.test(d)) return `${d.slice(0, 3)}-${d.slice(3, 6)} ${d.slice(6, 8)} ${d.slice(8)}`;
	return d || raw.trim();
}

/** Key used to detect the same kår spelled differently ("Porthälla Scoutkår" / "porthälla scoutkår"). */
export function troopKey(name: string): string {
	return name.toLowerCase().replace(/scoutkår|scoutkåren|kår/g, '').replace(/[^a-zåäö0-9]/g, '');
}

export interface ParsedMember {
	firstName: string;
	lastName: string;
	troopText: string;
	uncertain: boolean;
}

/**
 * Parses free-text member lists like "Elsa Ek, 2008, Granliden" one per line, keeping only the name
 * and a kår. No birth data may be stored (decision 2026-10-15), and people answer "födelseår" with
 * full dates, ages or personnummer, so every date/age shape is removed first. Anything after the name
 * that is not a plain kår name (digits, health or diet notes, addresses) is dropped and the row is
 * marked uncertain so the organiser looks at it.
 */
const DATE_LIKE = [
	/\b(?:19|20)?\d{2}[-./]?\d{2}[-./]?\d{2}(?:[-+]?\d{4})?\b/g, // 2012-05-03, 20120503, 120503, 03.05.12, personnummer
	/\b\d{1,2}[./]\d{1,2}(?:[./ ]+(?:19|20)?\d{2})?\b/g, // 3/5, 3/5 2012, 03.05
	/\b(?:19|20)\d{2}\b/g, // 2012
	/(?:^|\s)[-'’]\d{2}\b/g, // -12, '12
	/\(?\b\d{1,2}\s*(?:år|åå|years?)\b\)?/gi, // 12 år, (12 år)
	/\bf(?:ödd|\.)\s*/gi // "f." / "född" left over
];
const NOT_A_TROOP = /\d|allergi|kost|laktos|gluten|vegan|vegetar|nöt|jordnöt|diabet|astma|epileps|medicin|sjuk|adhd|autism|diagnos|behov|gata|gatan|vägen|väg\b|box\b/i;

export function parseMembers(text: string): ParsedMember[] {
	return text
		.split(/\n+/)
		.map((l) => l.replace(/\t/g, ' ').trim())
		.filter((l) => l.length > 1)
		.map((line) => {
			let clean = line;
			for (const re of DATE_LIKE) clean = clean.replace(re, ' ');
			clean = clean.replace(/[()]/g, ' ').replace(/\s{2,}/g, ' ');
			const parts = clean.split(/[,;]/).map((p) => p.trim()).filter(Boolean);
			const nameParts = (parts[0] ?? '').split(/\s+/).filter((w) => w && !/\d/.test(w));
			const rest = parts.slice(1);
			const troopParts = rest.filter((p) => !NOT_A_TROOP.test(p));
			const looksLikeNote = /^[+(]|ev\.|kanske|\?/i.test(line);
			return {
				firstName: nameParts[0] ?? '',
				lastName: nameParts.slice(1).join(' '),
				troopText: troopParts.join(', '),
				uncertain: looksLikeNote || nameParts.length < 2 || troopParts.length !== rest.length || clean.trim() !== line.trim().replace(/\s{2,}/g, ' ')
			};
		});
}

// ---------- build import rows ----------

export interface ImportRow {
	patrolName: string;
	trackText: string;
	troop: string;
	contactName: string;
	contactPhone: string;
	contactEmail: string;
	contactMemberNo: string;
	members: ParsedMember[];
	/** null = the file has no payment column (an update then leaves "Betald" as it is). */
	paid: boolean | null;
}

export interface ImportIssue {
	kind: 'unknownTrack' | 'troopSpelling' | 'members' | 'skipped' | 'phones' | 'missingName';
	message: string;
	values: string[];
}

export interface ImportResult {
	rows: ImportRow[];
	skipped: number;
	issues: ImportIssue[];
}

export function buildImport(table: Table, columns: ColumnGuess[], knownTracks: string[]): ImportResult {
	const col = (f: TargetField) => columns.find((c) => c.field === f && !c.sensitive)?.index;
	const get = (r: string[], f: TargetField) => {
		const i = col(f);
		const v = i === undefined ? '' : (r[i] ?? '');
		return v === '-' ? '' : v;
	};
	const rows: ImportRow[] = [];
	let skipped = 0;
	let phones = 0;
	for (const r of table.slice(1)) {
		if (get(r, 'registered').toLowerCase() === 'nej') { skipped++; continue; }
		const rawPhone = get(r, 'contactPhone');
		const phone = normalizePhone(rawPhone);
		if (rawPhone && phone !== rawPhone) phones++;
		rows.push({
			patrolName: get(r, 'patrolName'),
			trackText: get(r, 'trackText'),
			troop: get(r, 'troop'),
			contactName: get(r, 'contactName'),
			contactPhone: phone,
			contactEmail: get(r, 'contactEmail').toLowerCase(),
			contactMemberNo: get(r, 'contactMemberNo').replace(/\D/g, ''),
			members: parseMembers(get(r, 'members')),
			paid: col('paid') === undefined ? null : /^betald|^ja/i.test(get(r, 'paid'))
		});
	}
	const issues: ImportIssue[] = [];
	const known = new Set(knownTracks.map((t) => t.toLowerCase()));
	const unknown = [...new Set(rows.map((r) => r.trackText).filter((t) => t && !known.has(t.toLowerCase())))];
	for (const t of unknown) {
		const n = rows.filter((r) => r.trackText === t).length;
		issues.push({ kind: 'unknownTrack', message: `Klassen ”${t}” finns inte (${n} ${n === 1 ? 'patrull' : 'patruller'})`, values: [t] });
	}
	const byKey = new Map<string, Set<string>>();
	rows.forEach((r) => r.troop && (byKey.get(troopKey(r.troop)) ?? byKey.set(troopKey(r.troop), new Set()).get(troopKey(r.troop))!).add(r.troop));
	for (const variants of byKey.values()) {
		if (variants.size > 1) issues.push({ kind: 'troopSpelling', message: `Samma kår, olika stavning: ${[...variants].map((v) => `”${v}”`).join(' och ')}`, values: [...variants] });
	}
	const unclear = rows.filter((r) => r.members.some((m) => m.uncertain)).map((r) => r.patrolName);
	if (unclear.length) issues.push({ kind: 'members', message: `${unclear.length} ${unclear.length === 1 ? 'patrull' : 'patruller'} har oklar medlemslista`, values: unclear });
	const noName = rows.filter((r) => !r.patrolName).length;
	if (noName) issues.push({ kind: 'missingName', message: `${noName} rader saknar patrullnamn`, values: [] });
	if (skipped) issues.push({ kind: 'skipped', message: `${skipped} rad${skipped === 1 ? '' : 'er'} hoppas över (Anmäld = Nej)`, values: [] });
	if (phones) issues.push({ kind: 'phones', message: `${phones} telefonnummer snyggades till`, values: [] });
	return { rows, skipped, issues };
}

/** Merge troop spelling variants into the first one. */
export function mergeTroops(rows: ImportRow[], variants: string[]): ImportRow[] {
	const target = variants[0];
	return rows.map((r) => (variants.includes(r.troop) ? { ...r, troop: target } : r));
}

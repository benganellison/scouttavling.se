import { requireCompetition } from '#lib/server/auth.ts';
import { getResults } from '#lib/server/live.ts';

const cell = (v: string | number) => {
	const s = String(v);
	// Quote and neutralise spreadsheet formulas.
	const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
	return /[";\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
};

/**
 * Results for all classes as CSV (semicolon-separated, UTF-8 with BOM for Excel), then one column
 * per points station (points incl. style; plus a style column when style is used there). A station
 * outside a patrol's class is empty, one the patrol has not reported yet is "–".
 */
export async function GET(event) {
	const { comp } = await requireCompetition(event, event.params.slug);
	const res = await getResults(comp);
	const stations = [...new Map(res.tracks.flatMap((t) => t.stations).map((s) => [s.id, s])).values()].sort((a, b) => a.sort - b.sort);
	const head = ['Klass', 'Placering', 'Nummer', 'Patrull', 'Kår', 'Totalt', 'Poäng', 'Stil', 'Kontroller klara', 'Kontroller totalt', 'Kommentar'];
	for (const s of stations) head.push(s.name, ...(s.styleMax ? [`${s.name} stil`] : []));
	const lines = [head];
	for (const t of res.tracks)
		for (const r of t.rows) {
			const line = [t.name, String(r.place), String(r.number), r.name, r.troop, String(r.total), String(r.scorePoints), String(r.stylePoints), String(r.stationsDone), String(r.stationsTotal), r.tieNote ?? ''];
			for (const s of stations) {
				const i = t.stations.findIndex((x) => x.id === s.id);
				const v = i < 0 ? undefined : r.perStation[i];
				const cellText = (n: (c: { points: number; stylePoints: number }) => number) => (i < 0 ? '' : v ? String(n(v)) : '–');
				line.push(cellText((c) => c.points + c.stylePoints), ...(s.styleMax ? [cellText((c) => c.stylePoints)] : []));
			}
			lines.push(line);
		}
	const body = '﻿' + lines.map((l) => l.map(cell).join(';')).join('\r\n') + '\r\n';
	return new Response(body, {
		headers: {
			'content-type': 'text/csv; charset=utf-8',
			'content-disposition': `attachment; filename="resultat-${comp.slug}.csv"`
		}
	});
}

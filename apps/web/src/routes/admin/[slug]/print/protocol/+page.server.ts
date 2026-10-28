import { loadBranding } from '#lib/server/assets.ts';
import { selectableValues, styleValues } from '@scouttavling/domain';
import { requireCompetition } from '#lib/server/auth.ts';
import { itemDef } from '#lib/server/scores.ts';
import { arrivalOrder, loadPatrols, loadStations, loadTracks, scoredItems, stationDoesTrack } from '../prep.server.ts';

const ROWS_PER_PAGE = 16;

export async function load(event) {
	const { comp } = await requireCompetition(event, event.params.slug);
	const [{ stations }, tracks, all] = await Promise.all([loadStations(comp.id), loadTracks(comp.id), loadPatrols(comp.id)]);
	const patrols = all.filter((p) => p.status !== 'resigned');
	const trackName = new Map(tracks.map((t) => [t.id, t.name]));
	const distributed = patrols.some((p) => p.startStationId);

	const pages: {
		key: string;
		code: string;
		station: string;
		item: string | null;
		rule: string;
		values: number[] | null;
		style: number[];
		rows: { nr: number; name: string; track: string }[];
		page: number;
		pages: number;
	}[] = [];

	for (const s of stations) {
		const expected = arrivalOrder(
			patrols.filter((p) => stationDoesTrack(s, p.trackId)),
			stations,
			s.id
		).map((p) => ({ nr: p.number, name: p.name, track: p.trackId ? (trackName.get(p.trackId) ?? '') : '' }));
		const items = scoredItems(s);
		const sections = items.length
			? items.map((it) => {
					const def = itemDef(it, comp);
					const values = selectableValues(def);
					const style = styleValues(def);
					const rule = [
						values.length ? `Poäng ${def.mode === 'DISTINCT' ? values.join(' / ') : `${values[0]}–${values[values.length - 1]}`}` : '',
						style.length ? `Stilpoäng ${style[0]}–${style[style.length - 1]}` : ''
					]
						.filter(Boolean)
						.join(' · ');
					return {
						item: items.length > 1 ? it.name : null,
						values: values.length <= 22 ? values : null,
						style,
						rule: rule + (def.mode === 'COUNT' ? ` · ringa in antal (×${def.countMultiplier ?? 1})` : '')
					};
				})
			: [{ item: null, values: null as number[] | null, style: [] as number[], rule: 'Bara signatur — skriv tid och signera' }];
		for (const sec of sections) {
			const chunks = Math.max(1, Math.ceil(expected.length / ROWS_PER_PAGE));
			for (let c = 0; c < chunks; c++) {
				pages.push({
					key: `${s.id}-${sec.item ?? ''}-${c}`,
					code: s.code,
					station: s.name,
					...sec,
					rows: expected.slice(c * ROWS_PER_PAGE, (c + 1) * ROWS_PER_PAGE),
					page: c + 1,
					pages: chunks
				});
			}
		}
	}
	return {
		competition: { slug: comp.slug, name: comp.name, hqPhone: comp.hqPhone ?? '' },
		branding: await loadBranding(comp),
		distributed,
		printedAt: new Date().toLocaleString('sv-SE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Stockholm' }),
		pages
	};
}

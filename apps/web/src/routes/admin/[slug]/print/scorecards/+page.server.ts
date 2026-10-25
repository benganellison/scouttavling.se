import { loadBranding } from '#lib/server/assets.ts';
import { trackColors } from '#lib/brand/colors.ts';
import { maxPoints, patrolCodeUrl } from '@scouttavling/domain';
import { requireCompetition } from '#lib/server/auth.ts';
import { itemDef } from '#lib/server/scores.ts';
import { loadPatrols, loadStations, loadTracks, scoredItems, stationDoesTrack } from '../prep.server.ts';
import { publicOrigin, qrSvg } from '../../invites/inviteCrypto.server.ts';

export async function load(event) {
	const { comp } = await requireCompetition(event, event.params.slug);
	const showNames = event.url.searchParams.get('names') === '1';
	const [{ days, stations }, tracks, all] = await Promise.all([loadStations(comp.id), loadTracks(comp.id), loadPatrols(comp.id)]);
	const patrols = all.filter((p) => p.status !== 'resigned');
	const trackName = new Map(tracks.map((t) => [t.id, t.name]));
	const colors = trackColors(tracks);
	const origin = publicOrigin(event.url);
	const byId = new Map(stations.map((s) => [s.id, s]));

	const info = stations.map((s) => {
		const items = scoredItems(s).map((i) => itemDef(i, comp));
		return {
			s,
			checkpoint: items.length === 0,
			max: items.reduce((a, i) => a + maxPoints(i), 0),
			style: items.some((i) => i.styleEnabled)
		};
	});
	const multi = comp.multiDay && days.length > 1;
	const groups = multi
		? [...days.map((d) => ({ label: d.name, ids: stations.filter((s) => s.dayId === d.id).map((s) => s.id) })), { label: 'Övrigt', ids: stations.filter((s) => !s.dayId || !days.some((d) => d.id === s.dayId)).map((s) => s.id) }].filter((g) => g.ids.length)
		: [{ label: '', ids: stations.map((s) => s.id) }];

	const cards = await Promise.all(
		patrols.map(async (p) => {
			const start = p.startStationId ? byId.get(p.startStationId) : null;
			return {
				id: p.id,
				nr: p.number,
				name: p.name,
				color: p.trackId ? (colors[p.trackId] ?? null) : null,
				sub: [p.trackId ? trackName.get(p.trackId) : '', p.troop].filter(Boolean).join(' · '),
				start: start ? `${start.code} ${start.name}` : '',
				qr: await qrSvg(await patrolCodeUrl(origin, comp.patrolCodeKey, comp.slug, p.number), { margin: 0 }),
				days: groups.map((g) => ({
					label: g.label,
					cells: g.ids.map((id) => {
						const x = info.find((i) => i.s.id === id)!;
						const na = !stationDoesTrack(x.s, p.trackId);
						return { id, code: x.s.code, name: x.s.name, na, checkpoint: !na && x.checkpoint, max: x.max, style: x.style && comp.styleEnabled };
					})
				}))
			};
		})
	);
	const sheets: (typeof cards)[] = [];
	for (let i = 0; i < cards.length; i += 2) sheets.push(cards.slice(i, i + 2));
	const cols = Math.min(8, Math.max(4, ...groups.map((g) => g.ids.length > 8 ? Math.ceil(g.ids.length / 2) : g.ids.length)));
	return {
		competition: { slug: comp.slug, name: comp.name, hqPhone: comp.hqPhone ?? '', styleEnabled: comp.styleEnabled },
		branding: await loadBranding(comp),
		showNames,
		multi,
		cols,
		sheets
	};
}

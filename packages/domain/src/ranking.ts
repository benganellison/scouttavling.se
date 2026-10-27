import { rankOfValue, type ScoreItemDef } from './scoring.ts';

export interface RankScore {
	itemId: string;
	points: number;
	stylePoints: number;
}

export interface RankPatrol {
	id: string;
	number: number;
	scores: RankScore[];
}

export interface RankedPatrol {
	id: string;
	number: number;
	place: number;
	total: number;
	scorePoints: number;
	stylePoints: number;
	/** rankVector[r] = items where the patrol got the r-th best achievable value. */
	rankVector: number[];
	/** True when another patrol shares exactly the same place. */
	tied: boolean;
	/** Why this patrol is ahead of the next one (for ceremony / result pages). */
	decidedBy: 'total' | 'scorePoints' | 'tiebreak' | 'tie' | null;
}

const TIEBREAK_DEPTH = 50;

/**
 * Ranks patrols exactly like gokapp's Patrol.compareTo:
 *   1. highest total (points + style points)
 *   2. highest points without style
 *   3. most best-possible values, then most next-best, … (checkpoints and
 *      zero scores excluded)
 * Patrols that are still equal share the place (1, 2, 2, 4) — organiser
 * decision 2026-10-15. Display order inside a tie is by patrol number.
 */
export function rank(patrols: RankPatrol[], items: ScoreItemDef[]): RankedPatrol[] {
	const byId = new Map(items.map((i) => [i.id, i]));
	const rows = patrols.map((p) => {
		let scorePoints = 0;
		let stylePoints = 0;
		const rankVector = new Array<number>(TIEBREAK_DEPTH + 1).fill(0);
		for (const s of p.scores) {
			const item = byId.get(s.itemId);
			scorePoints += s.points;
			// Style switched off (for the competition or the item) after scores were saved: stored style
			// points no longer count, so early and late patrols are ranked alike.
			if (item?.styleEnabled !== false) stylePoints += s.stylePoints;
			if (!item || s.points <= 0) continue;
			const r = rankOfValue(item, s.points);
			if (r >= 0 && r <= TIEBREAK_DEPTH) rankVector[r]++;
		}
		return { id: p.id, number: p.number, scorePoints, stylePoints, total: scorePoints + stylePoints, rankVector };
	});

	const cmp = (a: (typeof rows)[number], b: (typeof rows)[number]): number => {
		if (b.total !== a.total) return b.total - a.total;
		if (b.scorePoints !== a.scorePoints) return b.scorePoints - a.scorePoints;
		for (let r = 0; r <= TIEBREAK_DEPTH; r++) {
			if (b.rankVector[r] !== a.rankVector[r]) return b.rankVector[r] - a.rankVector[r];
		}
		return 0;
	};

	const sorted = [...rows].sort((a, b) => cmp(a, b) || a.number - b.number);
	const out: RankedPatrol[] = [];
	sorted.forEach((row, i) => {
		const prev = sorted[i - 1];
		const place = prev && cmp(prev, row) === 0 ? out[i - 1].place : i + 1;
		out.push({ ...row, place, tied: false, decidedBy: null });
	});
	out.forEach((row, i) => {
		const next = out[i + 1];
		const prev = out[i - 1];
		row.tied = (!!next && next.place === row.place) || (!!prev && prev.place === row.place);
		if (!next) return;
		row.decidedBy =
			next.place === row.place ? 'tie'
			: row.total !== next.total ? 'total'
			: row.scorePoints !== next.scorePoints ? 'scorePoints'
			: 'tiebreak';
	});
	return out;
}

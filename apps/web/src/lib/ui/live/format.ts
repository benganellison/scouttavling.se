/** Swedish place words for the ceremony and results pages. */
const ORD = ['', 'Första', 'Andra', 'Tredje', 'Fjärde', 'Femte', 'Sjätte', 'Sjunde', 'Åttonde', 'Nionde', 'Tionde', 'Elfte', 'Tolfte'];

export function placeWord(place: number, shared = false): string {
	const w = ORD[place] ? `${ORD[place]} plats` : `Plats ${place}`;
	return shared ? `Delad ${w.toLowerCase()}` : w;
}

export const RULE_TEXT =
	'Vid lika totalpoäng vinner flest poäng utan stil, sedan flest maxpoäng, därefter flest näst högsta poäng och så vidare. Är patrullerna fortfarande helt lika delar de placeringen.';

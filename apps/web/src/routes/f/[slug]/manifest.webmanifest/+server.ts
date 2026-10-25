import type { RequestHandler } from './$types';

/** Per-competition Web App Manifest so "Lägg till på hemskärmen" opens this station. */
export const GET: RequestHandler = ({ params }) => {
	return new Response(
		JSON.stringify({
			name: 'Scouttävling – kontroll',
			short_name: 'Kontroll',
			start_url: `/f/${params.slug}`,
			scope: '/',
			display: 'standalone',
			background_color: '#F4F6F8',
			theme_color: '#003660',
			// Scouterna's scout symbol, scaled only (static/icons/, from static/brand/scouterna/Scoutsymbolen_rgb.png).
			icons: [192, 512].map((n) => ({ src: `/icons/scouterna-${n}.png`, sizes: `${n}x${n}`, type: 'image/png', purpose: 'any' }))
		}),
		{ headers: { 'content-type': 'application/manifest+json', 'cache-control': 'public, max-age=3600' } }
	);
};

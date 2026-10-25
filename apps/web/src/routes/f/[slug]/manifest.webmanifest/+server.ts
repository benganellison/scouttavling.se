import type { RequestHandler } from './$types';

/** Per-competition Web App Manifest so "Lägg till på hemskärmen" opens this station. */
export const GET: RequestHandler = ({ params }) => {
	const icon =
		"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' fill='%23003660'/%3E%3Crect x='5' y='5' width='22' height='22' rx='4' fill='%23fff'/%3E%3Cpolygon points='7,25 25,7 25,25' fill='%23e95f13'/%3E%3C/svg%3E";
	return new Response(
		JSON.stringify({
			name: 'Scouttävling – kontroll',
			short_name: 'Kontroll',
			start_url: `/f/${params.slug}`,
			scope: '/',
			display: 'standalone',
			background_color: '#F4F6F8',
			theme_color: '#003660',
			icons: [{ src: icon, sizes: 'any', type: 'image/svg+xml', purpose: 'any' }]
		}),
		{ headers: { 'content-type': 'application/manifest+json', 'cache-control': 'public, max-age=3600' } }
	);
};

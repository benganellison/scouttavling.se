/**
 * "Sol": high-contrast mode for bright sunlight (`:root[data-contrast='high']` in global.css). A per-phone
 * choice, kept in localStorage (a convenience only: without storage the default look is used).
 */
const KEY = 'st-contrast';

export function readContrast(): boolean {
	try {
		return localStorage.getItem(KEY) === 'high';
	} catch {
		return false;
	}
}

export function applyContrast(high: boolean) {
	if (typeof document === 'undefined') return;
	if (high) document.documentElement.dataset.contrast = 'high';
	else delete document.documentElement.dataset.contrast;
	try {
		if (high) localStorage.setItem(KEY, 'high');
		else localStorage.removeItem(KEY);
	} catch {
		/* storage unavailable: applies for this visit only */
	}
}

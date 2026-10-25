/**
 * Upload validation for event images (logos, cover). Pure functions, no DB.
 *
 * - Only PNG, JPEG and WebP, decided by magic bytes and a structural walk, never by name or
 *   declared type. SVG is refused (it can carry script), as is anything that merely starts
 *   like an image but does not parse.
 * - Metadata is stripped: PNG text/time/EXIF chunks, JPEG APPn (except JFIF/ICC/Adobe) and
 *   comments, WebP EXIF/XMP chunks. A JPEG's EXIF orientation is kept as a minimal APP1 with
 *   only that tag, so phone photos don't turn sideways (GPS, camera, dates are dropped).
 */

export const MAX_BYTES = 2 * 1024 * 1024;
export type ImageMime = 'image/png' | 'image/jpeg' | 'image/webp';

export type ValidateResult =
	| { ok: true; mime: ImageMime; bytes: Uint8Array; width: number; height: number }
	| { ok: false; reason: string };

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const starts = (b: Uint8Array, sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v);
const ascii = (b: Uint8Array, at: number, len: number) => String.fromCharCode(...b.subarray(at, at + len));
const u32be = (b: Uint8Array, at: number) => ((b[at] << 24) >>> 0) + (b[at + 1] << 16) + (b[at + 2] << 8) + b[at + 3];
const u16be = (b: Uint8Array, at: number) => (b[at] << 8) + b[at + 1];
const u32le = (b: Uint8Array, at: number) => b[at] + (b[at + 1] << 8) + (b[at + 2] << 16) + ((b[at + 3] << 24) >>> 0);
const u24le = (b: Uint8Array, at: number) => b[at] + (b[at + 1] << 8) + (b[at + 2] << 16);

function concat(parts: Uint8Array[]): Uint8Array {
	const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
	let o = 0;
	for (const p of parts) {
		out.set(p, o);
		o += p.length;
	}
	return out;
}

/** Sniffs the container from magic bytes only. */
export function sniff(b: Uint8Array): ImageMime | null {
	if (b.length >= 8 && starts(b, PNG_SIG)) return 'image/png';
	if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
	if (b.length >= 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return 'image/webp';
	return null;
}

// ------------------------------------------------------------------ PNG

/** Chunks we keep: critical ones plus colour/transparency info. Everything else (tEXt, iTXt, zTXt, eXIf, tIME…) goes. */
const PNG_KEEP = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'gAMA', 'cHRM', 'sRGB', 'iCCP', 'sBIT', 'pHYs', 'acTL', 'fcTL', 'fdAT']);

function png(b: Uint8Array): ValidateResult {
	const parts: Uint8Array[] = [b.subarray(0, 8)];
	let at = 8;
	let width = 0;
	let height = 0;
	let sawEnd = false;
	let first = true;
	while (at + 12 <= b.length) {
		const len = u32be(b, at);
		const type = ascii(b, at + 4, 4);
		const end = at + 12 + len;
		if (!/^[A-Za-z]{4}$/.test(type) || end > b.length) return { ok: false, reason: 'Bilden är skadad (PNG).' };
		if (first) {
			if (type !== 'IHDR' || len !== 13) return { ok: false, reason: 'Bilden är skadad (PNG).' };
			width = u32be(b, at + 8);
			height = u32be(b, at + 12);
			first = false;
		}
		if (PNG_KEEP.has(type)) parts.push(b.subarray(at, end));
		at = end;
		if (type === 'IEND') {
			sawEnd = true;
			break;
		}
	}
	if (!sawEnd || !width || !height) return { ok: false, reason: 'Bilden är skadad (PNG).' };
	return { ok: true, mime: 'image/png', bytes: concat(parts), width, height };
}

// ------------------------------------------------------------------ JPEG

/** EXIF orientation (1–8) from an APP1 "Exif" segment body, or null. */
function exifOrientation(seg: Uint8Array): number | null {
	if (ascii(seg, 0, 6) !== 'Exif\0\0') return null;
	const t = seg.subarray(6);
	if (t.length < 8) return null;
	const le = ascii(t, 0, 2) === 'II';
	const r16 = (o: number) => (le ? t[o] + (t[o + 1] << 8) : (t[o] << 8) + t[o + 1]);
	const r32 = (o: number) => (le ? u32le(t, o) : u32be(t, o));
	const ifd = r32(4);
	if (ifd + 2 > t.length) return null;
	const n = r16(ifd);
	for (let i = 0; i < n; i++) {
		const e = ifd + 2 + i * 12;
		if (e + 12 > t.length) return null;
		if (r16(e) === 0x0112) {
			const v = r16(e + 8);
			return v >= 1 && v <= 8 ? v : null;
		}
	}
	return null;
}

/** A minimal big-endian APP1 Exif segment holding only the orientation tag. */
function orientationSegment(o: number): Uint8Array {
	// 'Exif\0\0' + TIFF header (MM, 42, IFD at 8) + IFD: 1 entry + next-IFD 0
	const body = [0x45, 0x78, 0x69, 0x66, 0, 0, 0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, o, 0, 0, 0, 0, 0, 0];
	const len = body.length + 2;
	return new Uint8Array([0xff, 0xe1, len >> 8, len & 0xff, ...body]);
}

function jpeg(b: Uint8Array): ValidateResult {
	const parts: Uint8Array[] = [b.subarray(0, 2)];
	let at = 2;
	let width = 0;
	let height = 0;
	let orientation: number | null = null;
	let insertedAt = -1;
	while (at + 4 <= b.length) {
		if (b[at] !== 0xff) return { ok: false, reason: 'Bilden är skadad (JPEG).' };
		const marker = b[at + 1];
		if (marker === 0xff) {
			at++;
			continue;
		}
		if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
			at += 2;
			continue;
		}
		const len = u16be(b, at + 2);
		const end = at + 2 + len;
		if (len < 2 || end > b.length) return { ok: false, reason: 'Bilden är skadad (JPEG).' };
		const seg = b.subarray(at, end);
		const body = b.subarray(at + 4, end);
		if (marker === 0xda) {
			// Start of scan: the rest is entropy-coded data up to EOI; keep it as is.
			if (insertedAt < 0) insertedAt = parts.length;
			parts.push(b.subarray(at));
			if (!width || !height) return { ok: false, reason: 'Bilden är skadad (JPEG).' };
			if (orientation && orientation !== 1) parts.splice(insertedAt, 0, orientationSegment(orientation));
			return { ok: true, mime: 'image/jpeg', bytes: concat(parts), width, height };
		}
		const isApp = marker >= 0xe0 && marker <= 0xef;
		if (marker === 0xe1) orientation ??= exifOrientation(body);
		// SOFn (not DHT/JPG/DAC): frame header with the size.
		if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
			height = u16be(b, at + 5);
			width = u16be(b, at + 7);
		}
		const keepApp = (marker === 0xe0 && ascii(body, 0, 4) === 'JFIF') || (marker === 0xe2 && ascii(body, 0, 11) === 'ICC_PROFILE') || (marker === 0xee && ascii(body, 0, 5) === 'Adobe');
		if (isApp && !keepApp) {
			/* metadata: dropped */
		} else if (marker === 0xfe) {
			/* comment: dropped */
		} else {
			if (insertedAt < 0 && !isApp) insertedAt = parts.length;
			parts.push(seg);
		}
		at = end;
	}
	return { ok: false, reason: 'Bilden är skadad (JPEG).' };
}

// ------------------------------------------------------------------ WebP

function webp(b: Uint8Array): ValidateResult {
	const riffLen = u32le(b, 4);
	if (riffLen + 8 > b.length || riffLen < 12) return { ok: false, reason: 'Bilden är skadad (WebP).' };
	const chunks: Uint8Array[] = [];
	let at = 12;
	let width = 0;
	let height = 0;
	let vp8x: Uint8Array | null = null;
	while (at + 8 <= riffLen + 8) {
		const type = ascii(b, at, 4);
		const len = u32le(b, at + 4);
		const end = at + 8 + len + (len & 1);
		if (!/^[A-Z0-9 ]{4}$/i.test(type) || at + 8 + len > b.length) return { ok: false, reason: 'Bilden är skadad (WebP).' };
		const data = b.subarray(at + 8, at + 8 + len);
		if (type === 'VP8X' && len >= 10) {
			width = u24le(data, 4) + 1;
			height = u24le(data, 7) + 1;
		} else if (type === 'VP8 ' && len >= 10 && !width) {
			width = (data[6] | (data[7] << 8)) & 0x3fff;
			height = (data[8] | (data[9] << 8)) & 0x3fff;
		} else if (type === 'VP8L' && len >= 5 && !width) {
			if (data[0] !== 0x2f) return { ok: false, reason: 'Bilden är skadad (WebP).' };
			const bits = u32le(data, 1);
			width = (bits & 0x3fff) + 1;
			height = ((bits >> 14) & 0x3fff) + 1;
		}
		if (type !== 'EXIF' && type !== 'XMP ') {
			const chunk = b.slice(at, Math.min(end, b.length));
			if (type === 'VP8X') vp8x = chunk;
			chunks.push(chunk);
		}
		at = end;
	}
	if (!width || !height || !chunks.some((c) => ['VP8 ', 'VP8L', 'ANIM'].includes(ascii(c, 0, 4)))) return { ok: false, reason: 'Bilden är skadad (WebP).' };
	// Clear the EXIF (0x08) and XMP (0x04) flags now that those chunks are gone.
	if (vp8x) vp8x[8] &= ~0x0c;
	const body = concat(chunks);
	const head = new Uint8Array(12);
	head.set([0x52, 0x49, 0x46, 0x46]);
	const size = body.length + 4;
	head.set([size & 0xff, (size >> 8) & 0xff, (size >> 16) & 0xff, (size >>> 24) & 0xff], 4);
	head.set([0x57, 0x45, 0x42, 0x50], 8);
	return { ok: true, mime: 'image/webp', bytes: concat([head, body]), width, height };
}

/** Validates an upload and returns the cleaned bytes, or a Swedish reason for the organiser. */
export function validateImage(input: Uint8Array): ValidateResult {
	if (input.length === 0) return { ok: false, reason: 'Filen är tom.' };
	if (input.length > MAX_BYTES) return { ok: false, reason: 'Bilden är större än 2 MB. Förminska den och försök igen.' };
	const mime = sniff(input);
	if (!mime) return { ok: false, reason: 'Bara PNG, JPEG och WebP går att ladda upp (inte SVG).' };
	const r = mime === 'image/png' ? png(input) : mime === 'image/jpeg' ? jpeg(input) : webp(input);
	if (r.ok && (r.width > 10000 || r.height > 10000)) return { ok: false, reason: 'Bilden är för stor (högst 10 000 px).' };
	return r;
}

import { describe, expect, it } from 'vitest';
import { MAX_BYTES, sniff, validateImage } from './imageValidate.ts';
import { encodePng } from './pngEncode.ts';

const enc = (s: string) => new TextEncoder().encode(s);
const has = (b: Uint8Array, s: string) => Buffer.from(b).includes(Buffer.from(s, 'latin1'));

/** A tiny baseline JPEG (1×1) with an EXIF APP1 (orientation 6 + a fake GPS-ish string) and a comment. */
function jpegWithExif(): Uint8Array {
	const exifBody = [
		...enc('Exif\0\0'), 0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0, 0, 0, 0, 0, ...enc('GPS 59.33N 18.06E')
	];
	const seg = (m: number, body: number[]) => [0xff, m, (body.length + 2) >> 8, (body.length + 2) & 0xff, ...body];
	const jfif = seg(0xe0, [...enc('JFIF\0'), 1, 1, 0, 0, 1, 0, 1, 0, 0]);
	const sof = seg(0xc0, [8, 0, 1, 0, 1, 1, 1, 0x11, 0]);
	const com = seg(0xfe, [...enc('secret comment')]);
	const sos = [0xff, 0xda, 0, 8, 1, 1, 0, 0, 0x3f, 0, 0x12, 0x34, 0xff, 0xd9];
	return new Uint8Array([0xff, 0xd8, ...jfif, ...seg(0xe1, exifBody), ...com, ...sof, ...sos]);
}

function webpLossless(withExif: boolean): Uint8Array {
	const chunk = (type: string, data: number[]) => {
		const pad = data.length & 1 ? [0] : [];
		return [...enc(type), data.length & 0xff, (data.length >> 8) & 0xff, 0, 0, ...data, ...pad];
	};
	// VP8X: flags (EXIF 0x08), canvas 2×3 (minus one, 24-bit LE)
	const vp8x = chunk('VP8X', [withExif ? 0x08 : 0, 0, 0, 0, 1, 0, 0, 2, 0, 0]);
	// VP8L header: signature 0x2f, 14-bit width-1, 14-bit height-1
	const bits = (2 - 1) | ((3 - 1) << 14);
	const vp8l = chunk('VP8L', [0x2f, bits & 0xff, (bits >> 8) & 0xff, (bits >> 16) & 0xff, (bits >> 24) & 0xff, 0, 0]);
	const exif = withExif ? chunk('EXIF', [...enc('MM GPS data!')]) : [];
	const body = [...enc('WEBP'), ...vp8x, ...vp8l, ...exif];
	return new Uint8Array([...enc('RIFF'), body.length & 0xff, (body.length >> 8) & 0xff, 0, 0, ...body]);
}

describe('validateImage', () => {
	it('accepts a PNG and strips text chunks', () => {
		const png = encodePng(4, 3, () => [0, 54, 96, 255], { Author: 'Anna Andersson', Comment: 'GPS' });
		const r = validateImage(png);
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.mime).toBe('image/png');
		expect([r.width, r.height]).toEqual([4, 3]);
		expect(has(png, 'Anna Andersson')).toBe(true);
		expect(has(r.bytes, 'Anna Andersson')).toBe(false);
		expect(has(r.bytes, 'IDAT')).toBe(true);
	});

	it('accepts a JPEG, drops EXIF and comments but keeps orientation', () => {
		const r = validateImage(jpegWithExif());
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.mime).toBe('image/jpeg');
		expect([r.width, r.height]).toEqual([1, 1]);
		expect(has(r.bytes, 'GPS')).toBe(false);
		expect(has(r.bytes, 'secret comment')).toBe(false);
		expect(has(r.bytes, 'JFIF')).toBe(true);
		const i = Buffer.from(r.bytes).indexOf(Buffer.from([0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6]));
		expect(i).toBeGreaterThan(0);
	});

	it('accepts a WebP, drops the EXIF chunk and clears its flag', () => {
		const r = validateImage(webpLossless(true));
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.mime).toBe('image/webp');
		expect([r.width, r.height]).toEqual([2, 3]);
		expect(has(r.bytes, 'GPS')).toBe(false);
		const b = Buffer.from(r.bytes);
		expect(b.readUInt32LE(4)).toBe(b.length - 8);
		expect(b[20] & 0x08).toBe(0);
	});

	it('rejects SVG, even when named or typed as PNG', () => {
		const svg = enc('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script></svg>');
		expect(sniff(svg)).toBeNull();
		const r = validateImage(svg);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.reason).toMatch(/SVG/);
		expect(validateImage(enc('<?xml version="1.0"?><svg/>')).ok).toBe(false);
	});

	it('rejects HTML disguised with a PNG signature', () => {
		const fake = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...enc('<html><script>alert(1)</script></html>')]);
		expect(sniff(fake)).toBe('image/png');
		expect(validateImage(fake).ok).toBe(false);
		expect(validateImage(enc('<!doctype html><html></html>')).ok).toBe(false);
	});

	it('rejects truncated images', () => {
		const png = encodePng(4, 4, () => [255, 255, 255, 255]);
		expect(validateImage(png.subarray(0, png.length - 12)).ok).toBe(false);
		const jpg = jpegWithExif();
		expect(validateImage(jpg.subarray(0, 30)).ok).toBe(false);
	});

	it('rejects empty and too-large files', () => {
		expect(validateImage(new Uint8Array()).ok).toBe(false);
		const big = new Uint8Array(MAX_BYTES + 1);
		big.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
		const r = validateImage(big);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.reason).toMatch(/2 MB/);
	});
});

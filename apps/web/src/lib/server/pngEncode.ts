import { crc32, deflateSync } from 'node:zlib';

/**
 * Minimal RGBA PNG encoder (seed data and tests). `pixel(x, y)` returns [r, g, b, a].
 * Optional `text` adds a tEXt chunk (used to test metadata stripping).
 */
export function encodePng(width: number, height: number, pixel: (x: number, y: number) => [number, number, number, number], text?: Record<string, string>): Uint8Array {
	const raw = Buffer.alloc((width * 4 + 1) * height);
	for (let y = 0; y < height; y++) {
		raw[y * (width * 4 + 1)] = 0;
		for (let x = 0; x < width; x++) raw.set(pixel(x, y), y * (width * 4 + 1) + 1 + x * 4);
	}
	const chunk = (type: string, data: Buffer) => {
		const len = Buffer.alloc(4);
		len.writeUInt32BE(data.length);
		const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
		const crc = Buffer.alloc(4);
		crc.writeUInt32BE(crc32(td));
		return Buffer.concat([len, td, crc]);
	};
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr.set([8, 6, 0, 0, 0], 8);
	const texts = Object.entries(text ?? {}).map(([k, v]) => chunk('tEXt', Buffer.from(`${k}\0${v}`, 'latin1')));
	return new Uint8Array(
		Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), ...texts, chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
	);
}

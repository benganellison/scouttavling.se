import QRCode from 'qrcode';

/** QR code as an inline SVG string (error correction M: survives a creased or wet print). */
export async function qrSvg(text: string, opts: { dark?: string; margin?: number } = {}): Promise<string> {
	return QRCode.toString(text, { type: 'svg', errorCorrectionLevel: 'M', margin: opts.margin ?? 1, color: { dark: opts.dark ?? '#000000', light: '#ffffff' } });
}

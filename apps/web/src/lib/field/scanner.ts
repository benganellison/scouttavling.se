/**
 * QR scanning (03 §6): native BarcodeDetector where it exists (Android Chrome),
 * otherwise the `barcode-detector` ponyfill (zxing-wasm). The WASM binary is
 * bundled locally (precached by the service worker) so scanning works offline.
 */
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';

interface Detector {
	detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}

let detectorPromise: Promise<Detector> | null = null;

async function createDetector(): Promise<Detector> {
	const Native = (globalThis as { BarcodeDetector?: { new (o: { formats: string[] }): Detector; getSupportedFormats?: () => Promise<string[]> } }).BarcodeDetector;
	if (Native) {
		try {
			const formats = (await Native.getSupportedFormats?.()) ?? ['qr_code'];
			if (formats.includes('qr_code')) return new Native({ formats: ['qr_code'] });
		} catch {
			/* fall through to ponyfill */
		}
	}
	const mod = await import('barcode-detector/ponyfill');
	mod.prepareZXingModule({
		overrides: { locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasmUrl : prefix + path) }
	});
	return new mod.BarcodeDetector({ formats: ['qr_code'] }) as unknown as Detector;
}

export function getDetector() {
	detectorPromise ??= createDetector();
	detectorPromise.catch(() => (detectorPromise = null));
	return detectorPromise;
}

export interface ScannerHandle {
	stop(): void;
	torch: { supported: boolean; set(on: boolean): Promise<void> };
}

/**
 * Starts the rear camera into `video` and calls `onCode` for every decoded QR
 * (deduplicated within `repeatMs`). Throws if the camera is unavailable.
 */
export async function startScanner(video: HTMLVideoElement, onCode: (text: string) => void, repeatMs = 2500): Promise<ScannerHandle> {
	if (!navigator.mediaDevices?.getUserMedia) throw new Error('Kameran stöds inte i den här webbläsaren');
	const stream = await navigator.mediaDevices.getUserMedia({
		audio: false,
		video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }
	});
	video.srcObject = stream;
	video.setAttribute('playsinline', '');
	video.muted = true;
	await video.play().catch(() => undefined);
	const detector = await getDetector();
	const track = stream.getVideoTracks()[0];
	const caps = (track?.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { torch?: boolean };

	let stopped = false;
	let last = '';
	let lastAt = 0;
	const loop = async () => {
		while (!stopped) {
			if (video.readyState >= 2) {
				try {
					const codes = await detector.detect(video);
					for (const c of codes) {
						const now = Date.now();
						if (c.rawValue === last && now - lastAt < repeatMs) continue;
						last = c.rawValue;
						lastAt = now;
						onCode(c.rawValue);
					}
				} catch {
					/* transient decode errors */
				}
			}
			await new Promise((r) => setTimeout(r, 200));
		}
	};
	void loop();
	return {
		stop() {
			stopped = true;
			stream.getTracks().forEach((t) => t.stop());
			video.srcObject = null;
		},
		torch: {
			supported: !!caps.torch,
			async set(on: boolean) {
				await track?.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] });
			}
		}
	};
}

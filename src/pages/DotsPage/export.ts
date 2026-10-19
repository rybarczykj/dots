// Offline export: renders frame by frame at any size, independent of how fast
// the live preview runs. Uses the same frame grab, grading, layout, background
// and GPU renderer as the live view, so output matches what's on screen.
import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import { DotShape } from './components/DotsMenu';
import { computeDotLayout, DotLayout, DotLayoutParams, getShapeName } from './dot-layout';
import { grabVideoFrame, processImageForDots, ProcessedPixelData } from './dots-utils';
import { BackgroundSource, createBackgroundPicker } from './background';
import { DotsGLRenderer } from './gl-renderer';

export interface ExportSettings {
    resolution: number;
    contrast: number;
    brightness: number;
    gamma: number;
    isColorInverted: boolean;
    useColors: boolean;
    layout: Omit<DotLayoutParams, 'dotSpacing'>;
    shape: DotShape;
    showDots: boolean;
    showOriginalBackground: boolean;
    applyGradingToOriginal: boolean;
    /** How often the dots update, in frames per second */
    frameRate: number;
    /** On-screen canvas size in CSS pixels; export scales this up */
    displayWidth: number;
    displayHeight: number;
}

export type ExportSource =
    | { kind: 'image'; file: File; pixelData: ProcessedPixelData }
    | { kind: 'video'; url: string };

export interface ExportInput {
    settings: ExportSettings;
    source: ExportSource;
    customBg: HTMLVideoElement | HTMLImageElement | null;
}

export type SizeId = 'max' | '4k' | '1080p' | 'screen';

export interface ExportSize {
    id: SizeId;
    scale: number;
    width: number;
    height: number;
    /** Video only: the encoder this size will use, found when sizes are listed */
    encoder?: EncoderChoice;
}

const even = (n: number) => Math.max(2, Math.floor(n / 2) * 2);

export const getExportSize = (settings: ExportSettings, scale: number, forVideo: boolean): Omit<ExportSize, 'id'> => {
    const width = Math.round(settings.displayWidth * scale);
    const height = Math.floor(settings.displayHeight * scale);
    // H.264/HEVC need even dimensions
    return forVideo ? { scale, width: even(width), height: even(height) } : { scale, width, height };
};

// QuickTime plays H.264 and HEVC. H.264 is preferred (plays everywhere) and tops out
// around 4096×2304; HEVC (hardware on Macs) goes to 8K.
const PLAYABLE_CODECS: { codec: string; mux: 'avc' | 'hevc' | 'vp9'; label: string }[] = [
    { codec: 'avc1.640034', mux: 'avc', label: 'h.264' },
    { codec: 'avc1.640033', mux: 'avc', label: 'h.264' },
    { codec: 'avc1.4D0034', mux: 'avc', label: 'h.264' },
    { codec: 'hvc1.1.6.L156.B0', mux: 'hevc', label: 'hevc' },
    { codec: 'hvc1.1.6.L183.B0', mux: 'hevc', label: 'hevc' },
    { codec: 'hvc1.1.6.L186.B0', mux: 'hevc', label: 'hevc' },
];
// Only for browsers with neither H.264 nor HEVC encoding (e.g. open-source Chromium);
// QuickTime can't play it
const FALLBACK_CODECS: typeof PLAYABLE_CODECS = [
    { codec: 'vp09.00.51.08', mux: 'vp9', label: 'vp9' },
    { codec: 'vp09.00.62.08', mux: 'vp9', label: 'vp9' },
];

export interface EncoderChoice {
    config: VideoEncoderConfig;
    mux: 'avc' | 'hevc' | 'vp9';
    label: string;
}

const findEncoderConfig = async (
    width: number,
    height: number,
    fps: number,
    codecs = PLAYABLE_CODECS
): Promise<EncoderChoice | null> => {
    if (typeof VideoEncoder === 'undefined') return null;
    // Dots are high-detail: ~0.3 bits per pixel, capped at 150 Mbps
    const bitrate = Math.min(150_000_000, Math.round(width * height * fps * 0.3));
    for (const { codec, mux, label } of codecs) {
        const config: VideoEncoderConfig = { codec, width, height, bitrate, framerate: fps };
        if (mux === 'avc') config.avc = { format: 'avc' };
        // mp4 needs length-prefixed HEVC with a decoder description, not Annex B
        if (mux === 'hevc') (config as VideoEncoderConfig & { hevc: { format: string } }).hevc = { format: 'hevc' };
        try {
            const { supported } = await VideoEncoder.isConfigSupported(config);
            if (supported) return { config, mux, label };
        } catch {
            // Try the next codec
        }
    }
    return null;
};

// Chrome's canvas area limit; the canvas probe below finds the real limit under it
const MAX_CANVAS_PIXELS = 268_435_456;
// Frames bigger than this are rendered in tiles: huge single GPU canvases fail silently
const TILE = 4096;
const canvasProbeCache = new Map<string, boolean>();

/** Allocate a 2D canvas and prove it works (oversized canvases silently draw nothing) */
const createWorkingCanvas = (width: number, height: number): HTMLCanvasElement | null => {
    try {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx || canvas.width !== width || canvas.height !== height) return null;
        ctx.fillStyle = 'rgb(51, 102, 153)';
        ctx.fillRect(width - 1, height - 1, 1, 1);
        const px = ctx.getImageData(width - 1, height - 1, 1, 1).data;
        if (px[0] !== 51 || px[1] !== 102 || px[2] !== 153) return null;
        return canvas;
    } catch {
        return null;
    }
};

/** Whether a frame this big can be produced (tiles always can; a big frame needs its canvas) */
const canProduceFrame = (width: number, height: number): boolean => {
    if (width <= TILE && height <= TILE) return true;
    const key = `${width}x${height}`;
    let ok = canvasProbeCache.get(key);
    if (ok === undefined) {
        const canvas = createWorkingCanvas(width, height);
        ok = canvas !== null;
        if (canvas) canvas.width = canvas.height = 0; // free it now
        canvasProbeCache.set(key, ok);
    }
    return ok;
};

/**
 * Renders export frames at any size. Up to TILE in both dimensions it draws directly on a GPU
 * canvas; above that it draws TILE-sized pieces and assembles them on a 2D canvas.
 */
class FrameRenderer {
    private glCanvas = document.createElement('canvas');
    private renderer = new DotsGLRenderer(this.glCanvas);
    private composite: HTMLCanvasElement | null = null;

    constructor(private settings: ExportSettings, private size: ExportSize) {}

    /** Render one frame and return the canvas holding it */
    render(background: BackgroundSource | null, layout: DotLayout | null, shape: DotShape): HTMLCanvasElement {
        const { settings, size, renderer } = this;
        const frame = {
            width: settings.displayWidth,
            height: settings.displayHeight,
            dpr: size.scale,
            pixelWidth: size.width,
            pixelHeight: size.height,
            background,
            layout,
            shape: getShapeName(shape),
        };
        if (size.width <= TILE && size.height <= TILE) {
            renderer.render(frame);
            renderer.assertRendered();
            return this.glCanvas;
        }
        this.composite ??= createWorkingCanvas(size.width, size.height);
        if (!this.composite) throw new Error(`Not enough memory for ${size.width}×${size.height}. Try a smaller size.`);
        const ctx = this.composite.getContext('2d')!;
        for (let y = 0; y < size.height; y += TILE) {
            for (let x = 0; x < size.width; x += TILE) {
                const tile = { x, y, width: Math.min(TILE, size.width - x), height: Math.min(TILE, size.height - y) };
                renderer.render({ ...frame, tile });
                renderer.assertRendered();
                ctx.drawImage(this.glCanvas, x, y);
            }
        }
        return this.composite;
    }

    dispose() {
        this.renderer.dispose();
        if (this.composite) this.composite.width = this.composite.height = 0;
    }
}

/** Largest scale (to 0.5% precision) for which `fits` holds, assuming smaller always fits */
const findMaxScale = async (upper: number, fits: (scale: number) => Promise<boolean> | boolean): Promise<number | null> => {
    if (await fits(upper)) return upper;
    let lo = 0;
    let hi = upper;
    while (hi - lo > upper * 0.005) {
        const mid = (lo + hi) / 2;
        if (await fits(mid)) lo = mid;
        else hi = mid;
    }
    return lo > 0 ? lo : null;
};

/**
 * Export sizes for this browser, largest first: "max" (everything the GPU and encoder allow),
 * then 4K / 1080p (by long side) and the on-screen size when smaller than max.
 */
export const getAvailableSizes = async (settings: ExportSettings, forVideo: boolean, fps: number): Promise<ExportSize[]> => {
    const { displayWidth: w, displayHeight: h } = settings;
    const longSide = Math.max(w, h);
    const upper = Math.min(16384 / longSide, Math.sqrt(MAX_CANVAS_PIXELS / (w * h)));

    let codecs = PLAYABLE_CODECS;
    if (forVideo) {
        const small = getExportSize(settings, 640 / longSide, true);
        if (!(await findEncoderConfig(small.width, small.height, fps))) codecs = FALLBACK_CODECS;
    }
    const fits = async (scale: number) => {
        const size = getExportSize(settings, scale, forVideo);
        if (!canProduceFrame(size.width, size.height)) return false;
        return !forVideo || !!(await findEncoderConfig(size.width, size.height, fps, codecs));
    };

    const maxScale = await findMaxScale(upper, fits);
    if (maxScale === null) return [];

    const candidates: { id: SizeId; scale: number }[] = [
        { id: 'max', scale: maxScale },
        { id: '4k', scale: 3840 / longSide },
        { id: '1080p', scale: 1920 / longSide },
        { id: 'screen', scale: 1 },
    ];
    const sizes: ExportSize[] = [];
    for (const { id, scale } of candidates) {
        // Skip presets at or above max (within 2%, so "4K" doesn't duplicate a 4096 max)
        if (id !== 'max' && scale > maxScale * 0.98) continue;
        const size: ExportSize = { id, ...getExportSize(settings, scale, forVideo) };
        if (forVideo) {
            const encoder = await findEncoderConfig(size.width, size.height, fps, codecs);
            if (!encoder) continue;
            size.encoder = encoder;
        }
        sizes.push(size);
    }
    return sizes;
};

const loadImage = (file: File) =>
    new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Could not load image'));
        img.src = URL.createObjectURL(file);
    });

const loadVideo = (url: string) =>
    new Promise<HTMLVideoElement>((resolve, reject) => {
        const video = document.createElement('video');
        video.muted = true;
        video.playsInline = true;
        video.preload = 'auto';
        video.addEventListener('loadeddata', () => resolve(video), { once: true });
        video.addEventListener('error', () => reject(new Error('Could not load video')), { once: true });
        video.src = url;
    });

const abortError = () => new DOMException('Export cancelled', 'AbortError');

const SEEK_TIMEOUT_MS = 10_000;

/** Seek and wait for the frame. Rejects on decode error, stall or cancel instead of hanging. */
const seek = (video: HTMLVideoElement, time: number, signal: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
        if (signal.aborted) {
            reject(abortError());
            return;
        }
        if (Math.abs(video.currentTime - time) < 1e-6 && video.readyState >= 2) {
            resolve();
            return;
        }
        const finish = (error?: Error) => {
            clearTimeout(timer);
            video.removeEventListener('seeked', onSeeked);
            video.removeEventListener('error', onError);
            signal.removeEventListener('abort', onAbort);
            if (error) reject(error);
            else resolve();
        };
        const onSeeked = () => finish();
        const onError = () => finish(new Error(`The video failed to decode at ${time.toFixed(2)}s.`));
        const onAbort = () => finish(abortError());
        const timer = setTimeout(
            () => finish(new Error(`The video stopped responding at ${time.toFixed(2)}s. Try re-saving it as mp4.`)),
            SEEK_TIMEOUT_MS
        );
        video.addEventListener('seeked', onSeeked);
        video.addEventListener('error', onError);
        signal.addEventListener('abort', onAbort);
        video.currentTime = time;
    });

const unloadVideo = (video: HTMLVideoElement) => {
    video.removeAttribute('src');
    video.load();
};

const checkAborted = (signal: AbortSignal) => {
    if (signal.aborted) throw abortError();
};

const layoutFor = (settings: ExportSettings, pixelData: ProcessedPixelData, reuse: DotLayout | null) =>
    settings.showDots
        ? computeDotLayout(pixelData, { ...settings.layout, dotSpacing: settings.displayWidth / pixelData.width }, reuse)
        : null;

export const exportImage = async (input: ExportInput, size: ExportSize): Promise<Blob> => {
    if (input.source.kind !== 'image') throw new Error('Not an image source');
    const { settings } = input;
    const { pixelData } = input.source;
    const original = await loadImage(input.source.file);
    let frames: FrameRenderer | null = null;
    try {
        frames = new FrameRenderer(settings, size);
        const canvas = frames.render(
            createBackgroundPicker()({
                customBg: input.customBg,
                showOriginalBackground: settings.showOriginalBackground,
                applyGradingToOriginal: settings.applyGradingToOriginal,
                pixelData,
                original,
            }),
            layoutFor(settings, pixelData, null),
            settings.shape
        );
        return await new Promise<Blob>((resolve, reject) =>
            canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('PNG encoding failed'))), 'image/png')
        );
    } finally {
        frames?.dispose();
        URL.revokeObjectURL(original.src);
    }
};

export const exportVideo = async (
    input: ExportInput,
    size: ExportSize,
    fps: number,
    signal: AbortSignal,
    onProgress: (done: number, total: number) => void
): Promise<Blob> => {
    if (input.source.kind !== 'video') throw new Error('Not a video source');
    const { settings } = input;
    const choice = size.encoder ?? (await findEncoderConfig(size.width, size.height, fps));
    if (!choice) throw new Error(`This browser can't encode ${size.width}×${size.height} video. Try a smaller size.`);

    let video: HTMLVideoElement | null = null;
    let bgCopy: HTMLVideoElement | null = null;
    let frames: FrameRenderer | null = null;
    let encoder: VideoEncoder | null = null;
    try {
        video = await loadVideo(input.source.url);
        // Export a private copy of a video background so the live one keeps playing
        if (input.customBg instanceof HTMLVideoElement) bgCopy = await loadVideo(input.customBg.src);
        const customBg = bgCopy ?? input.customBg;
        frames = new FrameRenderer(settings, size);
        const grabCanvas = document.createElement('canvas');
        const pickBackground = createBackgroundPicker();

        if (!Number.isFinite(video.duration)) {
            throw new Error("This video doesn't report its length, so it can't be exported. Re-save it as mp4 and try again.");
        }

        const muxer = new Muxer({
            target: new ArrayBufferTarget(),
            video: { codec: choice.mux, width: size.width, height: size.height, frameRate: fps },
            fastStart: 'in-memory',
        });
        let encodeError: Error | null = null;
        encoder = new VideoEncoder({
            output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
            error: (e) => {
                encodeError = e;
            },
        });
        encoder.configure(choice.config);

        // The source frame is needed every output frame only when it is the background;
        // otherwise once per dots update, which saves most seeks at high output fps
        const sourceIsBackground = settings.showOriginalBackground && !customBg && !settings.applyGradingToOriginal;
        const total = Math.max(1, Math.round(video.duration * fps));
        let pixelData: ProcessedPixelData | null = null;
        let layout: DotLayout | null = null;
        let lastSlot = -1;

        for (let i = 0; i < total; i++) {
            checkAborted(signal);
            if (encodeError) throw encodeError;
            const time = i / fps;

            // Dots update at the chosen framerate, like the live view
            const slot = Math.floor(time * settings.frameRate);
            const newSlot = slot !== lastSlot || !pixelData;
            if (newSlot || sourceIsBackground) await seek(video, time, signal);
            if (customBg instanceof HTMLVideoElement && customBg.duration > 0) {
                await seek(customBg, time % customBg.duration, signal);
            }

            if (newSlot) {
                const imageData = grabVideoFrame(video, settings.resolution, grabCanvas);
                if (imageData) {
                    pixelData = processImageForDots(
                        imageData,
                        settings.contrast,
                        settings.brightness,
                        settings.gamma,
                        settings.isColorInverted,
                        settings.useColors
                    );
                    layout = layoutFor(settings, pixelData, layout);
                }
                lastSlot = slot;
            }

            const canvas = frames.render(
                pickBackground({
                    customBg,
                    showOriginalBackground: settings.showOriginalBackground,
                    applyGradingToOriginal: settings.applyGradingToOriginal,
                    pixelData,
                    original: video,
                }),
                layout,
                settings.shape
            );
            const frame = new VideoFrame(canvas, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
            encoder.encode(frame, { keyFrame: i % (fps * 2) === 0 });
            frame.close();
            // Don't let the encoder queue grow unbounded at large sizes
            while (encoder.encodeQueueSize > 4) {
                await new Promise((resolve) => setTimeout(resolve, 1));
            }
            onProgress(i + 1, total);
        }

        await encoder.flush();
        if (encodeError) throw encodeError;
        muxer.finalize();
        return new Blob([muxer.target.buffer], { type: 'video/mp4' });
    } finally {
        if (encoder && encoder.state !== 'closed') encoder.close();
        frames?.dispose();
        if (video) unloadVideo(video);
        if (bgCopy) unloadVideo(bgCopy);
    }
};

export const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
};

// Offline export: renders frame by frame at any size, independent of how fast
// the live preview runs. Uses the same frame grab, grading, layout, background
// and GPU renderer as the live view, so output matches what's on screen.
import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import { DotShape } from './components/DotsMenu';
import { computeDotLayout, DotLayout, DotLayoutParams, getShapeName } from './dot-layout';
import { grabVideoFrame, processImageForDots, ProcessedPixelData } from './dots-utils';
import { createBackgroundPicker } from './background';
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

export interface ExportSize {
    scale: number;
    width: number;
    height: number;
}

// Larger frames fail silently on some GPUs, and Safari caps canvases at 16.7 MP
const MAX_SIDE = 8192;
const MAX_PIXELS = 4096 * 4096;
const SCALES = [1, 2, 3, 4, 6, 8];
const even = (n: number) => Math.max(2, Math.floor(n / 2) * 2);

export const getExportSize = (settings: ExportSettings, scale: number, forVideo: boolean): ExportSize => {
    const width = Math.round(settings.displayWidth * scale);
    const height = Math.floor(settings.displayHeight * scale);
    // H.264 needs even dimensions
    return forVideo ? { scale, width: even(width), height: even(height) } : { scale, width, height };
};

// H.264 plays everywhere (QuickTime included); VP9 is the fallback for browsers
// without an H.264 encoder (e.g. open-source Chromium builds)
const CODECS: { codec: string; mux: 'avc' | 'vp9'; label: string }[] = [
    { codec: 'avc1.640034', mux: 'avc', label: 'h.264' },
    { codec: 'avc1.640033', mux: 'avc', label: 'h.264' },
    { codec: 'avc1.64002A', mux: 'avc', label: 'h.264' },
    { codec: 'avc1.4D0034', mux: 'avc', label: 'h.264' },
    { codec: 'vp09.00.51.08', mux: 'vp9', label: 'vp9' },
    { codec: 'vp09.00.62.08', mux: 'vp9', label: 'vp9' },
];

interface EncoderChoice {
    config: VideoEncoderConfig;
    mux: 'avc' | 'vp9';
    label: string;
}

const findEncoderConfig = async (width: number, height: number, fps: number): Promise<EncoderChoice | null> => {
    if (typeof VideoEncoder === 'undefined') return null;
    // Dots are high-detail: ~0.3 bits per pixel, capped at 150 Mbps
    const bitrate = Math.min(150_000_000, Math.round(width * height * fps * 0.3));
    for (const { codec, mux, label } of CODECS) {
        const config: VideoEncoderConfig = { codec, width, height, bitrate, framerate: fps };
        if (mux === 'avc') config.avc = { format: 'avc' };
        try {
            const { supported } = await VideoEncoder.isConfigSupported(config);
            if (supported) return { config, mux, label };
        } catch {
            // Try the next codec
        }
    }
    return null;
};

/** Codec the video export will use at this size, e.g. "h.264" */
export const getVideoCodecLabel = async (size: ExportSize, fps: number) =>
    (await findEncoderConfig(size.width, size.height, fps))?.label ?? null;

/** Sizes this browser can export, smallest first */
export const getAvailableSizes = async (settings: ExportSettings, forVideo: boolean, fps: number): Promise<ExportSize[]> => {
    const sizes: ExportSize[] = [];
    for (const scale of SCALES) {
        const size = getExportSize(settings, scale, forVideo);
        if (size.width > MAX_SIDE || size.height > MAX_SIDE || size.width * size.height > MAX_PIXELS) break;
        if (forVideo && !(await findEncoderConfig(size.width, size.height, fps))) break;
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

const seek = (video: HTMLVideoElement, time: number) =>
    new Promise<void>((resolve) => {
        if (Math.abs(video.currentTime - time) < 1e-6 && video.readyState >= 2) {
            resolve();
            return;
        }
        video.addEventListener('seeked', () => resolve(), { once: true });
        video.currentTime = time;
    });

const checkAborted = (signal: AbortSignal) => {
    if (signal.aborted) throw new DOMException('Export cancelled', 'AbortError');
};

const createRenderer = () => {
    const canvas = document.createElement('canvas');
    return { canvas, renderer: new DotsGLRenderer(canvas) };
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
    const { canvas, renderer } = createRenderer();
    try {
        renderer.render({
            width: settings.displayWidth,
            height: settings.displayHeight,
            dpr: size.scale,
            pixelWidth: size.width,
            pixelHeight: size.height,
            background: createBackgroundPicker()({
                customBg: input.customBg,
                showOriginalBackground: settings.showOriginalBackground,
                applyGradingToOriginal: settings.applyGradingToOriginal,
                pixelData,
                original,
            }),
            layout: layoutFor(settings, pixelData, null),
            shape: getShapeName(settings.shape),
        });
        renderer.assertRendered();
        return await new Promise<Blob>((resolve, reject) =>
            canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('PNG encoding failed'))), 'image/png')
        );
    } finally {
        renderer.dispose();
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
    const choice = await findEncoderConfig(size.width, size.height, fps);
    if (!choice) throw new Error(`This browser can't encode ${size.width}×${size.height} video. Try a smaller size.`);

    const video = await loadVideo(input.source.url);
    // Export a private copy of a video background so the live one keeps playing
    const customBg =
        input.customBg instanceof HTMLVideoElement ? await loadVideo(input.customBg.src) : input.customBg;
    const { canvas, renderer } = createRenderer();
    const grabCanvas = document.createElement('canvas');
    const pickBackground = createBackgroundPicker();

    const muxer = new Muxer({
        target: new ArrayBufferTarget(),
        video: { codec: choice.mux, width: size.width, height: size.height, frameRate: fps },
        fastStart: 'in-memory',
    });
    let encodeError: Error | null = null;
    const encoder = new VideoEncoder({
        output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
        error: (e) => {
            encodeError = e;
        },
    });
    encoder.configure(choice.config);

    try {
        if (!Number.isFinite(video.duration)) {
            throw new Error("This video doesn't report its length, so it can't be exported. Re-save it as mp4 and try again.");
        }
        const total = Math.max(1, Math.round(video.duration * fps));
        let pixelData: ProcessedPixelData | null = null;
        let layout: DotLayout | null = null;
        let lastSlot = -1;

        for (let i = 0; i < total; i++) {
            checkAborted(signal);
            if (encodeError) throw encodeError;
            const time = i / fps;
            await seek(video, time);
            if (customBg instanceof HTMLVideoElement && customBg.duration > 0) {
                await seek(customBg, time % customBg.duration);
            }

            // Dots update at the chosen framerate, like the live view
            const slot = Math.floor(time * settings.frameRate);
            if (slot !== lastSlot || !pixelData) {
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

            renderer.render({
                width: settings.displayWidth,
                height: settings.displayHeight,
                dpr: size.scale,
                pixelWidth: size.width,
                pixelHeight: size.height,
                background: pickBackground({
                    customBg,
                    showOriginalBackground: settings.showOriginalBackground,
                    applyGradingToOriginal: settings.applyGradingToOriginal,
                    pixelData,
                    original: video,
                }),
                layout,
                shape: getShapeName(settings.shape),
            });

            renderer.assertRendered();
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
        if (encoder.state !== 'closed') encoder.close();
        renderer.dispose();
        video.removeAttribute('src');
        video.load();
        if (customBg instanceof HTMLVideoElement && customBg !== input.customBg) {
            customBg.removeAttribute('src');
            customBg.load();
        }
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

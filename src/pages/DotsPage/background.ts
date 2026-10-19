// Picks what is drawn beneath the dots. Shared by the live canvas and export so
// both composite identically.
import { ProcessedPixelData } from './dots-utils';

export type BackgroundSource = HTMLCanvasElement | HTMLVideoElement | HTMLImageElement;

export interface BackgroundInputs {
    customBg: HTMLVideoElement | HTMLImageElement | null;
    showOriginalBackground: boolean;
    applyGradingToOriginal: boolean;
    pixelData: ProcessedPixelData | null;
    /** The source image or video the dots are made from */
    original: HTMLVideoElement | HTMLImageElement | null;
}

const isReady = (el: HTMLVideoElement | HTMLImageElement) =>
    el instanceof HTMLVideoElement ? el.readyState >= 2 : el.complete && el.naturalWidth > 0;

/** Returns a picker that caches the graded-background canvas per pixelData frame */
export const createBackgroundPicker = () => {
    let graded: { source: ProcessedPixelData; canvas: HTMLCanvasElement } | null = null;

    return (inputs: BackgroundInputs): BackgroundSource | null => {
        if (inputs.customBg) {
            return isReady(inputs.customBg) ? inputs.customBg : null;
        }
        if (!inputs.showOriginalBackground) return null;
        if (inputs.applyGradingToOriginal && inputs.pixelData) {
            // Processed pixelData as background (color grading applied)
            const pixelData = inputs.pixelData;
            if (graded?.source !== pixelData) {
                // A fresh canvas per frame, so the GPU renderer knows the contents changed
                const canvas = document.createElement('canvas');
                canvas.width = pixelData.width;
                canvas.height = pixelData.height;
                canvas
                    .getContext('2d')!
                    .putImageData(new ImageData(pixelData.pixels, pixelData.width, pixelData.height), 0, 0);
                graded = { source: pixelData, canvas };
            }
            return graded.canvas;
        }
        return inputs.original && isReady(inputs.original) ? inputs.original : null;
    };
};

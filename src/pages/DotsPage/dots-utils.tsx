// Dots-specific utilities
import { getGreyscale, getColors, getRawColors, resizeImage } from '../../shared/utils';
import { applyBrightness, applyContrast, applyGamma, calculateLuminance } from '../../shared/utils/color-utils';

// Re-export shared utilities
export { getGreyscale, getColors, getRawColors, resizeImage };
export { applyBrightness, applyContrast, applyGamma, calculateLuminance };

export interface ProcessedPixelData {
    /** Graded colors, RGBA row-major (alpha always 255) */
    pixels: Uint8ClampedArray;
    /** Original unmodified colors (before contrast/brightness/inversion), RGBA row-major */
    originalPixels: Uint8ClampedArray;
    width: number;
    height: number;
}

/**
 * Process image data for dots rendering
 * Returns RGBA buffers with contrast, brightness, and gamma applied
 */
export const processImageForDots = (
    imageData: ImageData,
    contrast: number,
    brightness: number,
    gamma: number,
    isColorInverted: boolean,
    useColors: boolean
): ProcessedPixelData => {
    const width = imageData.width;
    const height = imageData.height;
    const originalPixels = new Uint8ClampedArray(imageData.data);
    const result = new Uint8ClampedArray(width * height * 4);

    for (let i = 0; i < result.length; i += 4) {
        let r = originalPixels[i];
        let g = originalPixels[i + 1];
        let b = originalPixels[i + 2];
        originalPixels[i + 3] = 255;

        if (useColors) {
            // Apply adjustments to each channel: brightness → contrast → gamma
            const luminance = calculateLuminance(r, g, b);
            const adjustedLuminance = applyGamma(
                applyContrast(applyBrightness(luminance, brightness), contrast),
                gamma
            );

            // Scale RGB values by the luminance adjustment factor
            const factor = luminance > 0 ? adjustedLuminance / luminance : 1;
            r = Math.min(255, Math.max(0, Math.round(r * factor)));
            g = Math.min(255, Math.max(0, Math.round(g * factor)));
            b = Math.min(255, Math.max(0, Math.round(b * factor)));

            if (isColorInverted) {
                r = 255 - r;
                g = 255 - g;
                b = 255 - b;
            }
        } else {
            // Greyscale mode: brightness → contrast → gamma
            const luminance = calculateLuminance(r, g, b);
            const adjustedLuminance = applyGamma(
                applyContrast(applyBrightness(luminance, brightness), contrast),
                gamma
            );
            const grey = isColorInverted ? 255 - adjustedLuminance : adjustedLuminance;
            r = g = b = Math.round(grey);
        }

        result[i] = r;
        result[i + 1] = g;
        result[i + 2] = b;
        result[i + 3] = 255;
    }

    return { pixels: result, originalPixels, width, height };
};

/**
 * Downscale the current video frame to the dot grid (resolution dots wide) and
 * return its pixels. Reuses the given canvas between frames.
 */
export const grabVideoFrame = (video: HTMLVideoElement, resolution: number, canvas: HTMLCanvasElement): ImageData | null => {
    const aspectRatio = video.videoWidth / video.videoHeight;
    const width = resolution;
    // Use true aspect ratio for dots (no 0.6 multiplier - that's for ASCII chars)
    const height = Math.floor(width / aspectRatio);
    if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
    }
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(video, 0, 0, width, height);
    return context.getImageData(0, 0, width, height);
};

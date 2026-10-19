// Renderer-agnostic dot layout. Every rule deciding a dot's size, color and
// visibility lives here; renderers only rasterize the result. Keep it that way so
// the p5 and GPU renderers can't drift apart.
import { ProcessedPixelData } from './dots-utils';
import { DotShape } from './components/DotsMenu';

export const SHAPE_NAMES = ['circle', 'square', 'diamond', 'triangle', 'cross', 'ring'] as const;
export type ShapeName = (typeof SHAPE_NAMES)[number];

// Extract shape name from format like "● circle"
export const getShapeName = (shape: DotShape): ShapeName => shape.split(' ')[1] as ShapeName;

export interface DotLayoutParams {
    minDotSize: number;
    maxDotSize: number;
    forceOGColors: boolean;
    removeWhite: boolean;
    whitePoint: number;
    /** Distance between dot centers, in canvas (CSS) pixels */
    dotSpacing: number;
}

export interface DotLayout {
    cols: number;
    rows: number;
    dotSpacing: number;
    /** Dot diameter per cell, row-major. 0 means the dot is not drawn. */
    sizes: Float32Array;
    /** Dot color per cell, RGBA row-major */
    colors: Uint8ClampedArray;
}

/**
 * Compute size and color of every dot. Pass the previous layout to reuse its
 * buffers (avoids reallocating every video frame).
 */
export const computeDotLayout = (
    pixelData: ProcessedPixelData,
    params: DotLayoutParams,
    reuse?: DotLayout | null
): DotLayout => {
    const { width: cols, height: rows, pixels } = pixelData;
    const count = cols * rows;
    const sizes = reuse && reuse.sizes.length === count ? reuse.sizes : new Float32Array(count);
    const colors = params.forceOGColors ? pixelData.originalPixels : pixels;
    const maxPossibleSize = params.dotSpacing * 0.95;

    for (let i = 0; i < count; i++) {
        const r = pixels[i * 4];
        const g = pixels[i * 4 + 1];
        const b = pixels[i * 4 + 2];

        const brightness = (r + g + b) / (3 * 255);
        const sizeMultiplier = params.minDotSize + (params.maxDotSize - params.minDotSize) * brightness;
        const dotSize = maxPossibleSize * sizeMultiplier;

        const hidden = dotSize < 0.5 || (params.removeWhite && (r + g + b) / 3 >= params.whitePoint);
        sizes[i] = hidden ? 0 : dotSize;
    }

    return { cols, rows, dotSpacing: params.dotSpacing, sizes, colors };
};

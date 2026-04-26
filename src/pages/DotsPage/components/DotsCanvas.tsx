import React from 'react';
import Sketch from 'react-p5';
import { ProcessedPixelData } from '../dots-utils';
import { DotShape } from './DotsMenu';

// Using 'any' for p5 types due to react-p5 using older @types/p5 version
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type P5Instance = any;

interface DotsCanvasProps {
    pixelData: ProcessedPixelData | null;
    zoom: number;
    resolution: number;
    sourceAspectRatio: number | null;
    minDotSize: number;
    maxDotSize: number;
    shape: DotShape;
    forceOGColors: boolean;
    removeWhite: boolean;
    whitePoint: number;
    showOriginalBackground: boolean;
    applyGradingToOriginal: boolean;
    showDots: boolean;
    customBgElement: HTMLVideoElement | HTMLImageElement | null;
    sourceFile: File | null;
    videoElement: HTMLVideoElement | null;
    className?: string;
}

// Helper to draw different shapes
const drawShape = (p5: P5Instance, shape: DotShape, x: number, y: number, size: number) => {
    const half = size / 2;
    
    // Extract shape name from format like "● circle"
    const shapeName = shape.split(' ')[1];
    
    switch (shapeName) {
        case 'circle':
            p5.circle(x, y, size);
            break;
        case 'square':
            p5.rectMode(p5.CENTER);
            p5.rect(x, y, size, size);
            break;
        case 'diamond':
            p5.push();
            p5.translate(x, y);
            p5.rotate(p5.PI / 4);
            p5.rectMode(p5.CENTER);
            p5.rect(0, 0, size * 0.7, size * 0.7);
            p5.pop();
            break;
        case 'triangle':
            p5.triangle(
                x, y - half,
                x - half, y + half * 0.6,
                x + half, y + half * 0.6
            );
            break;
        case 'cross':
            const thickness = size * 0.3;
            p5.rectMode(p5.CENTER);
            p5.rect(x, y, size, thickness);
            p5.rect(x, y, thickness, size);
            break;
        case 'ring':
            p5.noFill();
            p5.strokeWeight(size * 0.15);
            p5.circle(x, y, size * 0.85);
            break;
    }
};

export const DotsCanvas: React.FC<DotsCanvasProps> = ({
    pixelData,
    zoom,
    resolution,
    sourceAspectRatio,
    minDotSize,
    maxDotSize,
    shape,
    forceOGColors,
    removeWhite,
    whitePoint,
    showOriginalBackground,
    applyGradingToOriginal,
    showDots,
    customBgElement,
    sourceFile,
    videoElement,
    className,
}) => {
    const p5Ref = React.useRef<P5Instance | null>(null);
    const backgroundImageRef = React.useRef<HTMLImageElement | null>(null);
    const lastSourceUrlRef = React.useRef<string | null>(null);

    // Lock canvas to a fixed size (1000*zoom wide, height from stable aspect ratio).
    // dotSpacing is derived from pixelData.width so canvas width = 1000*zoom exactly.
    // Canvas height uses the source aspect ratio (set once per source) to avoid rounding
    // jitter from integer pixelData dimensions at different resolutions.
    const targetWidth = 1000 * zoom;
    const targetHeight = sourceAspectRatio ? targetWidth / sourceAspectRatio : targetWidth;
    const dotSpacing = pixelData ? targetWidth / pixelData.width : (1000 / resolution) * zoom;

    // Refs so draw() always sees latest props (react-p5 can invoke a stale draw on redraw())
    const drawParamsRef = React.useRef({
        pixelData,
        forceOGColors,
        removeWhite,
        whitePoint,
        shape,
        minDotSize,
        maxDotSize,
        dotSpacing,
        targetWidth,
        targetHeight,
        showOriginalBackground,
        applyGradingToOriginal,
        showDots,
        customBgElement,
        videoElement,
    });
    drawParamsRef.current = {
        pixelData,
        forceOGColors,
        removeWhite,
        whitePoint,
        shape,
        minDotSize,
        maxDotSize,
        dotSpacing,
        targetWidth,
        targetHeight,
        showOriginalBackground,
        applyGradingToOriginal,
        showDots,
        customBgElement,
        videoElement,
    };

    // Load background image when sourceFile changes
    React.useEffect(() => {
        if (sourceFile && showOriginalBackground) {
            const url = URL.createObjectURL(sourceFile);
            const img = new Image();
            img.onload = () => {
                backgroundImageRef.current = img;
                if (p5Ref.current) {
                    p5Ref.current.redraw();
                }
            };
            img.src = url;
            
            // Cleanup previous URL
            if (lastSourceUrlRef.current) {
                URL.revokeObjectURL(lastSourceUrlRef.current);
            }
            lastSourceUrlRef.current = url;
            
            return () => {
                URL.revokeObjectURL(url);
            };
        } else {
            backgroundImageRef.current = null;
        }
    }, [sourceFile, showOriginalBackground]);

    // Force redraw when any visual setting changes
    React.useEffect(() => {
        if (p5Ref.current && pixelData) {
            p5Ref.current.redraw();
        }
    }, [pixelData, zoom, resolution, dotSpacing, minDotSize, maxDotSize, shape, forceOGColors, removeWhite, whitePoint, showOriginalBackground, applyGradingToOriginal, showDots, customBgElement]);

    // Continuous redraw loop for custom video backgrounds
    React.useEffect(() => {
        if (!customBgElement || !(customBgElement instanceof HTMLVideoElement)) return;
        let rafId: number;
        const loop = () => {
            if (p5Ref.current) p5Ref.current.redraw();
            rafId = requestAnimationFrame(loop);
        };
        rafId = requestAnimationFrame(loop);
        return () => cancelAnimationFrame(rafId);
    }, [customBgElement]);

    const setup = (p5: P5Instance, canvasParentRef: Element) => {
        p5Ref.current = p5;
        const params = drawParamsRef.current;
        if (!params.pixelData) {
            p5.createCanvas(0, 0).parent(canvasParentRef);
            p5.noLoop();
            return;
        }

        p5.createCanvas(params.targetWidth, params.targetHeight).parent(canvasParentRef);
        p5.noLoop();
        p5.noStroke();
    };

    const draw = (p5: P5Instance) => {
        const params = drawParamsRef.current;
        p5.background(255);
        p5.noStroke();

        if (!params.pixelData) {
            return;
        }

        const maxPossibleSize = params.dotSpacing * 0.95;
        if (p5.width !== params.targetWidth || p5.height !== params.targetHeight) {
            p5.resizeCanvas(params.targetWidth, params.targetHeight);
        }

        // Draw custom background (no FX)
        if (params.customBgElement) {
            const ctx = p5.drawingContext as CanvasRenderingContext2D;
            if (params.customBgElement instanceof HTMLVideoElement && params.customBgElement.readyState >= 2) {
                ctx.drawImage(params.customBgElement, 0, 0, params.targetWidth, params.targetHeight);
            } else if (params.customBgElement instanceof HTMLImageElement) {
                ctx.drawImage(params.customBgElement, 0, 0, params.targetWidth, params.targetHeight);
            }
        }

        if (params.showOriginalBackground && !params.customBgElement) {
            const ctx = p5.drawingContext as CanvasRenderingContext2D;
            if (params.applyGradingToOriginal && params.pixelData) {
                // Draw processed pixelData as background (color grading applied)
                const tmpCanvas = document.createElement('canvas');
                tmpCanvas.width = params.pixelData.width;
                tmpCanvas.height = params.pixelData.height;
                const tmpCtx = tmpCanvas.getContext('2d')!;
                const imgData = tmpCtx.createImageData(params.pixelData.width, params.pixelData.height);
                for (let y = 0; y < params.pixelData.height; y++) {
                    for (let x = 0; x < params.pixelData.width; x++) {
                        const px = params.pixelData.pixels[y][x];
                        const i = (y * params.pixelData.width + x) * 4;
                        imgData.data[i] = px.r;
                        imgData.data[i + 1] = px.g;
                        imgData.data[i + 2] = px.b;
                        imgData.data[i + 3] = 255;
                    }
                }
                tmpCtx.putImageData(imgData, 0, 0);
                ctx.imageSmoothingEnabled = true;
                ctx.drawImage(tmpCanvas, 0, 0, params.targetWidth, params.targetHeight);
            } else if (params.videoElement && params.videoElement.readyState >= 2) {
                ctx.drawImage(params.videoElement, 0, 0, params.targetWidth, params.targetHeight);
            } else if (backgroundImageRef.current) {
                ctx.drawImage(backgroundImageRef.current, 0, 0, params.targetWidth, params.targetHeight);
            }
        }

        if (!params.showDots) return;

        for (let y = 0; y < params.pixelData.height; y++) {
            for (let x = 0; x < params.pixelData.width; x++) {
                const pixel = params.pixelData.pixels[y][x];
                const colorPixel = params.forceOGColors ? params.pixelData.originalPixels[y][x] : pixel;

                const brightness = (pixel.r + pixel.g + pixel.b) / (3 * 255);
                const sizeMultiplier = params.minDotSize + (params.maxDotSize - params.minDotSize) * brightness;
                const dotSize = maxPossibleSize * sizeMultiplier;

                if (dotSize < 0.5) {
                    continue;
                }

                if (params.removeWhite) {
                    const avgBrightness = (pixel.r + pixel.g + pixel.b) / 3;
                    if (avgBrightness >= params.whitePoint) {
                        continue;
                    }
                }

                if (params.shape.includes('ring')) {
                    p5.stroke(colorPixel.r, colorPixel.g, colorPixel.b);
                    p5.noFill();
                } else {
                    p5.noStroke();
                    p5.fill(colorPixel.r, colorPixel.g, colorPixel.b);
                }

                drawShape(
                    p5,
                    params.shape,
                    x * params.dotSpacing + params.dotSpacing / 2,
                    y * params.dotSpacing + params.dotSpacing / 2,
                    dotSize
                );
            }
        }
    };

    return (
        <div className={className}>
            <Sketch setup={setup} draw={draw} />
        </div>
    );
};


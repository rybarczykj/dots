import React from 'react';
import Sketch from 'react-p5';
import { ProcessedPixelData } from '../dots-utils';
import { DotShape } from './DotsMenu';
import { computeDotLayout, DotLayout, getShapeName, ShapeName } from '../dot-layout';
import { DotsGLRenderer } from '../gl-renderer';

export type DotsRenderer = 'p5' | 'gpu';

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
    renderer: DotsRenderer;
    className?: string;
}

// Helper to draw different shapes. Geometry is mirrored by the GPU shader in gl-renderer.ts
const drawShape = (p5: P5Instance, shapeName: ShapeName, x: number, y: number, size: number) => {
    const half = size / 2;

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
    renderer,
    className,
}) => {
    const p5Ref = React.useRef<P5Instance | null>(null);
    const glCanvasRef = React.useRef<HTMLCanvasElement | null>(null);
    const glRendererRef = React.useRef<DotsGLRenderer | null>(null);
    const layoutRef = React.useRef<DotLayout | null>(null);
    const gradedBgRef = React.useRef<{ source: ProcessedPixelData; canvas: HTMLCanvasElement } | null>(null);
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
        renderer,
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
        renderer,
    };

    // Load background image when sourceFile changes
    React.useEffect(() => {
        if (sourceFile && showOriginalBackground) {
            const url = URL.createObjectURL(sourceFile);
            const img = new Image();
            img.onload = () => {
                backgroundImageRef.current = img;
                requestRender();
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
        // requestRender reads latest state from drawParamsRef
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sourceFile, showOriginalBackground]);

    // Background shown beneath the dots, or null for plain white
    const getBackgroundSource = (): HTMLCanvasElement | HTMLVideoElement | HTMLImageElement | null => {
        const params = drawParamsRef.current;
        if (params.customBgElement) {
            if (params.customBgElement instanceof HTMLVideoElement) {
                return params.customBgElement.readyState >= 2 ? params.customBgElement : null;
            }
            return params.customBgElement;
        }
        if (!params.showOriginalBackground) return null;
        if (params.applyGradingToOriginal && params.pixelData) {
            // Processed pixelData as background (color grading applied), cached per frame
            if (gradedBgRef.current?.source !== params.pixelData) {
                const canvas = gradedBgRef.current?.canvas ?? document.createElement('canvas');
                canvas.width = params.pixelData.width;
                canvas.height = params.pixelData.height;
                canvas.getContext('2d')!.putImageData(
                    new ImageData(params.pixelData.pixels, params.pixelData.width, params.pixelData.height),
                    0,
                    0
                );
                gradedBgRef.current = { source: params.pixelData, canvas };
            }
            return gradedBgRef.current.canvas;
        }
        if (params.videoElement && params.videoElement.readyState >= 2) return params.videoElement;
        return backgroundImageRef.current;
    };

    const getLayout = (): DotLayout | null => {
        const params = drawParamsRef.current;
        if (!params.pixelData || !params.showDots) return null;
        layoutRef.current = computeDotLayout(params.pixelData, params, layoutRef.current);
        return layoutRef.current;
    };

    const renderGL = () => {
        const params = drawParamsRef.current;
        const canvas = glCanvasRef.current;
        if (!canvas) return;
        if (!glRendererRef.current) {
            try {
                glRendererRef.current = new DotsGLRenderer(canvas);
            } catch (error) {
                console.error('GPU renderer unavailable:', error);
                return;
            }
        }
        const width = params.pixelData ? params.targetWidth : 0;
        const height = params.pixelData ? params.targetHeight : 0;
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        glRendererRef.current.render({
            width,
            height,
            dpr: window.devicePixelRatio || 1,
            background: params.pixelData ? getBackgroundSource() : null,
            layout: getLayout(),
            shape: getShapeName(params.shape),
        });
    };

    const requestRender = () => {
        if (drawParamsRef.current.renderer === 'gpu') {
            renderGL();
        } else if (p5Ref.current) {
            p5Ref.current.redraw();
        }
    };

    // Release the GL context when switching back to p5 or unmounting
    React.useEffect(() => {
        if (renderer !== 'gpu') return;
        return () => {
            glRendererRef.current?.dispose();
            glRendererRef.current = null;
        };
    }, [renderer]);

    // Force redraw when any visual setting changes
    React.useEffect(() => {
        if (pixelData || renderer === 'gpu') {
            requestRender();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pixelData, zoom, resolution, dotSpacing, minDotSize, maxDotSize, shape, forceOGColors, removeWhite, whitePoint, showOriginalBackground, applyGradingToOriginal, showDots, customBgElement, renderer]);

    // Continuous redraw loop for custom video backgrounds
    React.useEffect(() => {
        if (!customBgElement || !(customBgElement instanceof HTMLVideoElement)) return;
        let rafId: number;
        const loop = () => {
            requestRender();
            rafId = requestAnimationFrame(loop);
        };
        rafId = requestAnimationFrame(loop);
        return () => cancelAnimationFrame(rafId);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [customBgElement, renderer]);

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
        // Resize first: resizeCanvas clears to transparent
        if (params.pixelData && (p5.width !== params.targetWidth || p5.height !== params.targetHeight)) {
            p5.resizeCanvas(params.targetWidth, params.targetHeight);
        }
        p5.background(255);
        p5.noStroke();

        if (!params.pixelData) {
            return;
        }

        const background = getBackgroundSource();
        if (background) {
            const ctx = p5.drawingContext as CanvasRenderingContext2D;
            ctx.imageSmoothingEnabled = true;
            ctx.drawImage(background, 0, 0, params.targetWidth, params.targetHeight);
        }

        const layout = getLayout();
        if (!layout) return;

        const shapeName = getShapeName(params.shape);
        const isRing = shapeName === 'ring';
        const { cols, rows, sizes, colors } = layout;
        for (let y = 0; y < rows; y++) {
            for (let x = 0; x < cols; x++) {
                const i = y * cols + x;
                const dotSize = sizes[i];
                if (dotSize === 0) {
                    continue;
                }

                const r = colors[i * 4];
                const g = colors[i * 4 + 1];
                const b = colors[i * 4 + 2];
                if (isRing) {
                    p5.stroke(r, g, b);
                    p5.noFill();
                } else {
                    p5.noStroke();
                    p5.fill(r, g, b);
                }

                drawShape(
                    p5,
                    shapeName,
                    x * layout.dotSpacing + layout.dotSpacing / 2,
                    y * layout.dotSpacing + layout.dotSpacing / 2,
                    dotSize
                );
            }
        }
    };

    return (
        <div className={className}>
            {renderer === 'gpu' ? (
                <canvas ref={glCanvasRef} style={{ display: 'block' }} />
            ) : (
                <Sketch setup={setup} draw={draw} />
            )}
        </div>
    );
};


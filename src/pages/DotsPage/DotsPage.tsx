import '../../shared/styles/menu.css';
import '../../index.css';
import React from 'react';
import { debounce } from 'lodash';
import { DotsMenu, DotShape } from './components/DotsMenu';
import { DotsCanvas } from './components/DotsCanvas';
import { processImageForDots, ProcessedPixelData, resizeImage } from './dots-utils';
import { SpecsState } from '../../shared/types';
import { PRESETS, DotsPreset } from './presets';

const DotsPage: React.FC = () => {
    // Keyboard shortcuts
    React.useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
            if (e.key === 'r' || e.key === 'R') {
                const video = videoElementRef.current;
                if (video) {
                    video.currentTime = 0;
                    video.play().catch(console.warn);
                }
            }
            if (e.key === 'd' || e.key === 'D') {
                const state = stateRef.current;
                const dump: Omit<DotsPreset, 'name'> = {
                    resolution: state.specs.resolution,
                    zoom: state.specs.zoom,
                    contrast: state.contrast,
                    brightness: state.brightness,
                    gamma: state.gamma,
                    isColorInverted: state.isColorInverted,
                    useColors: state.useColors,
                    minDotSize: state.minDotSize,
                    maxDotSize: state.maxDotSize,
                    shape: state.shape,
                    forceOGColors: state.forceOGColors,
                    removeWhite: state.removeWhite,
                    whitePoint: state.whitePoint,
                    frameRate: state.frameRate,
                    showOriginalBackground: state.showOriginalBackground,
                };
                console.log('Preset dump:\n' + JSON.stringify(dump, null, 4));
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    // Core state — initialized from first preset
    const [specs, setSpecs] = React.useState<SpecsState>({
        fontSize: 30,
        resolution: PRESETS[0].resolution,
        width: 700,
        zoom: PRESETS[0].zoom,
        weight: 400,
        fontFamily: 'Ibm Plex Mono',
        kerning: 0,
        lineHeight: 1,
    });

    // File state
    const [currentFile, setCurrentFile] = React.useState<File | null>(null);
    const [, setVideoFile] = React.useState<File | null>(null);
    const [videoElement, setVideoElement] = React.useState<HTMLVideoElement | null>(null);
    const videoElementRef = React.useRef<HTMLVideoElement | null>(null);
    React.useEffect(() => { videoElementRef.current = videoElement; }, [videoElement]);
    const [isStreamingVideo, setIsStreamingVideo] = React.useState(false);

    // Processed data
    const [pixelData, setPixelData] = React.useState<ProcessedPixelData | null>(null);

    // Visual settings — initialized from first preset
    const [isColorInverted, setIsColorInverted] = React.useState(PRESETS[0].isColorInverted);
    const [useColors, setUseColors] = React.useState(PRESETS[0].useColors);
    const [contrast, setContrast] = React.useState(PRESETS[0].contrast);
    const [brightness, setBrightness] = React.useState(PRESETS[0].brightness);
    const [gamma, setGamma] = React.useState(PRESETS[0].gamma);

    // Dot size settings
    const [minDotSize, setMinDotSize] = React.useState(PRESETS[0].minDotSize);
    const [maxDotSize, setMaxDotSize] = React.useState(PRESETS[0].maxDotSize);

    // Dot shape
    const [shape, setShape] = React.useState<DotShape>(PRESETS[0].shape);

    // Force original colors
    const [forceOGColors, setForceOGColors] = React.useState(PRESETS[0].forceOGColors);

    // Remove white pixels above threshold
    const [removeWhite, setRemoveWhite] = React.useState(PRESETS[0].removeWhite);
    const [whitePoint, setWhitePoint] = React.useState(PRESETS[0].whitePoint);

    // Video framerate
    const [frameRate, setFrameRate] = React.useState(PRESETS[0].frameRate);

    // Show original image/video as background
    const [showOriginalBackground, setShowOriginalBackground] = React.useState(PRESETS[0].showOriginalBackground);

    // Active preset name
    const [activePreset, setActivePreset] = React.useState(PRESETS[0].name);

    // Ref for current state (used by 'd' key dump)
    const stateRef = React.useRef({ specs, contrast, brightness, gamma, isColorInverted, useColors, minDotSize, maxDotSize, shape, forceOGColors, removeWhite, whitePoint, frameRate, showOriginalBackground });
    stateRef.current = { specs, contrast, brightness, gamma, isColorInverted, useColors, minDotSize, maxDotSize, shape, forceOGColors, removeWhite, whitePoint, frameRate, showOriginalBackground };

    // Log current settings for debugging
    React.useEffect(() => {
        console.log('Current DotsPage Settings:', {
            resolution: specs.resolution,
            zoom: specs.zoom,
            contrast,
            brightness,
            gamma,
            isColorInverted,
            useColors,
            minDotSize,
            maxDotSize,
            shape,
            forceOGColors,
            removeWhite,
            whitePoint,
            frameRate,
            showOriginalBackground,
        });
    }, [specs.resolution, specs.zoom, contrast, brightness, gamma, isColorInverted, useColors, minDotSize, maxDotSize, shape, forceOGColors, removeWhite, whitePoint, frameRate, showOriginalBackground]);

    // Process image with current settings
    const processImage = React.useCallback(async (
        file: File,
        resolution: number,
        contrastVal: number,
        brightnessVal: number,
        gammaVal: number,
        inverted: boolean,
        colors: boolean
    ) => {
        try {
            // Use aspectRatioMultiplier of 1.0 for dots (circles are 1:1, unlike ASCII chars)
            const canvas = await resizeImage({ file, maxWidth: resolution, aspectRatioMultiplier: 1.0 });
            const context = canvas.getContext('2d', { willReadFrequently: true });
            if (!context) return;

            const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
            const processed = processImageForDots(imageData, contrastVal, brightnessVal, gammaVal, inverted, colors);
            setPixelData(processed);
        } catch (error) {
            console.error('Error processing image:', error);
        }
    }, []);

    // Apply a preset
    const applyPreset = React.useCallback((preset: DotsPreset) => {
        setActivePreset(preset.name);
        setSpecs(prev => ({ ...prev, resolution: preset.resolution, zoom: preset.zoom }));
        setContrast(preset.contrast);
        setBrightness(preset.brightness);
        setGamma(preset.gamma);
        setIsColorInverted(preset.isColorInverted);
        setUseColors(preset.useColors);
        setMinDotSize(preset.minDotSize);
        setMaxDotSize(preset.maxDotSize);
        setShape(preset.shape);
        setForceOGColors(preset.forceOGColors);
        setRemoveWhite(preset.removeWhite);
        setWhitePoint(preset.whitePoint);
        setFrameRate(preset.frameRate);
        setShowOriginalBackground(preset.showOriginalBackground);
        if (currentFile) {
            processImage(currentFile, preset.resolution, preset.contrast, preset.brightness, preset.gamma, preset.isColorInverted, preset.useColors);
        }
    }, [currentFile, processImage]);

    // Handle image upload
    const handleImageUpload = React.useCallback((file: File) => {
        setCurrentFile(file);
        setVideoFile(null);
        setIsStreamingVideo(false);
        processImage(file, specs.resolution, contrast, brightness, gamma, isColorInverted, useColors);
    }, [specs.resolution, contrast, brightness, gamma, isColorInverted, useColors, processImage]);

    // Handle video upload
    const handleVideoUpload = React.useCallback((file: File) => {
        setVideoFile(file);
        setCurrentFile(null);
        setIsStreamingVideo(true);
        setPixelData(null);

        // Create video element for streaming
        const video = document.createElement('video');
        video.muted = true;
        video.playsInline = true;
        video.loop = true;
        video.src = URL.createObjectURL(file);

        video.addEventListener('loadedmetadata', () => {
            setVideoElement(video);
            video.play().catch(console.warn);
        });
    }, []);

    // Video frame processing
    const animationFrameRef = React.useRef<number | null>(null);
    const lastFrameTimeRef = React.useRef<number>(0);
    const canvasRef = React.useRef<HTMLCanvasElement | null>(null);

    React.useEffect(() => {
        if (!isStreamingVideo || !videoElement) return;

        // Create hidden canvas for frame extraction
        if (!canvasRef.current) {
            canvasRef.current = document.createElement('canvas');
        }
        const canvas = canvasRef.current;

        const processVideoFrame = () => {
            if (!videoElement || videoElement.readyState < 2) {
                animationFrameRef.current = requestAnimationFrame(processVideoFrame);
                return;
            }

            const now = performance.now();
            const targetFrameTime = 1000 / frameRate;

            if (now - lastFrameTimeRef.current >= targetFrameTime) {
                const aspectRatio = videoElement.videoWidth / videoElement.videoHeight;
                const width = specs.resolution;
                // Use true aspect ratio for dots (no 0.6 multiplier - that's for ASCII chars)
                const height = Math.floor(width / aspectRatio);

                canvas.width = width;
                canvas.height = height;
                const context = canvas.getContext('2d', { willReadFrequently: true });
                
                if (context) {
                    context.drawImage(videoElement, 0, 0, width, height);
                    const imageData = context.getImageData(0, 0, width, height);
                    const processed = processImageForDots(imageData, contrast, brightness, gamma, isColorInverted, useColors);
                    setPixelData(processed);
                }

                lastFrameTimeRef.current = now;
            }

            animationFrameRef.current = requestAnimationFrame(processVideoFrame);
        };

        animationFrameRef.current = requestAnimationFrame(processVideoFrame);

        return () => {
            if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current);
            }
        };
    }, [isStreamingVideo, videoElement, specs.resolution, contrast, brightness, gamma, isColorInverted, useColors, frameRate]);

    // Cleanup video element on unmount
    React.useEffect(() => {
        return () => {
            if (videoElement) {
                videoElement.pause();
                URL.revokeObjectURL(videoElement.src);
            }
        };
    }, [videoElement]);

    // Debounced handlers for expensive operations
    const debouncedProcessImage = React.useMemo(
        () => debounce((file: File, resolution: number, contrastVal: number, brightnessVal: number, gammaVal: number, inverted: boolean, colors: boolean) => {
            processImage(file, resolution, contrastVal, brightnessVal, gammaVal, inverted, colors);
        }, 50),
        [processImage]
    );

    const handleResolutionChange = React.useCallback((resolution: number) => {
        setSpecs(prev => ({ ...prev, resolution }));
        if (currentFile) {
            debouncedProcessImage(currentFile, resolution, contrast, brightness, gamma, isColorInverted, useColors);
        }
    }, [currentFile, contrast, brightness, gamma, isColorInverted, useColors, debouncedProcessImage]);

    const handleContrastChange = React.useCallback((newContrast: number) => {
        setContrast(newContrast);
        if (currentFile) {
            debouncedProcessImage(currentFile, specs.resolution, newContrast, brightness, gamma, isColorInverted, useColors);
        }
    }, [currentFile, specs.resolution, brightness, gamma, isColorInverted, useColors, debouncedProcessImage]);

    const handleBrightnessChange = React.useCallback((newBrightness: number) => {
        setBrightness(newBrightness);
        if (currentFile) {
            debouncedProcessImage(currentFile, specs.resolution, contrast, newBrightness, gamma, isColorInverted, useColors);
        }
    }, [currentFile, specs.resolution, contrast, gamma, isColorInverted, useColors, debouncedProcessImage]);

    const handleGammaChange = React.useCallback((newGamma: number) => {
        setGamma(newGamma);
        if (currentFile) {
            debouncedProcessImage(currentFile, specs.resolution, contrast, brightness, newGamma, isColorInverted, useColors);
        }
    }, [currentFile, specs.resolution, contrast, brightness, isColorInverted, useColors, debouncedProcessImage]);

    const handleColorInvertedToggle = React.useCallback(() => {
        const newValue = !isColorInverted;
        setIsColorInverted(newValue);
        if (currentFile) {
            processImage(currentFile, specs.resolution, contrast, brightness, gamma, newValue, useColors);
        }
    }, [currentFile, specs.resolution, contrast, brightness, gamma, isColorInverted, useColors, processImage]);

    const handleUseColorsToggle = React.useCallback(() => {
        const newValue = !useColors;
        setUseColors(newValue);
        if (currentFile) {
            processImage(currentFile, specs.resolution, contrast, brightness, gamma, isColorInverted, newValue);
        }
    }, [currentFile, specs.resolution, contrast, brightness, gamma, isColorInverted, useColors, processImage]);


    return (
        <div className="flex-container">
            <DotsMenu
                specs={specs}
                onSpecsChange={setSpecs}
                onVideoUpload={handleVideoUpload}
                onImageUpload={handleImageUpload}
                isColorInverted={isColorInverted}
                onColorInvertedToggle={handleColorInvertedToggle}
                contrast={contrast}
                onContrastChange={handleContrastChange}
                brightness={brightness}
                onBrightnessChange={handleBrightnessChange}
                gamma={gamma}
                onGammaChange={handleGammaChange}
                useColors={useColors}
                onUseColorsToggle={handleUseColorsToggle}
                onResolutionChange={handleResolutionChange}
                minDotSize={minDotSize}
                onMinDotSizeChange={setMinDotSize}
                maxDotSize={maxDotSize}
                onMaxDotSizeChange={setMaxDotSize}
                shape={shape}
                onShapeChange={setShape}
                forceOGColors={forceOGColors}
                onForceOGColorsToggle={() => setForceOGColors(v => !v)}
                removeWhite={removeWhite}
                onRemoveWhiteToggle={() => setRemoveWhite(v => !v)}
                whitePoint={whitePoint}
                onWhitePointChange={setWhitePoint}
                frameRate={frameRate}
                onFrameRateChange={setFrameRate}
                showOriginalBackground={showOriginalBackground}
                onShowOriginalBackgroundToggle={() => setShowOriginalBackground(v => !v)}
                presets={PRESETS}
                activePreset={activePreset}
                onPresetChange={applyPreset}
            />

            <DotsCanvas
                pixelData={pixelData}
                zoom={specs.zoom}
                resolution={specs.resolution}
                minDotSize={minDotSize}
                maxDotSize={maxDotSize}
                shape={shape}
                forceOGColors={forceOGColors}
                removeWhite={removeWhite}
                whitePoint={whitePoint}
                showOriginalBackground={showOriginalBackground}
                sourceFile={currentFile}
                videoElement={isStreamingVideo ? videoElement : null}
                className="dots-canvas"
            />
        </div>
    );
};

export default DotsPage;


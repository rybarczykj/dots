import '../../shared/styles/menu.css';
import '../../index.css';
import React from 'react';
import { throttle } from 'lodash';
import { DotsMenu, DotShape } from './components/DotsMenu';
import { DotsCanvas, DotsRenderer } from './components/DotsCanvas';
import { ExportPanel } from './components/ExportPanel';
import { ExportInput } from './export';
import { getDisplaySize } from './dot-layout';
import { grabVideoFrame, processImageForDots, ProcessedPixelData } from './dots-utils';
import { loadImageFile, resizeLoadedImage } from '../../shared/utils';
import { SpecsState } from '../../shared/types';
import { PRESETS, DotsPreset } from './presets';

const DotsPage: React.FC = () => {
    // Webcam stream ref for cleanup
    const webcamStreamRef = React.useRef<MediaStream | null>(null);

    // Keyboard shortcuts
    React.useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
            if (e.key === 'r' || e.key === 'R') {
                restartVideo();
            }
            if (e.key === 'w' || e.key === 'W') {
                toggleWebcam();
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
    const [videoFile, setVideoFile] = React.useState<File | null>(null);
    const [videoElement, setVideoElement] = React.useState<HTMLVideoElement | null>(null);
    const videoElementRef = React.useRef<HTMLVideoElement | null>(null);
    React.useEffect(() => { videoElementRef.current = videoElement; }, [videoElement]);
    const restartVideo = React.useCallback(() => {
        const video = videoElementRef.current;
        if (video) {
            video.currentTime = 0;
            video.play().catch(console.warn);
        }
    }, []);
    const [isStreamingVideo, setIsStreamingVideo] = React.useState(false);

    // Processed data
    const [pixelData, setPixelData] = React.useState<ProcessedPixelData | null>(null);

    // Stable source aspect ratio (width/height) — set once per source, not affected by resolution
    const [sourceAspectRatio, setSourceAspectRatio] = React.useState<number | null>(null);

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

    // Apply color grading to the original background
    const [applyGradingToOriginal, setApplyGradingToOriginal] = React.useState(false);

    // Show dots overlay
    const [showDots, setShowDots] = React.useState(true);

    // Rendering backend (opt-in GPU); falls back to p5 if WebGL2 isn't available
    const [renderer, setRenderer] = React.useState<DotsRenderer>('p5');
    const [gpuUnavailable, setGPUUnavailable] = React.useState(false);
    const handleGPUUnavailable = React.useCallback(() => {
        setGPUUnavailable(true);
        setRenderer('p5');
    }, []);

    // Live preview pauses while exporting so export gets the full machine
    const [isExporting, setIsExporting] = React.useState(false);

    // Custom background (replaces "show original")
    const [customBgElement, setCustomBgElement] = React.useState<HTMLVideoElement | HTMLImageElement | null>(null);
    const hasCustomBg = customBgElement !== null;

    const handleCustomBgUpload = React.useCallback((file: File) => {
        // Clean up previous custom bg
        if (customBgElement) {
            if (customBgElement instanceof HTMLVideoElement) {
                customBgElement.pause();
                if (customBgElement.src) URL.revokeObjectURL(customBgElement.src);
            }
        }

        const isVideo = file.type.startsWith('video/') || /\.(mp4|mov|webm|avi|mkv)$/i.test(file.name);
        if (isVideo) {
            const video = document.createElement('video');
            video.muted = true;
            video.playsInline = true;
            video.loop = true;
            video.src = URL.createObjectURL(file);
            video.addEventListener('loadedmetadata', () => {
                setCustomBgElement(video);
                setShowOriginalBackground(false);
                video.play().catch(console.warn);
            });
        } else {
            const img = new Image();
            img.onload = () => {
                setCustomBgElement(img);
                setShowOriginalBackground(false);
            };
            img.src = URL.createObjectURL(file);
        }
    }, [customBgElement]);

    const clearCustomBg = React.useCallback(() => {
        if (customBgElement) {
            if (customBgElement instanceof HTMLVideoElement) {
                customBgElement.pause();
                if (customBgElement.src) URL.revokeObjectURL(customBgElement.src);
            }
        }
        setCustomBgElement(null);
    }, [customBgElement]);

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

    // Decoded image and its resized pixels, cached so slider changes don't re-decode the file
    const decodedImageRef = React.useRef<{ file: File; image: Promise<HTMLImageElement> } | null>(null);
    const resizedImageRef = React.useRef<{ file: File; resolution: number; imageData: ImageData } | null>(null);
    const processRequestRef = React.useRef(0);

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
        const request = ++processRequestRef.current;
        try {
            if (decodedImageRef.current?.file !== file) {
                decodedImageRef.current = { file, image: loadImageFile(file) };
            }
            let resized = resizedImageRef.current;
            if (resized?.file !== file || resized.resolution !== resolution) {
                const image = await decodedImageRef.current.image;
                // Use aspectRatioMultiplier of 1.0 for dots (circles are 1:1, unlike ASCII chars)
                const canvas = resizeLoadedImage(image, resolution, 1.0);
                const context = canvas.getContext('2d', { willReadFrequently: true });
                if (!context) return;
                resized = { file, resolution, imageData: context.getImageData(0, 0, canvas.width, canvas.height) };
                resizedImageRef.current = resized;
            }
            // A newer slider change already started; drop this stale result
            if (request !== processRequestRef.current) return;

            const processed = processImageForDots(resized.imageData, contrastVal, brightnessVal, gammaVal, inverted, colors);
            setPixelData(processed);
        } catch (error) {
            if (decodedImageRef.current?.file === file) decodedImageRef.current = null;
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
        // Read the original image to capture its true aspect ratio (before any resizing)
        const img = new Image();
        img.onload = () => {
            setSourceAspectRatio(img.width / img.height);
            URL.revokeObjectURL(img.src);
        };
        img.src = URL.createObjectURL(file);
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
            setSourceAspectRatio(video.videoWidth / video.videoHeight);
            setVideoElement(video);
            video.play().catch(console.warn);
        });
    }, []);

    // Webcam video ref (rendered in JSX)
    const webcamVideoRef = React.useRef<HTMLVideoElement>(null);

    // Toggle webcam
    const toggleWebcam = React.useCallback(async () => {
        // If webcam is active, stop it
        if (webcamStreamRef.current) {
            webcamStreamRef.current.getTracks().forEach(track => track.stop());
            webcamStreamRef.current = null;
            if (webcamVideoRef.current) {
                webcamVideoRef.current.pause();
                webcamVideoRef.current.srcObject = null;
            }
            setVideoElement(null);
            setIsStreamingVideo(false);
            setPixelData(null);
            return;
        }

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
            webcamStreamRef.current = stream;

            setCurrentFile(null);
            setVideoFile(null);
            setIsStreamingVideo(true);
            setPixelData(null);

            const video = webcamVideoRef.current!;
            video.srcObject = stream;

            video.play().then(() => {
                setSourceAspectRatio(video.videoWidth / video.videoHeight);
                setVideoElement(video);
            }).catch(console.warn);
        } catch (err) {
            console.error('Webcam access denied:', err);
        }
    }, []);

    // Video frame processing
    const animationFrameRef = React.useRef<number | null>(null);
    const lastFrameTimeRef = React.useRef<number>(0);
    const canvasRef = React.useRef<HTMLCanvasElement | null>(null);

    React.useEffect(() => {
        if (!isStreamingVideo || !videoElement || isExporting) return;

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
                const imageData = grabVideoFrame(videoElement, specs.resolution, canvas);
                if (imageData) {
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
    }, [isStreamingVideo, videoElement, specs.resolution, contrast, brightness, gamma, isColorInverted, useColors, frameRate, isExporting]);

    // Pause live videos during export, then resume the ones that were playing and are
    // still in use (a background cleared mid-export stays stopped)
    const customBgElementRef = React.useRef(customBgElement);
    customBgElementRef.current = customBgElement;
    React.useEffect(() => {
        if (!isExporting) return;
        const videos = [videoElementRef.current, customBgElementRef.current].filter(
            (v): v is HTMLVideoElement => v instanceof HTMLVideoElement && !v.paused
        );
        videos.forEach((v) => v.pause());
        return () =>
            videos
                .filter((v) => v === videoElementRef.current || v === customBgElementRef.current)
                .forEach((v) => v.play().catch(console.warn));
    }, [isExporting]);

    // Cleanup video element on unmount
    React.useEffect(() => {
        return () => {
            if (videoElement) {
                videoElement.pause();
                if (videoElement.src) URL.revokeObjectURL(videoElement.src);
            }
            if (webcamStreamRef.current) {
                webcamStreamRef.current.getTracks().forEach(track => track.stop());
                webcamStreamRef.current = null;
            }
        };
    }, [videoElement]);

    // Throttled so the preview updates while a slider is dragged (debounce waited for it to stop)
    const throttledProcessImage = React.useMemo(
        () => throttle((file: File, resolution: number, contrastVal: number, brightnessVal: number, gammaVal: number, inverted: boolean, colors: boolean) => {
            processImage(file, resolution, contrastVal, brightnessVal, gammaVal, inverted, colors);
        }, 50),
        [processImage]
    );

    const handleResolutionChange = React.useCallback((resolution: number) => {
        setSpecs(prev => ({ ...prev, resolution }));
        if (currentFile) {
            throttledProcessImage(currentFile, resolution, contrast, brightness, gamma, isColorInverted, useColors);
        }
    }, [currentFile, contrast, brightness, gamma, isColorInverted, useColors, throttledProcessImage]);

    const handleContrastChange = React.useCallback((newContrast: number) => {
        setContrast(newContrast);
        if (currentFile) {
            throttledProcessImage(currentFile, specs.resolution, newContrast, brightness, gamma, isColorInverted, useColors);
        }
    }, [currentFile, specs.resolution, brightness, gamma, isColorInverted, useColors, throttledProcessImage]);

    const handleBrightnessChange = React.useCallback((newBrightness: number) => {
        setBrightness(newBrightness);
        if (currentFile) {
            throttledProcessImage(currentFile, specs.resolution, contrast, newBrightness, gamma, isColorInverted, useColors);
        }
    }, [currentFile, specs.resolution, contrast, gamma, isColorInverted, useColors, throttledProcessImage]);

    const handleGammaChange = React.useCallback((newGamma: number) => {
        setGamma(newGamma);
        if (currentFile) {
            throttledProcessImage(currentFile, specs.resolution, contrast, brightness, newGamma, isColorInverted, useColors);
        }
    }, [currentFile, specs.resolution, contrast, brightness, isColorInverted, useColors, throttledProcessImage]);

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


    // Snapshot of current settings for export (read when export starts, so it matches the screen)
    const getExportInput = (): ExportInput | null => {
        if (!pixelData) return null;
        const display = getDisplaySize(specs.zoom, sourceAspectRatio);
        const settings = {
            resolution: specs.resolution,
            contrast,
            brightness,
            gamma,
            isColorInverted,
            useColors,
            layout: { minDotSize, maxDotSize, forceOGColors, removeWhite, whitePoint },
            shape,
            showDots,
            showOriginalBackground,
            applyGradingToOriginal,
            frameRate,
            displayWidth: display.width,
            displayHeight: display.height,
        };
        if (currentFile) {
            return { settings, source: { kind: 'image', file: currentFile, pixelData }, customBg: customBgElement };
        }
        if (videoElement && videoFile && !webcamStreamRef.current) {
            return { settings, source: { kind: 'video', url: videoElement.src }, customBg: customBgElement };
        }
        return null;
    };

    return (
        <div className="flex-container">
            <ExportPanel
                getExportInput={getExportInput}
                disabledReason={webcamStreamRef.current ? 'webcam can\'t be exported. upload a video instead' : null}
                sourceName={currentFile?.name ?? videoFile?.name ?? 'dots'}
                onExportingChange={setIsExporting}
            />
            {process.env.REACT_APP_COMMIT && (
                <div className="build-stamp">{process.env.REACT_APP_COMMIT}</div>
            )}
            {/* Hidden video element for webcam capture */}
            <video
                ref={webcamVideoRef}
                muted
                playsInline
                style={{ position: 'fixed', left: 0, top: 0, width: 640, height: 480, opacity: 0.001, pointerEvents: 'none', zIndex: -1 }}
            />
            <DotsMenu
                specs={specs}
                onSpecsChange={setSpecs}
                onVideoUpload={handleVideoUpload}
                onImageUpload={handleImageUpload}
                isVideo={isStreamingVideo}
                pixelData={pixelData}
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
                showDots={showDots}
                onShowDotsToggle={() => setShowDots(v => !v)}
                onRestartVideo={restartVideo}
                useGPU={renderer === 'gpu'}
                onUseGPUToggle={() => setRenderer(r => (r === 'gpu' ? 'p5' : 'gpu'))}
                gpuUnavailable={gpuUnavailable}
                applyGradingToOriginal={applyGradingToOriginal}
                onApplyGradingToOriginalToggle={() => setApplyGradingToOriginal(v => !v)}
                hasCustomBg={hasCustomBg}
                onCustomBgUpload={handleCustomBgUpload}
                onCustomBgClear={clearCustomBg}
                presets={PRESETS}
                activePreset={activePreset}
                onPresetChange={applyPreset}
            />

            <DotsCanvas
                pixelData={pixelData}
                zoom={specs.zoom}
                resolution={specs.resolution}
                sourceAspectRatio={sourceAspectRatio}
                minDotSize={minDotSize}
                maxDotSize={maxDotSize}
                shape={shape}
                forceOGColors={forceOGColors}
                removeWhite={removeWhite}
                whitePoint={whitePoint}
                showOriginalBackground={showOriginalBackground}
                applyGradingToOriginal={applyGradingToOriginal}
                showDots={showDots}
                customBgElement={customBgElement}
                sourceFile={currentFile}
                videoElement={isStreamingVideo ? videoElement : null}
                renderer={renderer}
                paused={isExporting}
                onGPUUnavailable={handleGPUUnavailable}
                className="dots-canvas"
            />
        </div>
    );
};

export default DotsPage;


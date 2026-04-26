import { ReactElement } from 'react';
import { DragDropFiles, Slider, Dropdown } from '../../../shared/components';
import { SpecsState } from '../../../shared/types';
import { ProcessedPixelData } from '../dots-utils';
import { DotsPreset } from '../presets';
import heic2any from 'heic2any';
import React from 'react';
import '../../../shared/styles/menu.css';

export type DotShape = '● circle' | '■ square' | '◆ diamond' | '▲ triangle' | '✚ cross' | '○ ring';

export const DOT_SHAPES: { value: DotShape; label: DotShape }[] = [
    { value: '● circle', label: '● circle' },
    { value: '■ square', label: '■ square' },
    { value: '◆ diamond', label: '◆ diamond' },
    { value: '▲ triangle', label: '▲ triangle' },
    { value: '✚ cross', label: '✚ cross' },
    { value: '○ ring', label: '○ ring' },
];

interface DotsMenuProps {
    specs: SpecsState;
    onSpecsChange: (specs: SpecsState) => void;
    onVideoUpload: (file: File) => void;
    onImageUpload: (file: File) => void;
    isVideo: boolean;
    pixelData: ProcessedPixelData | null;
    isColorInverted: boolean;
    onColorInvertedToggle: () => void;
    contrast: number;
    onContrastChange: (contrast: number) => void;
    brightness: number;
    onBrightnessChange: (brightness: number) => void;
    gamma: number;
    onGammaChange: (gamma: number) => void;
    useColors: boolean;
    onUseColorsToggle: () => void;
    onResolutionChange: (resolution: number) => void;
    minDotSize: number;
    onMinDotSizeChange: (size: number) => void;
    maxDotSize: number;
    onMaxDotSizeChange: (size: number) => void;
    shape: DotShape;
    onShapeChange: (shape: DotShape) => void;
    forceOGColors: boolean;
    onForceOGColorsToggle: () => void;
    removeWhite: boolean;
    onRemoveWhiteToggle: () => void;
    whitePoint: number;
    onWhitePointChange: (value: number) => void;
    frameRate: number;
    onFrameRateChange: (value: number) => void;
    showOriginalBackground: boolean;
    onShowOriginalBackgroundToggle: () => void;
    showDots: boolean;
    onShowDotsToggle: () => void;
    applyGradingToOriginal: boolean;
    onApplyGradingToOriginalToggle: () => void;
    hasCustomBg: boolean;
    onCustomBgUpload: (file: File) => void;
    onCustomBgClear: () => void;
    presets: DotsPreset[];
    activePreset: string;
    onPresetChange: (preset: DotsPreset) => void;
}

export const DotsMenu = ({
    specs,
    onSpecsChange,
    onImageUpload,
    onVideoUpload,
    isVideo,
    pixelData,
    onResolutionChange,
    isColorInverted,
    onColorInvertedToggle,
    contrast,
    onContrastChange,
    brightness,
    onBrightnessChange,
    gamma,
    onGammaChange,
    useColors,
    onUseColorsToggle,
    minDotSize,
    onMinDotSizeChange,
    maxDotSize,
    onMaxDotSizeChange,
    shape,
    onShapeChange,
    forceOGColors,
    onForceOGColorsToggle,
    removeWhite,
    onRemoveWhiteToggle,
    whitePoint,
    onWhitePointChange,
    frameRate,
    onFrameRateChange,
    showOriginalBackground,
    onShowOriginalBackgroundToggle,
    showDots,
    onShowDotsToggle,
    applyGradingToOriginal,
    onApplyGradingToOriginalToggle,
    hasCustomBg,
    onCustomBgUpload,
    onCustomBgClear,
    presets,
    activePreset,
    onPresetChange,
}: DotsMenuProps): ReactElement => {
    const [isColorGradingOpen, setIsColorGradingOpen] = React.useState(false);
    const [isDotsOpen, setIsDotsOpen] = React.useState(false);
    const [isBackgroundOpen, setIsBackgroundOpen] = React.useState(false);
    const previewCanvasRef = React.useRef<HTMLCanvasElement>(null);

    // Draw color-graded preview directly from processed pixelData
    React.useEffect(() => {
        const canvas = previewCanvasRef.current;
        if (!canvas || !pixelData || !isColorGradingOpen) return;
        canvas.width = pixelData.width;
        canvas.height = pixelData.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const imageData = ctx.createImageData(pixelData.width, pixelData.height);
        for (let y = 0; y < pixelData.height; y++) {
            for (let x = 0; x < pixelData.width; x++) {
                const px = pixelData.pixels[y][x];
                const i = (y * pixelData.width + x) * 4;
                imageData.data[i] = px.r;
                imageData.data[i + 1] = px.g;
                imageData.data[i + 2] = px.b;
                imageData.data[i + 3] = 255;
            }
        }
        ctx.putImageData(imageData, 0, 0);
    }, [pixelData, isColorGradingOpen]);
    const imageUploadHandler = (imageFile: File) => {
        if (imageFile.type === 'image/heic') {
            try {
                heic2any({
                    blob: imageFile,
                    toType: 'image/jpeg',
                }).then((convertedBlob) => {
                    const convertedFile = new File(
                        [convertedBlob as Blob],
                        imageFile.name.replace('.heic', '.jpg'),
                        { type: 'image/jpeg' },
                    );
                    onImageUpload(convertedFile);
                });
            } catch (error) {
                console.error('Error converting HEIC image:', error);
            }
        } else {
            onImageUpload(imageFile);
        }
    };

    const dropHandler = (file: File) => {
        const isVideo = file.type.startsWith('video/') || /\.(mp4|mov|webm|avi|mkv)$/i.test(file.name);
        if (isVideo) {
            onVideoUpload(file);
        } else {
            imageUploadHandler(file);
        }
    };

    return (
        <DragDropFiles onDrop={dropHandler}>
            <div className="flex-row">
                <div className="menu">
                    <div className="control-section">
                        <label className="control-label">upload</label>
                        <div className="control-small-buttons">
                            <label htmlFor="file-upload" className="control-button">
                                image
                            </label>
                            <label htmlFor="video-upload" className="control-button">
                                or video
                            </label>
                        </div>
                        <input
                            id="file-upload"
                            type="file"
                            accept="image/*, .heic"
                            className="file-upload-input"
                            onChange={(event) => {
                                const myFile = event.target.files?.[0];
                                if (!myFile) {
                                    return;
                                }
                                imageUploadHandler(myFile);
                            }}
                        />
                        <input
                            id="video-upload"
                            type="file"
                            accept="video/*"
                            className="file-upload-input"
                            onChange={(event) => {
                                const videoFile = event.target.files?.[0];
                                if (!videoFile) {
                                    return;
                                }
                                onVideoUpload(videoFile);
                            }}
                        />
                    </div>
                    <div className="control-section">
                        <Slider
                            title="resolution"
                            label={specs.resolution.toString()}
                            value={specs.resolution}
                            min={5}
                            max={1000}
                            onChange={onResolutionChange}
                        />
                        <Slider
                            title="zoom"
                            label={specs.zoom.toString().slice(0, 4)}
                            value={specs.zoom}
                            min={0.1}
                            max={10}
                            step={0.1}
                            onChange={(newZoom) => onSpecsChange({ ...specs, zoom: newZoom })}
                        />
                    </div>

                    <div className="control-section">
                        <div
                            className="control-collapse-header"
                            onClick={() => setIsColorGradingOpen(!isColorGradingOpen)}
                        >
                            <span className="control-label">
                                <span>{isColorGradingOpen ? '↓' : '→'}</span>
                                <span>color</span>
                            </span>
                        </div>
                        {isColorGradingOpen && (
                            <div className="control-collapse-content">
                                {pixelData && (
                                    <canvas
                                        ref={previewCanvasRef}
                                        className="color-preview"
                                    />
                                )}
                                <Slider
                                    title="contrast"
                                    label={contrast.toString()}
                                    value={contrast}
                                    min={0.1}
                                    max={50}
                                    step={0.1}
                                    onChange={onContrastChange}
                                />
                                <Slider
                                    title="brightness"
                                    label={brightness.toString()}
                                    value={brightness}
                                    min={-255}
                                    max={255}
                                    step={1}
                                    onChange={onBrightnessChange}
                                />
                                <Slider
                                    title="gamma"
                                    label={gamma.toFixed(1)}
                                    value={gamma}
                                    min={0.4}
                                    max={2.5}
                                    step={0.1}
                                    onChange={onGammaChange}
                                />
                                <div className="checkboxes">
                                    <label>
                                        <input
                                            type="checkbox"
                                            checked={isColorInverted}
                                            onChange={onColorInvertedToggle}
                                        />
                                        {'inverse?'}
                                    </label>
                                    <label>
                                        <input
                                            type="checkbox"
                                            checked={useColors}
                                            onChange={onUseColorsToggle}
                                        />
                                        {'use colors?'}
                                    </label>
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="control-section">
                        <div
                            className="control-collapse-header"
                            onClick={() => setIsDotsOpen(!isDotsOpen)}
                        >
                            <span className="control-label">
                                <span>{isDotsOpen ? '↓' : '→'}</span>
                                <span>dots</span>
                            </span>
                        </div>
                        {isDotsOpen && (
                            <div className="control-collapse-content">
                                <Slider
                                    title="min dot size"
                                    label={minDotSize.toString()}
                                    value={minDotSize}
                                    min={-5}
                                    max={25}
                                    step={0.1}
                                    onChange={onMinDotSizeChange}
                                />
                                <Slider
                                    title="max dot size"
                                    label={maxDotSize.toString()}
                                    value={maxDotSize}
                                    min={0}
                                    max={25}
                                    step={0.1}
                                    onChange={onMaxDotSizeChange}
                                />
                                <Dropdown
                                    label="shape"
                                    options={DOT_SHAPES}
                                    selectedOption={shape}
                                    onOptionChange={onShapeChange}
                                />
                                <div className="checkboxes">
                                    <label>
                                        <input
                                            type="checkbox"
                                            checked={forceOGColors}
                                            onChange={onForceOGColorsToggle}
                                        />
                                        {'force OG colors?'}
                                    </label>
                                    <label>
                                        <input
                                            type="checkbox"
                                            checked={removeWhite}
                                            onChange={onRemoveWhiteToggle}
                                        />
                                        {'remove white?'}
                                    </label>
                                </div>
                                {removeWhite && (
                                    <Slider
                                        title="white point"
                                        label={whitePoint.toString()}
                                        value={whitePoint}
                                        min={0}
                                        max={256}
                                        step={1}
                                        onChange={onWhitePointChange}
                                    />
                                )}
                                {isVideo && (
                                    <Slider
                                        title="framerate (fps)"
                                        label={frameRate.toString()}
                                        value={frameRate}
                                        min={1}
                                        max={60}
                                        step={1}
                                        onChange={onFrameRateChange}
                                    />
                                )}
                            </div>
                        )}
                    </div>

                    <div className="control-section">
                        <div
                            className="control-collapse-header"
                            onClick={() => setIsBackgroundOpen(!isBackgroundOpen)}
                        >
                            <span className="control-label">
                                <span>{isBackgroundOpen ? '↓' : '→'}</span>
                                <span>background</span>
                            </span>
                        </div>
                        {isBackgroundOpen && (
                            <div className="control-collapse-content">
                                <div className="checkboxes">
                                    <label className={hasCustomBg ? 'control-disabled' : ''}>
                                        <input
                                            type="checkbox"
                                            checked={showOriginalBackground && !hasCustomBg}
                                            onChange={onShowOriginalBackgroundToggle}
                                            disabled={hasCustomBg}
                                        />
                                        {'show original?'}
                                    </label>
                                    <label>
                                        <input
                                            type="checkbox"
                                            checked={showDots}
                                            onChange={onShowDotsToggle}
                                        />
                                        {'show dots?'}
                                    </label>
                                    <label>
                                        <input
                                            type="checkbox"
                                            checked={applyGradingToOriginal}
                                            onChange={onApplyGradingToOriginalToggle}
                                        />
                                        {'apply grading to original?'}
                                    </label>
                                </div>
                                <label className="control-label" style={{ marginTop: 10 }}>custom background</label>
                                <div className="control-small-buttons">
                                    <label htmlFor="bg-upload" className="control-button">
                                        image
                                    </label>
                                    <label htmlFor="bg-video-upload" className="control-button">
                                        video
                                    </label>
                                    {hasCustomBg && (
                                        <button className="control-button" onClick={onCustomBgClear}>
                                            clear
                                        </button>
                                    )}
                                </div>
                                <input
                                    id="bg-upload"
                                    type="file"
                                    accept="image/*"
                                    className="file-upload-input"
                                    onChange={(e) => {
                                        const f = e.target.files?.[0];
                                        if (f) onCustomBgUpload(f);
                                    }}
                                />
                                <input
                                    id="bg-video-upload"
                                    type="file"
                                    accept="video/*"
                                    className="file-upload-input"
                                    onChange={(e) => {
                                        const f = e.target.files?.[0];
                                        if (f) onCustomBgUpload(f);
                                    }}
                                />
                            </div>
                        )}
                    </div>

                    <Dropdown
                        label="preset"
                        options={presets.map(p => ({ value: p.name, label: p.name }))}
                        selectedOption={activePreset}
                        onOptionChange={(name) => {
                            const preset = presets.find(p => p.name === name);
                            if (preset) onPresetChange(preset);
                        }}
                    />

                </div>
            </div>
        </DragDropFiles>
    );
};


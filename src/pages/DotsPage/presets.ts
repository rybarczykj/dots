import { DotShape } from './components/DotsMenu';

export interface DotsPreset {
    name: string;
    resolution: number;
    zoom: number;
    contrast: number;
    brightness: number;
    gamma: number;
    isColorInverted: boolean;
    useColors: boolean;
    minDotSize: number;
    maxDotSize: number;
    shape: DotShape;
    forceOGColors: boolean;
    removeWhite: boolean;
    whitePoint: number;
    frameRate: number;
    showOriginalBackground: boolean;
}

export const PRESETS: DotsPreset[] = [
    {
        name: 'delanceyessexsnow',
        resolution: 82,
        zoom: 1,
        contrast: 12.1,
        brightness: 113,
        gamma: 1.2,
        isColorInverted: false,
        useColors: true,
        minDotSize: -5,
        maxDotSize: 0.7,
        shape: '● circle',
        forceOGColors: false,
        removeWhite: true,
        whitePoint: 248,
        frameRate: 10,
        showOriginalBackground: true,
    },
    {
        name: 'default',
        resolution: 100,
        zoom: 1,
        contrast: 1,
        brightness: 0,
        gamma: 1,
        isColorInverted: false,
        useColors: true,
        minDotSize: 0.8,
        maxDotSize: 0.8,
        shape: '● circle',
        forceOGColors: false,
        removeWhite: false,
        whitePoint: 240,
        frameRate: 10,
        showOriginalBackground: false,
    },
    {
        name: 'wall st ferry',
        resolution: 466,
        zoom: 1,
        contrast: 6.9,
        brightness: 88,
        gamma: 1.2,
        isColorInverted: true,
        useColors: false,
        minDotSize: -5,
        maxDotSize: 2,
        shape: '● circle',
        forceOGColors: false,
        removeWhite: false,
        whitePoint: 240,
        frameRate: 10,
        showOriginalBackground: true,
    },
];

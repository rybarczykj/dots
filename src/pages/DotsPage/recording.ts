// A recorded performance: every settings change while recording, timestamped against the
// source's timeline. Export replays it frame by frame, so live tweaks come out at full
// quality and a steady frame rate however fast the live preview was.
import type { ExportSettings } from './export';

/** Everything that can change during a performance (display size is fixed by the export) */
export type FrameSettings = Omit<ExportSettings, 'displayWidth' | 'displayHeight'>;

export interface Keyframe {
    /** Seconds from the start of the recording (video time for videos) */
    time: number;
    settings: FrameSettings;
}

export interface Recording {
    /** The image file or video URL this was performed on */
    sourceKey: File | string;
    duration: number;
    keyframes: Keyframe[];
}

/** Settings in effect at `time`: the last change at or before it */
export const settingsAt = (recording: Recording, time: number): FrameSettings => {
    const { keyframes } = recording;
    let lo = 0;
    let hi = keyframes.length - 1;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (keyframes[mid].time <= time) lo = mid;
        else hi = mid - 1;
    }
    return keyframes[lo].settings;
};

const sameSettings = (a: FrameSettings, b: FrameSettings) => JSON.stringify(a) === JSON.stringify(b);

/** Records keyframes; call `capture` whenever settings may have changed */
export class Recorder {
    private keyframes: Keyframe[] = [];

    constructor(private sourceKey: File | string, private now: () => number, initial: FrameSettings) {
        this.keyframes.push({ time: 0, settings: initial });
    }

    capture(settings: FrameSettings) {
        const last = this.keyframes[this.keyframes.length - 1];
        if (sameSettings(last.settings, settings)) return;
        const time = Math.max(last.time, this.now());
        // Several changes within one frame: keep only the latest
        if (time - last.time < 1 / 240 && this.keyframes.length > 1) this.keyframes.pop();
        this.keyframes.push({ time, settings });
    }

    finish(): Recording {
        const duration = Math.max(this.now(), this.keyframes[this.keyframes.length - 1].time, 0.1);
        return { sourceKey: this.sourceKey, duration, keyframes: this.keyframes };
    }
}

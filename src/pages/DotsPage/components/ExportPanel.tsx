import React from 'react';
import { downloadBlob, ExportInput, ExportSize, exportImage, exportVideo, getAvailableSizes, SizeId } from '../export';

const SIZE_LABELS: Record<SizeId, string> = { max: 'max', '4k': '4K', '1080p': '1080p', screen: 'screen' };

const FPS_OPTIONS = [24, 25, 30, 50, 60];

interface ExportPanelProps {
    /** Snapshot of everything export needs, or null when there's nothing to export */
    getExportInput: () => ExportInput | null;
    /** Live webcam can't be exported frame by frame */
    disabledReason: string | null;
    sourceName: string;
    onExportingChange: (exporting: boolean) => void;
    recording: {
        isRecording: boolean;
        /** Seconds recorded so far, while recording */
        elapsed: number;
        /** Length of the finished recording for the current source, if any */
        duration: number | null;
        canRecord: boolean;
        onStart: () => void;
        onStop: () => void;
        onClear: () => void;
    };
}

type Status =
    | { kind: 'idle' }
    | { kind: 'running'; done: number; total: number }
    | { kind: 'done'; message: string }
    | { kind: 'error'; message: string };

export const ExportPanel: React.FC<ExportPanelProps> = ({ getExportInput, disabledReason, sourceName, onExportingChange, recording }) => {
    const [isOpen, setIsOpen] = React.useState(false);
    const [fps, setFps] = React.useState(30);
    const [sizes, setSizes] = React.useState<ExportSize[] | null>(null);
    const [sizeId, setSizeId] = React.useState<SizeId>('max');
    const [status, setStatus] = React.useState<Status>({ kind: 'idle' });
    const abortRef = React.useRef<AbortController | null>(null);
    const sizesKindRef = React.useRef<string | null>(null);
    const [useRecording, setUseRecording] = React.useState(true);
    const [transparent, setTransparent] = React.useState(false);

    const running = status.kind === 'running';
    const hasRecording = recording.duration !== null;
    // Drop the recording from what gets exported when unchecked
    const getInput = (): ExportInput | null => {
        const raw = getExportInput();
        return raw && { ...raw, recording: useRecording ? raw.recording : null };
    };
    const input = isOpen ? getInput() : null;
    // A recorded performance on a still image exports as video
    const isVideo = input?.source.kind === 'video' || !!input?.recording;
    // A background image or video fills the frame, so nothing would end up transparent
    const hasBackground = !!input && (!!input.customBg || input.settings.showOriginalBackground);

    // Find which sizes this browser can produce whenever the panel opens or settings change.
    // Defaults to "max".
    const outputKind = isVideo ? 'video' : 'image';
    const sizeKey = input ? `${outputKind}:${input.settings.displayWidth}x${input.settings.displayHeight}:${fps}` : '';
    React.useEffect(() => {
        if (!isOpen || !sizeKey || running) return;
        const current = getInput();
        if (!current) return;
        let cancelled = false;
        setSizes(null);
        getAvailableSizes(current.settings, outputKind === 'video', fps).then((available) => {
            if (cancelled) return;
            setSizes(available);
            // Keep the user's pick if still offered for the same kind of source, else max
            const sameKind = sizesKindRef.current === outputKind;
            sizesKindRef.current = outputKind;
            setSizeId((prev) => (sameKind && available.some((s) => s.id === prev) ? prev : 'max'));
        });
        return () => {
            cancelled = true;
        };
        // `running` re-runs this when an export ends, in case settings changed meanwhile
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, sizeKey, running]);

    const selectedSize = sizes?.find((s) => s.id === sizeId) ?? null;

    const codecLabel = selectedSize?.encoder?.label ?? null;

    const startExport = async () => {
        const current = getInput();
        if (!current || !selectedSize) return;
        const baseName = sourceName.replace(/\.[^.]+$/, '') || 'dots';
        const filename = `${baseName}-dots-${selectedSize.width}x${selectedSize.height}`;
        const started = performance.now();
        onExportingChange(true);
        try {
            if (current.source.kind === 'image' && !current.recording) {
                setStatus({ kind: 'running', done: 0, total: 1 });
                const blob = await exportImage(current, selectedSize, transparent);
                downloadBlob(blob, `${filename}${transparent ? '-transparent' : ''}.png`);
            } else {
                const controller = new AbortController();
                abortRef.current = controller;
                setStatus({ kind: 'running', done: 0, total: 0 });
                const blob = await exportVideo(current, selectedSize, fps, controller.signal, (done, total) =>
                    setStatus({ kind: 'running', done, total })
                );
                downloadBlob(blob, `${filename}-${fps}fps${current.recording ? '-performance' : ''}.mp4`);
            }
            const seconds = ((performance.now() - started) / 1000).toFixed(1);
            setStatus({ kind: 'done', message: `saved in ${seconds}s` });
        } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') {
                setStatus({ kind: 'idle' });
            } else {
                console.error('Export failed:', error);
                setStatus({ kind: 'error', message: error instanceof Error ? error.message : 'export failed' });
            }
        } finally {
            abortRef.current = null;
            onExportingChange(false);
        }
    };

    return (
        <div className="export-panel">
            <div className="export-panel-buttons">
                {recording.isRecording ? (
                    <button className="control-button record-button recording" onClick={recording.onStop}>
                        ■ stop {recording.elapsed.toFixed(1)}s
                    </button>
                ) : (
                    <button
                        className="control-button record-button"
                        onClick={recording.onStart}
                        disabled={!recording.canRecord || running}
                        title="restart the video and record every settings change, to export at full quality"
                    >
                        ● rec
                    </button>
                )}
                <button className="control-button" onClick={() => setIsOpen((v) => !v)} disabled={recording.isRecording}>
                    export
                </button>
            </div>
            {hasRecording && !recording.isRecording && (
                <div className="record-status">
                    recorded {recording.duration!.toFixed(1)}s
                    <button className="record-clear" onClick={recording.onClear} disabled={running} title="discard recording">
                        ✕
                    </button>
                </div>
            )}
            {isOpen && (
                <div className="export-panel-body">
                    {disabledReason || !input ? (
                        <div>{disabledReason ?? 'upload an image or video first'}</div>
                    ) : (
                        <>
                            {hasRecording && (
                                <label className="export-checkbox">
                                    <input
                                        type="checkbox"
                                        checked={useRecording}
                                        disabled={running}
                                        onChange={() => setUseRecording((v) => !v)}
                                    />
                                    {`use recording (${recording.duration!.toFixed(1)}s)`}
                                </label>
                            )}
                            <div className="control-group">
                                <label className="control-label" htmlFor="export-size">size</label>
                                <select
                                    id="export-size"
                                    className="control-select"
                                    value={sizes ? sizeId : ''}
                                    disabled={running || !sizes?.length}
                                    onChange={(e) => setSizeId(e.target.value as SizeId)}
                                >
                                    {!sizes && <option value="">checking…</option>}
                                    {sizes?.map((s) => (
                                        <option key={s.id} value={s.id}>
                                            {SIZE_LABELS[s.id]} · {s.width}×{s.height}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            {isVideo && (
                                <div className="control-group">
                                    <label className="control-label" htmlFor="export-fps">fps</label>
                                    <select
                                        id="export-fps"
                                        className="control-select"
                                        value={fps}
                                        disabled={running}
                                        onChange={(e) => setFps(Number(e.target.value))}
                                    >
                                        {FPS_OPTIONS.map((f) => (
                                            <option key={f} value={f}>{f}</option>
                                        ))}
                                    </select>
                                </div>
                            )}
                            {!isVideo && (
                                <label className="export-checkbox">
                                    <input
                                        type="checkbox"
                                        checked={transparent}
                                        disabled={running}
                                        onChange={() => setTransparent((v) => !v)}
                                    />
                                    {'transparent background'}
                                </label>
                            )}
                            {!isVideo && transparent && hasBackground && (
                                <div>the background image fills the frame; turn it off for transparency</div>
                            )}
                            {sizes?.length === 0 && <div>this browser can't export {isVideo ? 'video' : 'images'}</div>}
                            {running ? (
                                <>
                                    <div>
                                        {status.total > 1
                                            ? `frame ${status.done} / ${status.total} (${Math.round((100 * status.done) / status.total)}%)`
                                            : 'rendering…'}
                                    </div>
                                    {isVideo && (
                                        <button className="control-button" onClick={() => abortRef.current?.abort()}>
                                            cancel
                                        </button>
                                    )}
                                </>
                            ) : (
                                <button className="control-button" disabled={!selectedSize} onClick={startExport}>
                                    {isVideo ? `export mp4${codecLabel ? ` (${codecLabel})` : ''}` : 'export png'}
                                </button>
                            )}
                            {status.kind === 'done' && <div>{status.message}</div>}
                            {status.kind === 'error' && <div className="export-error">{status.message}</div>}
                        </>
                    )}
                </div>
            )}
        </div>
    );
};

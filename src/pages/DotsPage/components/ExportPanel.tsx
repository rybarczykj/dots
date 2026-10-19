import React from 'react';
import { downloadBlob, ExportInput, ExportSize, exportImage, exportVideo, getAvailableSizes, getVideoCodecLabel } from '../export';

const FPS_OPTIONS = [24, 25, 30, 50, 60];

interface ExportPanelProps {
    /** Snapshot of everything export needs, or null when there's nothing to export */
    getExportInput: () => ExportInput | null;
    /** Live webcam can't be exported frame by frame */
    disabledReason: string | null;
    sourceName: string;
    onExportingChange: (exporting: boolean) => void;
}

type Status =
    | { kind: 'idle' }
    | { kind: 'running'; done: number; total: number }
    | { kind: 'done'; message: string }
    | { kind: 'error'; message: string };

export const ExportPanel: React.FC<ExportPanelProps> = ({ getExportInput, disabledReason, sourceName, onExportingChange }) => {
    const [isOpen, setIsOpen] = React.useState(false);
    const [fps, setFps] = React.useState(30);
    const [sizes, setSizes] = React.useState<ExportSize[] | null>(null);
    const [scale, setScale] = React.useState<number | null>(null);
    const [status, setStatus] = React.useState<Status>({ kind: 'idle' });
    const abortRef = React.useRef<AbortController | null>(null);

    const input = isOpen ? getExportInput() : null;
    const isVideo = input?.source.kind === 'video';
    const running = status.kind === 'running';

    // Find which sizes this browser can produce whenever the panel opens or settings change.
    // Default to the largest ("full possible size").
    const sizeKey = input ? `${input.source.kind}:${input.settings.displayWidth}x${input.settings.displayHeight}:${fps}` : '';
    React.useEffect(() => {
        if (!isOpen || !sizeKey || running) return;
        const current = getExportInput();
        if (!current) return;
        let cancelled = false;
        setSizes(null);
        getAvailableSizes(current.settings, current.source.kind === 'video', fps).then((available) => {
            if (cancelled) return;
            setSizes(available);
            setScale(available.length ? available[available.length - 1].scale : null);
        });
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, sizeKey]);

    const selectedSize = sizes?.find((s) => s.scale === scale) ?? null;

    const [codecLabel, setCodecLabel] = React.useState<string | null>(null);
    React.useEffect(() => {
        setCodecLabel(null);
        if (!isVideo || !selectedSize) return;
        let cancelled = false;
        getVideoCodecLabel(selectedSize, fps).then((label) => !cancelled && setCodecLabel(label));
        return () => {
            cancelled = true;
        };
    }, [isVideo, selectedSize, fps]);

    const startExport = async () => {
        const current = getExportInput();
        if (!current || !selectedSize) return;
        const baseName = sourceName.replace(/\.[^.]+$/, '') || 'dots';
        const filename = `${baseName}-dots-${selectedSize.width}x${selectedSize.height}`;
        const started = performance.now();
        onExportingChange(true);
        try {
            if (current.source.kind === 'image') {
                setStatus({ kind: 'running', done: 0, total: 1 });
                const blob = await exportImage(current, selectedSize);
                downloadBlob(blob, `${filename}.png`);
            } else {
                const controller = new AbortController();
                abortRef.current = controller;
                setStatus({ kind: 'running', done: 0, total: 0 });
                const blob = await exportVideo(current, selectedSize, fps, controller.signal, (done, total) =>
                    setStatus({ kind: 'running', done, total })
                );
                downloadBlob(blob, `${filename}-${fps}fps.mp4`);
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
            <button className="control-button" onClick={() => setIsOpen((v) => !v)}>
                export
            </button>
            {isOpen && (
                <div className="export-panel-body">
                    {disabledReason || !input ? (
                        <div>{disabledReason ?? 'upload an image or video first'}</div>
                    ) : (
                        <>
                            <div className="control-group">
                                <label className="control-label" htmlFor="export-size">size</label>
                                <select
                                    id="export-size"
                                    className="control-select"
                                    value={scale ?? ''}
                                    disabled={running || !sizes?.length}
                                    onChange={(e) => setScale(Number(e.target.value))}
                                >
                                    {!sizes && <option value="">checking…</option>}
                                    {sizes?.map((s) => (
                                        <option key={s.scale} value={s.scale}>
                                            {s.width}×{s.height} ({s.scale}×)
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
                            {sizes?.length === 0 && <div>this browser can't export {isVideo ? 'video' : 'images'} at this size</div>}
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

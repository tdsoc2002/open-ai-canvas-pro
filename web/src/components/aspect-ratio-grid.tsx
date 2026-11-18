import { Scan } from "lucide-react";
import "./image-size-picker.css";

type AspectRatioOption = {
    key: string;
    label: string;
    ratio?: number;
    adaptive?: boolean;
    title?: string;
    hint?: string;
    selected: boolean;
    onSelect: () => void;
};

export function AspectRatioGrid({ options }: { options: AspectRatioOption[] }) {
    if (!options.length) return null;
    return (
        <>
            <div className="image-size-label">宽高比</div>
            <div className="image-size-ratios" role="group" aria-label="宽高比">
                {options.map(({ key, label, ratio, adaptive, title, hint, selected, onSelect }) => (
                    <button key={key} type="button" title={title} aria-pressed={selected} onClick={onSelect}>
                        {ratio ? (
                            <span className="image-size-ratio-icon" style={{ width: 24 * Math.min(1, ratio), height: 24 * Math.min(1, 1 / ratio) }} aria-hidden />
                        ) : adaptive ? (
                            <Scan className="image-size-ratio-adaptive-icon" aria-hidden />
                        ) : (
                            <span aria-hidden />
                        )}
                        <span>{label}</span>
                        {hint ? <small className="image-size-ratio-hint">{hint}</small> : null}
                    </button>
                ))}
            </div>
        </>
    );
}

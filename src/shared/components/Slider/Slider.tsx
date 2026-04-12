import React from 'react';

interface SliderProps {
    title: string;
    onChange: (newValue: number) => void;
    label: string;
    value: number;
    min: number;
    max: number;
    step?: number;
    disabled?: boolean;
    compact?: boolean;
}

export const Slider: React.FC<SliderProps> = ({
    title,
    onChange,
    label,
    value,
    min,
    max,
    step,
    disabled,
    compact,
}) => {
    const sliderLength = compact ? 11 : 17;
    const clampedValue = Math.max(min, Math.min(max, value));

    const normalizedValue = Math.max(0, Math.min(sliderLength, Math.floor(((clampedValue - min) / (max - min)) * sliderLength)));

    const leftDashes = '-'.repeat(normalizedValue);
    const rightDashes = '-'.repeat(sliderLength - normalizedValue);

    return (
        <div className={`slider-container ${disabled ? 'disabled' : ''} ${compact ? 'compact' : ''}`}>
            <label>
                {title}{' '}
                <span className="slider-value">{label}</span>
            </label>
            <div className="slider-track">
                <input
                    type="range"
                    min={min}
                    max={max}
                    step={step}
                    value={value}
                    onChange={(e) => onChange(parseFloat(e.target.value))}
                    disabled={disabled}
                    className="slider-input"
                />
                <span className="slider-arrow">←</span>
                <span className="slider-dashes">{leftDashes}</span>
                <span className="slider-asterix">*</span>
                <span className="slider-dashes">{rightDashes}</span>
                <span className="slider-arrow">→</span>
            </div>
        </div>
    );
};



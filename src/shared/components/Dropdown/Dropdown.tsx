import React from 'react';

interface DropdownProps<T extends string> {
    label: string;
    options: {
        value: T;
        label: T;
    }[];
    selectedOption: T;
    onOptionChange: (option: T) => void;
}

const Dropdown = <T extends string>({
    label,
    options,
    selectedOption,
    onOptionChange,
}: DropdownProps<T>): JSX.Element => {
    return (
        <div className="control-group">
            <label className="control-label">{label}</label>
            <select
                value={selectedOption}
                onChange={(e) => onOptionChange(e.target.value as T)}
                className="control-select"
            >
                {options.map((option) => (
                    <option key={option.value} value={option.value}>
                        {option.label}
                    </option>
                ))}
            </select>
        </div>
    );
};

export default Dropdown;

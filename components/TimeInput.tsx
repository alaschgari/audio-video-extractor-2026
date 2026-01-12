import React from 'react';

interface TimeInputProps {
    label: string;
    value: string;
    onChange: (val: string) => void;
    onBlur: () => void;
}

const TimeInput: React.FC<TimeInputProps> = ({ label, value, onChange, onBlur }) => (
    <div className="flex flex-col gap-1">
        <label className="text-[10px] uppercase tracking-wider font-bold text-slate-500">{label}</label>
        <div className="relative group">
            <input
                type="text"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                onBlur={onBlur}
                onKeyDown={(e) => { if (e.key === 'Enter') { onBlur(); (e.target as HTMLInputElement).blur(); } }}
                className="bg-slate-900/50 border border-slate-700 hover:border-brand-500/50 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 rounded-md py-1.5 px-3 w-28 text-sm font-mono text-center text-brand-100 placeholder-slate-600 transition-all outline-none"
                placeholder="00:00.00"
            />
        </div>
    </div>
);

export default TimeInput;

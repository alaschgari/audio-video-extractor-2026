import React from 'react';

interface ProcessingOverlayProps {
    message: string;
}

const ProcessingOverlay: React.FC<ProcessingOverlayProps> = ({ message }) => (
    <div className="absolute inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex flex-col items-center justify-center rounded-2xl animate-in fade-in duration-300">
        <div className="w-12 h-12 border-4 border-brand-500 border-t-transparent rounded-full animate-spin mb-4 shadow-[0_0_20px_rgba(14,165,233,0.3)]"></div>
        <p className="text-brand-50 font-medium tracking-wide">{message}</p>
    </div>
);

export default ProcessingOverlay;

import React from 'react';
import { useWorkflowStore, colorToHex, hexToColor } from '@/lib/store/workflow-store';
import { useTranslation } from '@/lib/store/i18n-store';
import { X } from 'lucide-react';

interface WorkflowEdgeSidebarProps {
    edgeId: string;
    onClose: () => void;
}

export function WorkflowEdgeSidebar({ edgeId, onClose }: WorkflowEdgeSidebarProps) {
    const { edges, nodes, updateEdge } = useWorkflowStore();
    const t = useTranslation();

    const edge = edges.find((e) => e.id === edgeId);
    if (!edge) return null;

    const sourceNode = nodes.find((n) => n.id === edge.source);
    const targetNode = nodes.find((n) => n.id === edge.target);

    const sourceLabel = sourceNode?.data?.label || edge.source;
    const targetLabel = targetNode?.data?.label || edge.target;

    const currentStroke = edge.style?.stroke || '#6366f1';
    const currentColor = hexToColor[currentStroke] || 'indigo';

    const handleColorChange = (colorName: string) => {
        const hex = colorToHex[colorName] || '#6366f1';
        updateEdge(edgeId, {
            markerEnd: {
                ...((edge.markerEnd as any) || {}),
                type: 'arrowclosed',
                width: 20,
                height: 20,
                color: hex,
            },
            style: {
                ...(edge.style || {}),
                stroke: hex,
            },
        });
    };

    const handleTypeChange = (type: string) => {
        updateEdge(edgeId, { type });
    };

    const handleAnimatedChange = (animated: boolean) => {
        updateEdge(edgeId, { animated });
    };

    return (
        <div className="w-80 border-l border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 flex flex-col h-full shadow-2xl relative z-10 animate-in slide-in-from-right-2 duration-200">
            {/* Header */}
            <div className="px-5 py-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
                <h2 className="font-semibold text-sm">{t('configureConnector')}</h2>
                <button onClick={onClose} className="p-1 hover:bg-zinc-100 dark:hover:bg-zinc-900 rounded-md text-zinc-500">
                    <X className="w-4 h-4" />
                </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-auto p-5 space-y-6">
                {/* Connection Info */}
                <div className="space-y-1 bg-zinc-50 dark:bg-zinc-900/50 p-3 rounded-lg border border-zinc-100 dark:border-zinc-800">
                    <div className="text-[10px] uppercase font-bold text-zinc-400 tracking-wider">
                        {t('sourceNode')}
                    </div>
                    <div className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 truncate">
                        {sourceLabel}
                    </div>
                    <div className="h-px bg-zinc-200 dark:bg-zinc-800 my-2" />
                    <div className="text-[10px] uppercase font-bold text-zinc-400 tracking-wider">
                        {t('targetNode')}
                    </div>
                    <div className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 truncate">
                        {targetLabel}
                    </div>
                </div>

                {/* Connector Color */}
                <div className="space-y-2">
                    <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">{t('connectorColor')}</label>
                    <div className="flex flex-wrap gap-2">
                        {['zinc', 'red', 'orange', 'amber', 'emerald', 'teal', 'cyan', 'blue', 'indigo', 'violet', 'fuchsia', 'rose'].map(color => (
                            <button
                                key={color}
                                onClick={() => handleColorChange(color)}
                                className={`w-5 h-5 rounded-full bg-${color}-500 border-2 ${currentColor === color ? 'border-zinc-900 dark:border-white shadow-md scale-110' : 'border-transparent hover:scale-110'} transition-all`}
                                title={color}
                            />
                        ))}
                    </div>
                </div>

                {/* Connector Type */}
                <div className="space-y-2">
                    <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">{t('connectorType')}</label>
                    <select
                        value={edge.type || 'step'}
                        onChange={(e) => handleTypeChange(e.target.value)}
                        className="w-full text-sm border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-2 bg-zinc-50 dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                    >
                        <option value="step">Step (Nét vuông)</option>
                        <option value="smoothstep">Smooth Step (Góc tròn)</option>
                        <option value="straight">Straight (Đường thẳng)</option>
                        <option value="default">Bezier (Đường cong)</option>
                    </select>
                </div>

                {/* Animated Option */}
                <div className="flex items-center justify-between pt-2">
                    <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t('animatedLine')}</span>
                    <input
                        type="checkbox"
                        checked={edge.animated || false}
                        onChange={(e) => handleAnimatedChange(e.target.checked)}
                        className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500"
                    />
                </div>
            </div>
        </div>
    );
}

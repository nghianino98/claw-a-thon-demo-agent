import { memo } from 'react';
import { Handle, Position, NodeResizer, type NodeProps } from '@xyflow/react';
import { Database, Cpu, Send, Loader2, CheckCircle2, XCircle, Clock, PencilLine, ListChecks, Workflow } from 'lucide-react';
import { type AppNode, useWorkflowStore } from '@/lib/store/workflow-store';
import { useTranslation } from '@/lib/store/i18n-store';

export const ActivityNode = memo(({ id, data, isConnectable, selected }: NodeProps<AppNode>) => {
    const updateNodeData = useWorkflowStore(state => state.updateNodeData);
    const t = useTranslation();

    // Map taskType to visuals
    const getVisuals = (type: string, customColor?: string) => {
        const colorPrefix = customColor || (
            type === 'dataSource' ? 'indigo' :
                type === 'agentAction' ? 'cyan' :
                type === 'aiPrompt' ? 'fuchsia' :
                    type === 'outputAction' ? 'emerald' :
                        type === 'taskExecution' ? 'amber' : 'zinc'
        );

        const styleTokens = {
            border: `border-${colorPrefix}-500`,
            shadow: `shadow-${colorPrefix}-500/20`,
            bgLight: `bg-${colorPrefix}-50 dark:bg-${colorPrefix}-900/20`,
            bgSolid: `bg-${colorPrefix}-500`,
            textDark: `text-${colorPrefix}-900 dark:text-${colorPrefix}-200`,
            textLight: `text-${colorPrefix}-600/80 dark:text-${colorPrefix}-400/80`,
            textPrimary: `text-${colorPrefix}-500`,
            hoverBgInfo: `hover:bg-${colorPrefix}-100 dark:hover:bg-${colorPrefix}-900/40`,
        };

        switch (type) {
            case 'dataSource':
                return { icon: <Database className="w-4 h-4" />, tokens: styleTokens, label: t('nodeInputData') };
            case 'aiPrompt':
                return { icon: <Cpu className="w-4 h-4" />, tokens: styleTokens, label: t('nodeAiProcessing') };
            case 'agentAction':
                return { icon: <Workflow className="w-4 h-4" />, tokens: styleTokens, label: t('nodeAgentAction') };
            case 'outputAction':
                return { icon: <Send className="w-4 h-4" />, tokens: styleTokens, label: t('nodeOutput') };
            case 'taskExecution':
                return { icon: <ListChecks className="w-4 h-4" />, tokens: styleTokens, label: t('nodeCollect') };
            default:
                return { icon: <Cpu className="w-4 h-4" />, tokens: styleTokens, label: t('nodeActivity') };
        }
    };

    const visual = getVisuals(data.taskType || 'aiPrompt', data.color);

    return (
        <div
            onClick={() => {
                console.log("ActivityNode onClick:", id);
                window.dispatchEvent(new CustomEvent('node-selected', { detail: id }));
            }}
            style={{ width: data.width || 240, height: data.height || 'auto' }}
            className={`shadow-lg rounded-xl bg-white dark:bg-zinc-950 border-2 overflow-hidden transition-all duration-200 cursor-pointer pointer-events-auto h-full flex flex-col ${selected
                ? `${visual.tokens.border} ${visual.tokens.shadow} shadow-xl`
                : 'border-zinc-200 dark:border-zinc-800'
                }`}
        >
            <NodeResizer
                color="#6366f1"
                isVisible={selected}
                minWidth={200}
                minHeight={100}
                onResize={(_, params) => {
                    updateNodeData(id, { width: params.width, height: params.height });
                }}
            />

            <Handle
                type="target"
                position={Position.Left}
                isConnectable={isConnectable}
                className={`w-3 h-3 ${visual.tokens.bgSolid} border-2 border-white dark:border-zinc-950`}
            />

            <div className={`${visual.tokens.bgLight} px-4 py-3 flex items-center justify-between`}>
                <div className="flex items-center gap-3 w-full">
                    <div className={`p-2 ${visual.tokens.bgSolid} rounded-lg text-white shadow-sm flex-shrink-0`}>
                        {visual.icon}
                    </div>
                    <div className="w-full min-w-0 pr-2">
                        <div className="relative group flex items-center">
                            <input
                                value={data.label || visual.label}
                                onChange={(e) => updateNodeData(id, { label: e.target.value })}
                                className={`font-semibold text-sm ${visual.tokens.textDark} bg-transparent border-none outline-none focus:ring-1 focus:ring-${data.color || 'indigo'}-500 rounded px-1 py-0.5 w-full truncate pr-5 group-hover:bg-black/5 dark:group-hover:bg-white/5 transition-colors cursor-text`}
                                placeholder={t('nodeNamePlaceholder')}
                                onClick={(e) => e.stopPropagation()}
                            />
                            <PencilLine className="w-3 h-3 absolute right-1 opacity-0 group-hover:opacity-100 transition-opacity text-zinc-400 pointer-events-none" />
                        </div>
                        <div className={`text-[10px] font-medium ${visual.tokens.textLight} uppercase tracking-wider px-1`}>
                            {visual.label}
                        </div>
                    </div>
                </div>

                {selected && (
                    <div className={`text-xs p-1 ${visual.tokens.textPrimary} ${visual.tokens.hoverBgInfo} rounded flex-shrink-0 transition-colors pointer-events-auto`}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-settings-2"><path d="M20 7h-9" /><path d="M14 17H5" /><circle cx="17" cy="17" r="3" /><circle cx="7" cy="7" r="3" /></svg>
                    </div>
                )}
            </div>

            {/* Status Section */}
            {(data.executionStatus && data.executionStatus !== 'idle') && (
                <div className="px-4 py-2 border-t border-zinc-100 dark:border-zinc-800/50 bg-zinc-50/50 dark:bg-zinc-900/30 flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                        {data.executionStatus === 'running' && (
                            <><Loader2 className="w-3.5 h-3.5 text-blue-500 animate-spin" /><span className="text-xs font-medium text-blue-600 dark:text-blue-400">{t('statusRunning')}</span></>
                        )}
                        {data.executionStatus === 'success' && (
                            <><CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /><span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">{t('statusSuccess')}</span></>
                        )}
                        {data.executionStatus === 'error' && (
                            <><XCircle className="w-3.5 h-3.5 text-red-500" /><span className="text-xs font-medium text-red-600 dark:text-red-400">{t('statusFailed')}</span></>
                        )}
                    </div>
                    {data.executionTimeMs !== undefined && (
                        <div className="flex items-center gap-1 text-zinc-400 dark:text-zinc-500">
                            <Clock className="w-3 h-3" />
                            <span className="text-[10px] tabular-nums font-medium">
                                {(data.executionTimeMs / 1000).toFixed(2)}s
                            </span>
                        </div>
                    )}
                </div>
            )}

            <Handle
                type="source"
                position={Position.Right}
                isConnectable={isConnectable}
                className={`w-3 h-3 ${visual.tokens.bgSolid} border-2 border-white dark:border-zinc-950`}
            />
        </div >
    );
});

ActivityNode.displayName = "ActivityNode";

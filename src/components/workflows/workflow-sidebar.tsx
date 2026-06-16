import React, { useRef } from 'react';
import { useWorkflowStore, WorkflowNodeData, getHexColorForNode } from '@/lib/store/workflow-store';
import { useFileStore } from '@/lib/store/file-store';
import { useTranslation } from '@/lib/store/i18n-store';
import { X, FileUp, FileText, Cpu, Database, Send, ListChecks, Workflow, Plug } from 'lucide-react';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { MarkerType } from '@xyflow/react';
import { apiFetch } from '@/lib/api/client';
import { useAgentConnectStore } from '@/lib/store/agent-connect-store';
import { agentAdminPath, normalizeAgentConnections, type AgentConnection } from '@/lib/api/agent-connections';
import {
    normalizeMcpServers,
    normalizeSkills,
    normalizeWorkflows,
    type AgentMcpServer,
    type AgentSkill,
    type AgentWorkflow,
} from '@/lib/api/agent-admin';

interface WorkflowSidebarProps {
    nodeId: string;
    onClose: () => void;
}

type WorkflowTaskSummary = {
    id: string;
    name: string;
    source: string;
    [key: string]: unknown;
};

function readInstructions(data: unknown) {
    if (typeof data !== "object" || data === null) return "";
    const record = data as Record<string, unknown>;
    if (typeof record.content === "string") return record.content;
    if (typeof record.active_content === "string") return record.active_content;
    if (typeof record.instructions === "string") return record.instructions;
    if (Array.isArray(record.instructions)) {
        const instructions = record.instructions as Array<{ active?: boolean | number; content?: unknown }>;
        const active = instructions.find((item) => item && (item.active === 1 || item.active === true));
        if (active && typeof active.content === "string") return active.content;
        const first = instructions[0];
        if (first && typeof first.content === "string") return first.content;
    }
    return "";
}

export function WorkflowSidebar({ nodeId, onClose }: WorkflowSidebarProps) {
    const { nodes, edges, updateNodeData, setEdges } = useWorkflowStore();
    const { setFile, removeFile } = useFileStore();
    const selectedAgentConnectId = useAgentConnectStore((state) => state.selectedId);
    const t = useTranslation();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [availableTasks, setAvailableTasks] = useState<WorkflowTaskSummary[]>([]);
    const [isLoadingTasks, setIsLoadingTasks] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [agentConnections, setAgentConnections] = useState<AgentConnection[]>([]);
    const [mcpServers, setMcpServers] = useState<AgentMcpServer[]>([]);
    const [agentSkills, setAgentSkills] = useState<AgentSkill[]>([]);
    const [systemPrompt, setSystemPrompt] = useState("");
    const [isLoadingAgentResources, setIsLoadingAgentResources] = useState(false);

    const node = nodes.find((n) => n.id === nodeId);
    const data = node?.data || ({} as WorkflowNodeData);
    const activeAgentConnectionId =
        (data?.agentConnectionId as string | undefined) ||
        selectedAgentConnectId ||
        agentConnections.find((connection) => connection.enabled && connection.isDefault)?.id ||
        agentConnections.find((connection) => connection.enabled)?.id ||
        "";

    useEffect(() => {
        const fetchTasks = async () => {
            setIsLoadingTasks(true);
            try {
                const res = await fetch('/api/workflows/tasks');
                if (res.ok) {
                    const data = await res.json();
                    setAvailableTasks(Array.isArray(data) ? data as WorkflowTaskSummary[] : []);
                }
            } catch (err) {
                console.error("Failed to fetch tasks", err);
            } finally {
                setIsLoadingTasks(false);
            }
        };
        fetchTasks();
    }, []);

    useEffect(() => {
        const fetchAgentConnections = async () => {
            try {
                const next = normalizeAgentConnections(await apiFetch('/api/agent-connects')).filter((connection) => connection.enabled);
                setAgentConnections(next);
            } catch (err) {
                console.error("Failed to fetch agent connects", err);
                setAgentConnections([]);
            }
        };

        fetchAgentConnections();
    }, []);

    useEffect(() => {
        const fetchAgentResources = async () => {
            if (!activeAgentConnectionId) {
                setMcpServers([]);
                setAgentSkills([]);
                setSystemPrompt("");
                return;
            }
            setIsLoadingAgentResources(true);
            try {
                const [mcpResult, instructionsResult, skillsResult] = await Promise.allSettled([
                    apiFetch(agentAdminPath(activeAgentConnectionId, 'mcp/servers')),
                    apiFetch(agentAdminPath(activeAgentConnectionId, 'instructions')),
                    apiFetch(agentAdminPath(activeAgentConnectionId, 'skills')),
                ]);

                if (mcpResult.status === 'fulfilled') {
                    setMcpServers(normalizeMcpServers(mcpResult.value).filter((server) => server.enabled));
                }
                if (instructionsResult.status === 'fulfilled') {
                    setSystemPrompt(readInstructions(instructionsResult.value));
                } else {
                    setSystemPrompt("");
                }
                if (skillsResult.status === 'fulfilled') {
                    setAgentSkills(normalizeSkills(skillsResult.value).filter((skill) => skill.enabled));
                }
            } catch (err) {
                console.error("Failed to fetch agent resources", err);
            } finally {
                setIsLoadingAgentResources(false);
            }
        };

        fetchAgentResources();
    }, [activeAgentConnectionId]);

    if (!node) return null;
    const taskType = data.taskType || 'aiPrompt';
    const selectedSkill = agentSkills.find((skill) => skill.id === data.agentSkillId);
    // Removed selectedWorkflow

    // 1. Update data securely
    const handleChange = <K extends keyof WorkflowNodeData>(key: K, value: WorkflowNodeData[K]) => {
        updateNodeData(nodeId, { [key]: value } as Partial<WorkflowNodeData>);
    };

    const handleAgentConnectionChange = (value: string) => {
        updateNodeData(nodeId, {
            agentConnectionId: value,
            agentWorkflowId: "",
            agentSkillId: "",
        });
    };

    const agentConnectPicker = (
        <div className="space-y-2">
            <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">{t('agentConnect')}</label>
            <select
                value={activeAgentConnectionId}
                onChange={(e) => handleAgentConnectionChange(e.target.value)}
                className="w-full text-sm border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-2 bg-white dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
            >
                <option value="">{agentConnections.length ? t('agentConnect') : t('noAgentConnects')}</option>
                {agentConnections.map((connection) => (
                    <option key={connection.id} value={connection.id}>
                        {connection.name || connection.id}{connection.isDefault ? " (default)" : ""}
                    </option>
                ))}
            </select>
            {agentConnections.length === 0 && (
                <Link href="/agent-admin/agent-connects" className="flex items-center gap-1 text-[10px] font-semibold text-cyan-700 hover:underline">
                    <Plug className="h-3 w-3" />
                    {t('noAgentConnects')}
                </Link>
            )}
        </div>
    );

    const agentConfigPreview = (systemPrompt || selectedSkill) ? (
        <div className="space-y-2 rounded-lg border border-cyan-100 bg-white/70 p-3 text-xs dark:border-cyan-900/40 dark:bg-zinc-900/60">
            {systemPrompt && (
                <details open>
                    <summary className="cursor-pointer font-bold text-zinc-700 dark:text-zinc-200">System prompt</summary>
                    <p className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap text-zinc-600 dark:text-zinc-300">{systemPrompt}</p>
                </details>
            )}
            {selectedSkill && (
                <details open>
                    <summary className="cursor-pointer font-bold text-zinc-700 dark:text-zinc-200">Skill: {selectedSkill.name || selectedSkill.id}</summary>
                    <p className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap text-zinc-600 dark:text-zinc-300">{selectedSkill.instructions || selectedSkill.description}</p>
                </details>
            )}
        </div>
    ) : null;

    // 2. Previous Step logic
    // Find edges where target is this node
    const incomingEdge = edges.find((e) => e.target === nodeId);
    const previousNodeId = incomingEdge?.source || '';

    const handlePreviousStepChange = (newSourceId: string) => {
        const newEdges = edges.filter((e) => e.target !== nodeId); // remove old incoming edge
        if (newSourceId) {
            const sourceNode = nodes.find(n => n.id === newSourceId);
            const color = sourceNode ? getHexColorForNode(sourceNode) : '#6366f1';
            newEdges.push({
                id: `edge-${newSourceId}-${nodeId}`,
                source: newSourceId,
                target: nodeId,
                animated: true,
                type: 'step',
                markerEnd: { type: MarkerType.ArrowClosed, width: 20, height: 20, color },
                style: { stroke: color, strokeWidth: 2 }
            });
        }
        setEdges(newEdges);
    };

    // 3. File upload logic
    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];
            setFile(nodeId, file);
            handleChange('fileName', file.name);
            handleChange('fileSize', file.size);
        }
    };

    const clearFile = () => {
        removeFile(nodeId);
        handleChange('fileName', undefined);
        handleChange('fileSize', undefined);
        if (fileInputRef.current) fileInputRef.current.value = "";
    };

    return (
        <div className="w-80 border-l border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 flex flex-col h-full shadow-2xl relative z-10 animate-in slide-in-from-right-2 duration-200">
            {/* Header */}
            <div className="px-5 py-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
                <h2 className="font-semibold text-sm">{t('configureTask')}</h2>
                <button onClick={onClose} className="p-1 hover:bg-zinc-100 dark:hover:bg-zinc-900 rounded-md text-zinc-500">
                    <X className="w-4 h-4" />
                </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-auto p-5 space-y-6">

                {/* Task Type */}
                <div className="space-y-2">
                    <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">{t('taskTypeLabel')}</label>
                    <div className="grid grid-cols-2 gap-2">
                        <TaskTypeBtn
                            active={taskType === 'taskExecution'}
                            onClick={() => handleChange('taskType', 'taskExecution')}
                            icon={<ListChecks className="w-4 h-4" />}
                            label={t('runShort')}
                        />
                        <TaskTypeBtn
                            active={taskType === 'dataSource'}
                            onClick={() => handleChange('taskType', 'dataSource')}
                            icon={<Database className="w-4 h-4" />}
                            label={t('taskTypeInput')}
                        />
                        <TaskTypeBtn
                            active={taskType === 'aiPrompt'}
                            onClick={() => handleChange('taskType', 'aiPrompt')}
                            icon={<Cpu className="w-4 h-4" />}
                            label={t('taskTypeAi')}
                        />
                        <TaskTypeBtn
                            active={taskType === 'agentAction'}
                            onClick={() => handleChange('taskType', 'agentAction')}
                            icon={<Workflow className="w-4 h-4" />}
                            label={t('taskTypeAgent')}
                        />
                        <TaskTypeBtn
                            active={taskType === 'outputAction'}
                            onClick={() => handleChange('taskType', 'outputAction')}
                            icon={<Send className="w-4 h-4" />}
                            label={t('taskTypeOutput')}
                        />
                    </div>
                </div>

                {/* Task Name */}
                <div className="space-y-2">
                    <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">{t('taskNameLabel')}</label>
                    <input
                        type="text"
                        value={data.label || ''}
                        onChange={(e) => handleChange('label', e.target.value)}
                        className="w-full text-sm border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-2 bg-zinc-50 dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                        placeholder={t('taskNamePlaceholder')}
                    />
                </div>

                {/* Previous Step */}
                <div className="space-y-2">
                    <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">{t('previousStep')}</label>
                    <select
                        value={previousNodeId}
                        onChange={(e) => handlePreviousStepChange(e.target.value)}
                        className="w-full text-sm border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-2 bg-zinc-50 dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                    >
                        <option value="">{t('startNone')}</option>
                        {nodes
                            .filter((n) => n.id !== nodeId)
                            .map((n) => (
                                <option key={n.id} value={n.id}>
                                    {n.data.label || n.id}
                                </option>
                            ))}
                    </select>
                </div>

                {/* Node Appearance */}
                <div className="space-y-2">
                    <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">{t('nodeColor')}</label>
                    <div className="flex flex-wrap gap-2">
                        {['zinc', 'red', 'orange', 'amber', 'emerald', 'teal', 'cyan', 'blue', 'indigo', 'violet', 'fuchsia', 'rose'].map(color => (
                            <button
                                key={color}
                                onClick={() => handleChange('color', color)}
                                className={`w-5 h-5 rounded-full bg-${color}-500 border-2 ${data.color === color ? 'border-zinc-900 dark:border-white shadow-md scale-110' : 'border-transparent hover:scale-110'} transition-all`}
                                title={color}
                            />
                        ))}
                    </div>
                </div>

                <hr className="border-zinc-100 dark:border-zinc-800" />

                {/* Dynamic Configuration Fields */}

                {/* 1. Data Source Config */}
                {taskType === 'dataSource' && (
                    <div className="space-y-4 animate-in fade-in duration-300">
                        <div className="space-y-2">
                            <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">{t('sourceMode')}</label>
                            <select
                                value={data.sourceMode || 'localFile'}
                                onChange={(e) => handleChange('sourceMode', e.target.value as NonNullable<WorkflowNodeData['sourceMode']>)}
                                className="w-full text-sm border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-2 bg-zinc-50 dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                            >
                                <option value="localFile">{t('sourceModeLocal')}</option>
                                <option value="atlasMcp">{t('sourceModeAtlasMcp')}</option>
                            </select>
                        </div>

                        {(data.sourceMode || 'localFile') === 'atlasMcp' ? (
                            <div className="space-y-4 rounded-xl border border-cyan-100 bg-cyan-50/40 p-3 dark:border-cyan-900/40 dark:bg-cyan-950/10">
                                {agentConnectPicker}

                                <div className="space-y-2">
                                    <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">{t('mcpConnection')}</label>
                                    <select
                                        value={data.mcpConnectionId || ''}
                                        onChange={(e) => handleChange('mcpConnectionId', e.target.value)}
                                        className="w-full text-sm border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-2 bg-white dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                                    >
                                        <option value="">{isLoadingAgentResources ? t('loading') : t('mcpConnection')}</option>
                                        {mcpServers.map((server) => (
                                            <option key={server.id} value={server.id}>
                                                {server.name || server.id} ({server.prefix}__*)
                                            </option>
                                        ))}
                                    </select>
                                    {mcpServers.length === 0 && !isLoadingAgentResources && (
                                        <Link href="/settings/mcp" className="flex items-center gap-1 text-[10px] font-semibold text-cyan-700 hover:underline">
                                            <Plug className="h-3 w-3" />
                                            {t('noMcpConnections')}
                                        </Link>
                                    )}
                                </div>

                                <div className="space-y-2">
                                    <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">{t('atlasBoardUrl')}</label>
                                    <input
                                        type="url"
                                        value={data.atlasBoardUrl || ''}
                                        onChange={(e) => handleChange('atlasBoardUrl', e.target.value)}
                                        className="w-full text-xs font-mono border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-2 bg-white dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                                        placeholder={t('atlasBoardUrlPlaceholder')}
                                    />
                                </div>

                                <div className="space-y-2">
                                    <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">{t('atlasDataRequest')}</label>
                                    <textarea
                                        value={data.atlasDataRequest || ''}
                                        onChange={(e) => handleChange('atlasDataRequest', e.target.value)}
                                        className="w-full text-xs border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-2 bg-white dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 min-h-[88px] resize-none"
                                        placeholder={t('atlasDataRequestPlaceholder')}
                                    />
                                </div>

                                <div className="space-y-2">
                                    <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">{t('agentSkill')}</label>
                                    <select
                                        value={data.agentSkillId || ''}
                                        onChange={(e) => handleChange('agentSkillId', e.target.value)}
                                        className="w-full text-sm border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-2 bg-white dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                                    >
                                        <option value="">{agentSkills.length ? t('agentSkill') : t('noAgentSkills')}</option>
                                        {agentSkills.map((skill) => (
                                            <option key={skill.id} value={skill.id}>{skill.name || skill.id}</option>
                                        ))}
                                    </select>
                                </div>

                                {agentConfigPreview}

                                <div className="grid grid-cols-1 gap-3">
                                    <div className="space-y-2">
                                        <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">{t('agentOutputName')}</label>
                                        <input
                                            type="text"
                                            value={data.agentOutputName || ''}
                                            onChange={(e) => handleChange('agentOutputName', e.target.value)}
                                            className="w-full text-xs font-mono border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-2 bg-white dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                                            placeholder="monthly-data-analysis.md"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">{t('outputFormat')}</label>
                                        <select
                                            value={data.outputFormat || 'markdown'}
                                            onChange={(e) => handleChange('outputFormat', e.target.value as NonNullable<WorkflowNodeData['outputFormat']>)}
                                            className="w-full text-sm border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-2 bg-white dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                                        >
                                            <option value="markdown">Markdown</option>
                                            <option value="json">JSON</option>
                                            <option value="csv">CSV</option>
                                            <option value="text">Text</option>
                                        </select>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <>
                                <div className="space-y-2">
                                    <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">{t('localFilePathOrName')}</label>
                                    <input
                                        type="text"
                                        value={data.filePath || ''}
                                        onChange={(e) => handleChange('filePath', e.target.value)}
                                        className="w-full text-xs font-mono border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-2 bg-zinc-50 dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                                        placeholder={t('localFilePlaceholder')}
                                    />
                                    <p className="text-[10px] text-zinc-500">{t('localFileHelp')}</p>
                                </div>

                                <div className="relative flex items-center py-2">
                                    <div className="flex-grow border-t border-zinc-200 dark:border-zinc-800"></div>
                                    <span className="flex-shrink-0 mx-4 text-zinc-400 text-xs font-medium">{t('orManualUpload')}</span>
                                    <div className="flex-grow border-t border-zinc-200 dark:border-zinc-800"></div>
                                </div>

                                {!data.fileName ? (
                                    <div
                                        className={`border-2 border-dashed ${data.filePath ? 'border-zinc-200 dark:border-zinc-800 opacity-50' : 'border-zinc-300 dark:border-zinc-700'} rounded-lg p-6 flex flex-col items-center justify-center gap-2 bg-zinc-50 dark:bg-zinc-900/50 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer`}
                                        onClick={() => fileInputRef.current?.click()}
                                    >
                                        <FileUp className="w-6 h-6 text-zinc-400" />
                                        <span className="text-xs text-zinc-500 font-medium tracking-wide">{t('uploadFormatHelp')}</span>
                                        <input
                                            type="file"
                                            className="hidden"
                                            ref={fileInputRef}
                                            onChange={handleFileChange}
                                            accept=".pdf,.txt,.csv"
                                        />
                                    </div>
                                ) : (
                                    <div className="border border-zinc-200 dark:border-zinc-800 rounded-lg p-3 flex items-center justify-between bg-emerald-50/50 dark:bg-emerald-900/10 border-emerald-200 dark:border-emerald-900/30">
                                        <div className="flex items-center gap-3 overflow-hidden">
                                            <div className="p-2 bg-white dark:bg-zinc-950 rounded shadow-sm">
                                                <FileText className="h-4 w-4 text-emerald-500" />
                                            </div>
                                            <div className="truncate text-left">
                                                <p className="text-xs font-medium truncate text-zinc-700 dark:text-zinc-300">{data.fileName}</p>
                                                {data.fileSize && <p className="text-[10px] text-zinc-500">{(data.fileSize / 1024 / 1024).toFixed(2)} MB</p>}
                                            </div>
                                        </div>
                                        <button onClick={clearFile} className="flex-shrink-0 text-zinc-400 hover:text-red-500 p-1">
                                            <X className="h-4 w-4" />
                                        </button>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                )}

                {/* 2. AI Prompt Config */}
                {taskType === 'aiPrompt' && (
                    <div className="space-y-4 animate-in fade-in duration-300">
                        {/* Model Selection */}
                        <div className="space-y-2">
                            <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">{t('aiModel')}</label>
                            <select
                                value={data.model || 'gemini-2.5-flash'}
                                onChange={(e) => handleChange('model', e.target.value)}
                                className="w-full text-sm border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-2 bg-zinc-50 dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                            >
                                <option value="gemini-3.1">Gemini 3.1</option>
                                <option value="gemini-3.0">Gemini 3.0</option>
                                <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
                                <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
                                <option value="gemini-2.0-flash">Gemini 2.0 Flash</option>
                            </select>
                        </div>

                        <div className="space-y-2">
                            <div className="flex flex-col gap-1">
                                <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">{t('aiInstructions')}</label>
                                <span className="text-[10px] text-zinc-500 leading-relaxed">
                                    {t('aiInstructionsHelpPre')}
                                    <code className="bg-zinc-100 dark:bg-zinc-800 px-1 rounded font-mono text-zinc-800 dark:text-zinc-300">{"{{Step_Name}}"}</code>
                                    {t('aiInstructionsHelpMid')}
                                    <code className="bg-zinc-100 dark:bg-zinc-800 px-1 rounded font-mono text-zinc-800 dark:text-zinc-300">{t('aiInstructionsHelpExample')}</code>
                                </span>
                            </div>
                            <textarea
                                className="w-full text-xs font-mono border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-3 bg-zinc-50 dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 min-h-[200px] resize-none leading-relaxed"
                                placeholder={t('aiPromptPlaceholder')}
                                value={data.prompt || ''}
                                onChange={(e) => handleChange('prompt', e.target.value)}
                            />
                        </div>
                    </div>
                )}

                {/* 3. Agent Action Config */}
                {taskType === 'agentAction' && (
                    <div className="space-y-4 animate-in fade-in duration-300">
                        <div className="rounded-xl border border-cyan-100 bg-cyan-50/40 p-3 dark:border-cyan-900/40 dark:bg-cyan-950/10 space-y-4">
                            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-cyan-700 dark:text-cyan-300">
                                <Workflow className="h-4 w-4" />
                                {t('agentRuntimeConfig')}
                            </div>

                            {agentConnectPicker}

                            {/* Removed agentRuntime select field */}

                            <div className="space-y-2">
                                <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">{t('agentSkill')}</label>
                                <select
                                    value={data.agentSkillId || ''}
                                    onChange={(e) => handleChange('agentSkillId', e.target.value)}
                                    className="w-full text-sm border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-2 bg-white dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                                >
                                    <option value="">{agentSkills.length ? t('agentSkill') : t('noAgentSkills')}</option>
                                    {agentSkills.map((skill) => (
                                        <option key={skill.id} value={skill.id}>{skill.name || skill.id}</option>
                                    ))}
                                </select>
                            </div>

                            {agentConfigPreview}

                            <div className="space-y-2">
                                <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">{t('agentInstruction')}</label>
                                <textarea
                                    value={data.agentInstruction || ''}
                                    onChange={(e) => handleChange('agentInstruction', e.target.value)}
                                    className="w-full text-xs border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-3 bg-white dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 min-h-[160px] resize-none leading-relaxed"
                                    placeholder={t('agentInstructionPlaceholder')}
                                />
                            </div>

                            <div className="grid grid-cols-1 gap-3">
                                <div className="space-y-2">
                                    <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">{t('agentOutputName')}</label>
                                    <input
                                        type="text"
                                        value={data.agentOutputName || ''}
                                        onChange={(e) => handleChange('agentOutputName', e.target.value)}
                                        className="w-full text-xs font-mono border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-2 bg-white dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                                        placeholder="monthly-report-memo.md"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">{t('outputFormat')}</label>
                                    <select
                                        value={data.outputFormat || 'markdown'}
                                        onChange={(e) => handleChange('outputFormat', e.target.value as NonNullable<WorkflowNodeData['outputFormat']>)}
                                        className="w-full text-sm border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-2 bg-white dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                                    >
                                        <option value="markdown">Markdown</option>
                                        <option value="docx">DOCX</option>
                                        <option value="json">JSON</option>
                                        <option value="text">Text</option>
                                    </select>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* 4. Output Action Config */}
                {taskType === 'outputAction' && (
                    <div className="space-y-4 animate-in fade-in duration-300">
                        <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">{t('resultDelivery')}</label>

                        <div className="flex items-center justify-between">
                            <span className="text-sm font-medium">{t('showInUiConsole')}</span>
                            <input
                                type="checkbox"
                                checked={data.showInUI !== false}
                                onChange={(e) => handleChange('showInUI', e.target.checked)}
                                className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500"
                            />
                        </div>

                        <div className="flex items-center justify-between">
                            <span className="text-sm font-medium">{t('enableExportMarkdown')}</span>
                            <input
                                type="checkbox"
                                checked={data.exportMarkdown !== false}
                                onChange={(e) => handleChange('exportMarkdown', e.target.checked)}
                                className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500"
                            />
                        </div>

                        <div className="flex items-center justify-between">
                            <span className="text-sm font-medium">{t('enableExportDocx')}</span>
                            <input
                                type="checkbox"
                                checked={data.exportDocx || false}
                                onChange={(e) => handleChange('exportDocx', e.target.checked)}
                                className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500"
                            />
                        </div>

                        <div className="flex items-center justify-between">
                            <span className="text-sm font-medium">{t('enableDownloadTxt')}</span>
                            <input
                                type="checkbox"
                                checked={data.allowDownload || false}
                                onChange={(e) => handleChange('allowDownload', e.target.checked)}
                                className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500"
                            />
                        </div>

                        <div className="space-y-2 pt-2">
                            <span className="text-sm font-medium block">{t('exportFileName')}</span>
                            <input
                                type="text"
                                value={data.exportFileName || ''}
                                onChange={(e) => handleChange('exportFileName', e.target.value)}
                                className="w-full text-sm border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-2 bg-zinc-50 dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                                placeholder="monthly-report-memo"
                            />
                        </div>

                        <div className="space-y-2 pt-2">
                            <span className="text-sm font-medium block">{t('emailResultsTo')}</span>
                            <input
                                type="email"
                                value={data.email || ''}
                                onChange={(e) => handleChange('email', e.target.value)}
                                className="w-full text-sm border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-2 bg-zinc-50 dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                                placeholder="name@company.com"
                            />
                        </div>
                    </div>
                )}

                {/* 4. Task Execution Config */}
                {taskType === 'taskExecution' && (() => {
                    const filteredTasks = availableTasks.filter(task => 
                        task.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                        task.source.toLowerCase().includes(searchQuery.toLowerCase())
                    );
                    const currentIds = data.taskIds || [];

                    return (
                        <div className="space-y-4 animate-in fade-in duration-300">
                            <div className="space-y-3">
                                <div className="flex items-center justify-between mb-1">
                                    <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">{t('selectTask')}</label>
                                    <span className="text-[10px] bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400 px-1.5 py-0.5 rounded-full font-bold">
                                        {t('selectedCount').replace('{count}', currentIds.length.toString())}
                                    </span>
                                </div>
                                
                                <div className="relative group">
                                    <input 
                                        type="text"
                                        placeholder={t('searchTasks')}
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        className="w-full text-xs border border-zinc-200 dark:border-zinc-800 rounded-lg pl-8 pr-3 py-2 bg-zinc-50 dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all opacity-70 focus:opacity-100"
                                    />
                                    <Database className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-zinc-400 group-focus-within:text-indigo-500 transition-colors" />
                                </div>
                                
                                {isLoadingTasks ? (
                                    <div className="text-xs text-zinc-500 animate-pulse">{t('loading')}</div>
                                ) : (
                                    <div className="border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden bg-zinc-50 dark:bg-zinc-900/50 max-h-[300px] overflow-y-auto">
                                        {filteredTasks.length === 0 ? (
                                            <div className="p-4 text-center text-xs text-zinc-500 italic">
                                                {searchQuery ? t('noTasksMatchSearch') : t('noTasksFound')}
                                            </div>
                                        ) : (
                                            <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                                                {filteredTasks.map((task) => {
                                                    const isSelected = currentIds.includes(task.id);
                                                    return (
                                                        <div 
                                                            key={task.id} 
                                                            className={`flex items-center gap-3 p-3 hover:bg-white dark:hover:bg-zinc-800 transition-colors cursor-pointer ${isSelected ? 'bg-white dark:bg-zinc-800' : ''}`}
                                                            onClick={() => {
                                                                let newIds;
                                                                if (isSelected) {
                                                                    newIds = currentIds.filter(id => id !== task.id);
                                                                } else {
                                                                    newIds = [...currentIds, task.id];
                                                                }
                                                                updateNodeData(nodeId, { taskIds: newIds });
                                                            }}
                                                        >
                                                            <input 
                                                                type="checkbox" 
                                                                checked={isSelected}
                                                                readOnly
                                                                className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 pointer-events-none"
                                                            />
                                                            <div className="flex-1 min-w-0">
                                                                <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300 truncate">{task.name}</p>
                                                                <p className="text-[10px] text-zinc-500 uppercase font-bold tracking-tight">{task.source}</p>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>

                            <div className="flex items-center justify-between gap-4">
                                <div className="flex gap-2">
                                    <button 
                                        onClick={() => {
                                            const filteredIds = filteredTasks.map(t => t.id);
                                            const newIds = currentIds.filter(id => !filteredIds.includes(id));
                                            updateNodeData(nodeId, { taskIds: newIds });
                                        }}
                                        className="text-[10px] font-bold text-red-500 hover:text-red-600 uppercase tracking-tight"
                                        disabled={filteredTasks.length === 0}
                                    >
                                        {t('deselectAll')}
                                    </button>
                                    <span className="text-zinc-300 dark:text-zinc-700">|</span>
                                    <button 
                                        onClick={() => {
                                            const filteredIds = filteredTasks.map(t => t.id);
                                            const newIds = Array.from(new Set([...currentIds, ...filteredIds]));
                                            updateNodeData(nodeId, { taskIds: newIds });
                                        }}
                                        className="text-[10px] font-bold text-indigo-500 hover:text-indigo-600 uppercase tracking-tight"
                                        disabled={filteredTasks.length === 0}
                                    >
                                        {t('selectAll')}
                                    </button>
                                </div>
                                {searchQuery && (
                                    <button onClick={() => setSearchQuery('')} className="text-[10px] font-bold text-zinc-400 hover:text-zinc-600 uppercase">{t('clearBtn')}</button>
                                )}
                            </div>
                        </div>
                    );
                })()}

            </div>
        </div>
    );
}

function TaskTypeBtn({
    active,
    onClick,
    icon,
    label,
}: {
    active: boolean;
    onClick: () => void;
    icon: React.ReactNode;
    label: string;
}) {
    return (
        <button
            onClick={onClick}
            className={`flex flex-col items-center justify-center gap-1.5 p-2 rounded-lg border text-xs font-medium transition-all ${active
                ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300 shadow-sm'
                : 'border-zinc-200 dark:border-zinc-800 text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-900 hover:text-zinc-700 dark:hover:text-zinc-300'
                }`}
        >
            {icon}
            <span>{label}</span>
        </button>
    );
}

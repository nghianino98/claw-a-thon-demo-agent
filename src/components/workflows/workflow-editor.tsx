"use client";

import React, { useCallback, useRef, useState, useEffect } from 'react';
import {
    ReactFlow,
    Controls,
    Background,
    Panel,
    ReactFlowProvider,
    useReactFlow,
    BackgroundVariant,
    OnSelectionChangeParams,
    MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { useWorkflowStore, AppNode, WorkflowNodeData } from '@/lib/store/workflow-store';
import { useFileStore } from '@/lib/store/file-store';
import { useRegistryStore } from '@/lib/store/registry-store';
import { apiFetch } from '@/lib/api/client';
import { useAuthStore } from '@/lib/store/auth-store';

import { ActivityNode } from '@/components/workflows/nodes/activity-node';
import { WorkflowSidebar } from '@/components/workflows/workflow-sidebar';
import { WorkflowEdgeSidebar } from '@/components/workflows/workflow-edge-sidebar';

import { Button } from '@/components/ui/button';
import { ArrowLeft, Save, Play, Loader2, X, CheckCircle2, RotateCcw, Database, Cpu, Send, PencilLine, PanelLeftClose, PanelLeftOpen, Clock, ListChecks, Workflow, FileDown } from 'lucide-react';
import Link from 'next/link';
import { useTranslation } from '@/lib/store/i18n-store';

// Register unified custom node type
const nodeTypes = {
    activity: ActivityNode,
};

// Initial nodes if the canvas is empty
const initialNodes: AppNode[] = [
    {
        id: 'node-1',
        type: 'activity',
        position: { x: 100, y: 150 },
        data: {
            label: 'Step 1 - App data',
            taskType: 'dataSource',
            sourceMode: 'atlasMcp',
            outputFormat: 'markdown',
            agentOutputName: 'monthly-data-analysis.md',
            atlasDataRequest: 'Collect current month metrics and context needed for the monthly report.',
        },
    },
    {
        id: 'node-2',
        type: 'activity',
        position: { x: 450, y: 150 },
        data: {
            label: 'Step 2 - Monthly memo',
            taskType: 'agentAction',
            outputFormat: 'markdown',
            agentOutputName: 'monthly-report-memo.md',
            agentInstruction: 'Dựa trên output của Step 1, tạo monthly report memo bằng Markdown, có executive summary, key metrics, insight, risks và next actions.',
        },
    },
    {
        id: 'node-3',
        type: 'activity',
        position: { x: 800, y: 150 },
        data: { label: 'Step 3 - Publish memo', taskType: 'outputAction', showInUI: true, exportMarkdown: true, exportDocx: true, exportFileName: 'monthly-report-memo' },
    },
];

const initialEdges = [
    {
        id: 'edge-node-1-node-2',
        source: 'node-1',
        target: 'node-2',
        animated: true,
        type: 'step',
        markerEnd: { type: MarkerType.ArrowClosed, width: 20, height: 20, color: '#6366f1' },
        style: { stroke: '#6366f1', strokeWidth: 2 }
    },
    {
        id: 'edge-node-2-node-3',
        source: 'node-2',
        target: 'node-3',
        animated: true,
        type: 'step',
        markerEnd: { type: MarkerType.ArrowClosed, width: 20, height: 20, color: '#06b6d4' },
        style: { stroke: '#06b6d4', strokeWidth: 2 }
    },
];

const WORD_MIME_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function escapeXml(value: string) {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function cleanMarkdownLine(value: string) {
    return value
        .replace(/\*\*(.*?)\*\*/g, "$1")
        .replace(/__(.*?)__/g, "$1")
        .replace(/`([^`]+)`/g, "$1")
        .replace(/\[(.*?)\]\((.*?)\)/g, "$1");
}

function paragraphXml(text: string, options: { bold?: boolean; size?: number; bullet?: boolean } = {}) {
    const prefix = options.bullet ? "• " : "";
    const size = options.size || 24;
    return `<w:p><w:pPr><w:spacing w:after="160"/></w:pPr><w:r><w:rPr>${options.bold ? "<w:b/>" : ""}<w:sz w:val="${size}"/></w:rPr><w:t xml:space="preserve">${escapeXml(prefix + text)}</w:t></w:r></w:p>`;
}

function markdownToDocumentXml(markdown: string) {
    const paragraphs = markdown
        .split(/\r?\n/)
        .map((rawLine) => rawLine.trim())
        .map((line) => {
            if (!line) return paragraphXml("");
            if (line.startsWith("### ")) return paragraphXml(cleanMarkdownLine(line.slice(4)), { bold: true, size: 28 });
            if (line.startsWith("## ")) return paragraphXml(cleanMarkdownLine(line.slice(3)), { bold: true, size: 32 });
            if (line.startsWith("# ")) return paragraphXml(cleanMarkdownLine(line.slice(2)), { bold: true, size: 40 });
            const bulletMatch = line.match(/^[-*]\s+(.+)$/);
            if (bulletMatch) return paragraphXml(cleanMarkdownLine(bulletMatch[1]), { bullet: true });
            return paragraphXml(cleanMarkdownLine(line));
        })
        .join("");

    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:wp14="http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:w10="urn:schemas-microsoft-com:office:word" xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" mc:Ignorable="w14 wp14"><w:body>${paragraphs}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`;
}

function makeCrcTable() {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) {
            c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        }
        table[n] = c >>> 0;
    }
    return table;
}

const crcTable = makeCrcTable();

function crc32(bytes: Uint8Array) {
    let crc = 0xffffffff;
    for (const byte of bytes) {
        crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function writeUint16(view: DataView, offset: number, value: number) {
    view.setUint16(offset, value, true);
}

function writeUint32(view: DataView, offset: number, value: number) {
    view.setUint32(offset, value >>> 0, true);
}

function concatBytes(parts: Uint8Array[]) {
    const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
    const output = new Uint8Array(totalLength);
    let offset = 0;
    for (const part of parts) {
        output.set(part, offset);
        offset += part.length;
    }
    return output;
}

function getDosDateTime(date = new Date()) {
    const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
    const year = Math.max(date.getFullYear(), 1980);
    const day = (year - 1980) << 9 | ((date.getMonth() + 1) << 5) | date.getDate();
    return { time, day };
}

function buildZip(files: { name: string; content: string }[]) {
    const encoder = new TextEncoder();
    const localParts: Uint8Array[] = [];
    const centralParts: Uint8Array[] = [];
    let offset = 0;
    const { time, day } = getDosDateTime();

    for (const file of files) {
        const nameBytes = encoder.encode(file.name);
        const dataBytes = encoder.encode(file.content);
        const crc = crc32(dataBytes);

        const localHeader = new Uint8Array(30 + nameBytes.length);
        const localView = new DataView(localHeader.buffer);
        writeUint32(localView, 0, 0x04034b50);
        writeUint16(localView, 4, 20);
        writeUint16(localView, 6, 0);
        writeUint16(localView, 8, 0);
        writeUint16(localView, 10, time);
        writeUint16(localView, 12, day);
        writeUint32(localView, 14, crc);
        writeUint32(localView, 18, dataBytes.length);
        writeUint32(localView, 22, dataBytes.length);
        writeUint16(localView, 26, nameBytes.length);
        writeUint16(localView, 28, 0);
        localHeader.set(nameBytes, 30);
        localParts.push(localHeader, dataBytes);

        const centralHeader = new Uint8Array(46 + nameBytes.length);
        const centralView = new DataView(centralHeader.buffer);
        writeUint32(centralView, 0, 0x02014b50);
        writeUint16(centralView, 4, 20);
        writeUint16(centralView, 6, 20);
        writeUint16(centralView, 8, 0);
        writeUint16(centralView, 10, 0);
        writeUint16(centralView, 12, time);
        writeUint16(centralView, 14, day);
        writeUint32(centralView, 16, crc);
        writeUint32(centralView, 20, dataBytes.length);
        writeUint32(centralView, 24, dataBytes.length);
        writeUint16(centralView, 28, nameBytes.length);
        writeUint16(centralView, 30, 0);
        writeUint16(centralView, 32, 0);
        writeUint16(centralView, 34, 0);
        writeUint16(centralView, 36, 0);
        writeUint32(centralView, 38, 0);
        writeUint32(centralView, 42, offset);
        centralHeader.set(nameBytes, 46);
        centralParts.push(centralHeader);

        offset += localHeader.length + dataBytes.length;
    }

    const centralDirectory = concatBytes(centralParts);
    const end = new Uint8Array(22);
    const endView = new DataView(end.buffer);
    writeUint32(endView, 0, 0x06054b50);
    writeUint16(endView, 4, 0);
    writeUint16(endView, 6, 0);
    writeUint16(endView, 8, files.length);
    writeUint16(endView, 10, files.length);
    writeUint32(endView, 12, centralDirectory.length);
    writeUint32(endView, 16, offset);
    writeUint16(endView, 20, 0);

    return concatBytes([...localParts, centralDirectory, end]);
}

function buildDocxBlob(markdown: string) {
    const zip = buildZip([
        {
            name: "[Content_Types].xml",
            content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
        },
        {
            name: "_rels/.rels",
            content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
        },
        {
            name: "word/document.xml",
            content: markdownToDocumentXml(markdown),
        },
    ]);
    return new Blob([zip], { type: WORD_MIME_TYPE });
}

function safeFileName(value: string, fallback: string) {
    const cleaned = value.trim().replace(/\.[a-z0-9]+$/i, "").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
    return cleaned || fallback;
}

function downloadBlob(blob: Blob, fileName: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function downloadText(content: string, fileName: string, type: string) {
    downloadBlob(new Blob([content], { type }), fileName);
}

type WorkflowTask = {
    id: string;
    name: string;
    source: string;
    [key: string]: unknown;
};

function WorkflowCanvas({ workflowId }: { workflowId: string }) {
    const {
        nodes,
        edges,
        onNodesChange,
        onEdgesChange,
        onConnect,
        onReconnect,
        setNodes,
        setEdges,
        updateNodeData
    } = useWorkflowStore();

    const { getWorkflow, addWorkflow, updateWorkflow, loadWorkflows } = useRegistryStore();

    const reactFlowWrapper = useRef<HTMLDivElement>(null);
    const { screenToFlowPosition, fitView } = useReactFlow();

    const [isExecuting, setIsExecuting] = useState(false);
    const [result, setResult] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [showResultPanel, setShowResultPanel] = useState(false);
    const [hasLoaded, setHasLoaded] = useState(false);
    const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
    const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
    const [isLibraryOpen, setIsLibraryOpen] = useState(false);

    const [localWorkflowName, setLocalWorkflowName] = useState("New Workflow");
    const [isAutoSync, setIsAutoSync] = useState(false);
    const [syncFrequency, setSyncFrequency] = useState<'hourly' | 'daily' | 'weekly'>('daily');
    const [syncTime, setSyncTime] = useState('02:00');
    const [showScheduleSettings, setShowScheduleSettings] = useState(false);
    const [consoleLogs, setConsoleLogs] = useState<{ text: string; type: 'info' | 'error' | 'success' | 'warn' }[]>([]);
    const consoleEndRef = useRef<HTMLDivElement>(null);
    const t = useTranslation();

    // Auto-scroll console to bottom
    useEffect(() => {
        consoleEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [consoleLogs]);

    const addLog = (text: string, type: 'info' | 'error' | 'success' | 'warn' = 'info') => {
        setConsoleLogs(prev => [...prev, { text, type }]);
    };


    useEffect(() => {
        const handleNodeSelected = ((e: CustomEvent<string>) => {
            console.log("CustomEvent caught in editor:", e.detail);
            setSelectedNodeId(e.detail);
        }) as EventListener;

        window.addEventListener('node-selected', handleNodeSelected);
        return () => window.removeEventListener('node-selected', handleNodeSelected);
    }, []);

    // Initialize from the server-backed registry or default
    useEffect(() => {
        let cancelled = false;

        const initializeWorkflow = async () => {
            if (hasLoaded) return;

            const loadedWorkflows = await loadWorkflows();
            const existing = loadedWorkflows.find((workflow) => workflow.id === workflowId) || getWorkflow(workflowId);

            if (cancelled) return;

            if (existing) {
                setLocalWorkflowName(existing.name);
                setIsAutoSync(existing.isAutoSync || false);
                setSyncFrequency(existing.syncFrequency || 'daily');
                setSyncTime(existing.syncTime || '02:00');
                // reset execution statuses on load
                const cleanNodes = existing.nodes.map(n => ({
                    ...n,
                    data: { ...n.data, executionStatus: 'idle' as const, executionTimeMs: undefined, errorMsg: undefined }
                }));
                setNodes(cleanNodes);
                setEdges(existing.edges);
            } else {
                setLocalWorkflowName("Untitled Workflow");
                setNodes(initialNodes);
                setEdges(initialEdges);
            }
            setTimeout(() => fitView({ padding: 0.2 }), 100);
            setHasLoaded(true);
        };

        void initializeWorkflow();

        return () => {
            cancelled = true;
        };
    }, [hasLoaded, workflowId, getWorkflow, loadWorkflows, setNodes, setEdges, fitView]);

    const onDragOver = useCallback((event: React.DragEvent) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
    }, []);

    const onDrop = useCallback(
        (event: React.DragEvent) => {
            event.preventDefault();

            const taskType = event.dataTransfer.getData('application/reactflow');
            if (typeof taskType === 'undefined' || !taskType) {
                return;
            }
            const workflowTaskType = taskType as WorkflowNodeData['taskType'];

            const position = screenToFlowPosition({
                x: event.clientX,
                y: event.clientY,
            });
            const defaultLabels: Record<string, string> = {
                dataSource: 'Input Data',
                aiPrompt: 'AI Processing',
                agentAction: 'Agent Action',
                outputAction: 'Output Action',
                taskExecution: 'Collector Task',
            };

            const newNode: AppNode = {
                id: `node_${Date.now()}`,
                type: 'activity',
                position,
                data: {
                    label: defaultLabels[taskType] || 'New Activity',
                    taskType: workflowTaskType,
                    ...(taskType === 'agentAction' ? { outputFormat: 'markdown' } : {}),
                    ...(taskType === 'outputAction' ? { showInUI: true, exportMarkdown: true, exportDocx: false } : {}),
                },
            };

            setNodes([...nodes, newNode]);
        },
        [nodes, screenToFlowPosition, setNodes]
    );

    const onSelectionChange = useCallback((params: OnSelectionChangeParams) => {
        if (params.nodes.length > 0) {
            setSelectedNodeId(params.nodes[0].id);
        } else {
            setSelectedNodeId(null);
        }
    }, []);

    const handleNameBlur = () => {
        const existing = getWorkflow(workflowId);
        if (existing && localWorkflowName.trim() !== "") {
            updateWorkflow(workflowId, { name: localWorkflowName });
        } else if (existing) {
            setLocalWorkflowName(existing.name); // revert if empty
        }
    };

    const handleSave = () => {
        const existing = getWorkflow(workflowId);
        // Clean execution status before saving
        const cleanNodes = nodes.map(n => ({
            ...n,
            data: { ...n.data, executionStatus: 'idle' as const, executionTimeMs: undefined, errorMsg: undefined }
        }));

        if (!existing) {
            const finalName = localWorkflowName.trim() || "Untitled Workflow";
            const newWorkflow = {
                id: workflowId,
                name: finalName,
                updatedAt: Date.now(),
                nodes: cleanNodes,
                edges,
                isAutoSync,
                syncFrequency,
                syncTime
            };
            addWorkflow(newWorkflow);
            
            // Backend Save
            apiFetch('/api/workflows', {
                method: 'POST',
                body: JSON.stringify(newWorkflow)
            }).then(() => {
                console.log("Workflow Saved to Server");
                alert(t("workflowSaved") || "Workflow Saved!");
            }).catch((err) => {
                console.error("Failed to save workflow:", err);
                alert((err instanceof Error ? err.message : String(err)) || "Failed to save workflow");
            });
        } else {
            const updatedWorkflow = { 
                name: localWorkflowName, 
                nodes: cleanNodes, 
                edges,
                isAutoSync,
                syncFrequency,
                syncTime
            };
            updateWorkflow(workflowId, updatedWorkflow);

            // Backend Save
            apiFetch('/api/workflows', {
                method: 'POST',
                body: JSON.stringify({ id: workflowId, ...updatedWorkflow })
            }).then(() => {
                console.log("Workflow Updated on Server");
                alert(t("workflowUpdated") || "Workflow Updated!");
            }).catch((err) => {
                console.error("Failed to update workflow:", err);
                alert((err instanceof Error ? err.message : String(err)) || "Failed to update workflow");
            });
        }
    };

    const handleReset = () => {
        nodes.forEach(n => {
            updateNodeData(n.id, { executionStatus: 'idle' as const, executionTimeMs: undefined, errorMsg: undefined });
        });
        setResult(null);
        setError(null);
        setShowResultPanel(false);
        setConsoleLogs([]);
    };

    // Helper: consume SSE stream from /api/knowledge-base/crawl and pipe logs
    const streamCrawlTask = async (task: WorkflowTask, onLog: (line: string) => void): Promise<{ success: boolean; filesCount: number; errorMsg?: string }> => {
        let crawlRes: Response;
        try {
            const { authMode, csrfToken } = useAuthStore.getState();
            const headers: Record<string, string> = { 'Content-Type': 'application/json' };
            if (authMode === 'required' && csrfToken) {
                headers['X-CSRF-Token'] = csrfToken;
            }

            crawlRes = await fetch('/api/knowledge-base/crawl', {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    ...task,
                    taskId: task.id,
                    taskName: task.name
                })
            });
        } catch (error: unknown) {
            const detail = error instanceof Error ? error.message : 'network error';
            return {
                success: false,
                filesCount: 0,
                errorMsg: `Mất kết nối tới app server trong lúc chạy "${task.name}". App local có thể đã bị tắt/restart hoặc request stream bị ngắt. Chi tiết: ${detail}`
            };
        }

        if (!crawlRes.ok || !crawlRes.body) {
            const errText = await crawlRes.text().catch(() => 'Unknown error');
            return { success: false, filesCount: 0, errorMsg: errText };
        }

        const reader = crawlRes.body.getReader();
        const decoder = new TextDecoder();
        let filesCount = 0;
        let lastCode = 0;
        let errorMsg = '';
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || !trimmed.startsWith('data:')) continue;
                try {
                    const payload = JSON.parse(trimmed.slice(5).trim());
                    if (payload.type === 'log') {
                        onLog(payload.message || '');
                        if ((payload.message || '').includes('[PROGRESS]')) filesCount++;
                        if ((payload.message || '').includes('[!]') || (payload.message || '').includes('[!!!]')) {
                            errorMsg = payload.message;
                        }
                    } else if (payload.type === 'error') {
                        onLog(payload.message || '');
                        errorMsg = payload.message;
                    } else if (payload.type === 'done') {
                        lastCode = payload.code ?? 0;
                    }
                } catch { /* skip malformed */ }
            }
        }

        return { success: lastCode === 0, filesCount, errorMsg: lastCode !== 0 ? errorMsg : undefined };
    };

    // Sequential Execution Logic
    const handleTestRun = async () => {
        if (isExecuting) return;

        // Reset previous run
        handleReset();
        setShowResultPanel(true);

        const roots = nodes.filter(n => !edges.find(e => e.target === n.id));
        if (roots.length === 0) {
            alert("Circular dependency detected or no nodes found");
            return;
        }

        setIsExecuting(true);
        setError(null);
        setResult(null);

        const wfName = getWorkflow(workflowId)?.name || localWorkflowName || "Workflow";
        addLog(t("wfRunStart").replace("{name}", wfName), 'info');
        addLog(`─────────────────────────────────`, 'info');

        let overallSuccess = true;
        let totalFiles = 0;
        const summaryLines: string[] = [];

        try {
            const orderedNodes: AppNode[] = [];
            let current = roots.find(n => n.data.taskType === 'dataSource') || roots[0];

            while (current) {
                orderedNodes.push(current);
                const nextEdge = edges.find(e => e.source === current.id);
                if (nextEdge) {
                    current = nodes.find(n => n.id === nextEdge.target) as AppNode;
                } else {
                    break;
                }
            }

            if (orderedNodes.length === 0) throw new Error(t("wfRunNoNodes"));

            const dataSourceNode = orderedNodes.find(n => n.data.taskType === 'dataSource');
            const aiPromptNode = orderedNodes.find(n => n.data.taskType === 'aiPrompt');
            const file = dataSourceNode ? useFileStore.getState().files[dataSourceNode.id] : null;
            const filePath = dataSourceNode ? dataSourceNode.data.filePath as string | undefined : null;
            const promptText = aiPromptNode ? aiPromptNode.data.prompt as string : "";

            let finalResult = "";
            const nodeOutputs: Record<string, string> = {};

            for (const node of orderedNodes) {
                const startTime = performance.now();
                updateNodeData(node.id, { executionStatus: 'running' });
                addLog(``, 'info');
                addLog(`⚙ Node: "${node.data.label}" (${node.data.taskType})`, 'info');

                if (node.data.taskType === 'dataSource') {
                    if (node.data.sourceMode === 'atlasMcp') {
                        if (!node.data.mcpConnectionId) {
                            throw new Error(t("wfRunDataSourceNoMcp").replace("{name}", node.data.label || ""));
                        }
                        if (!node.data.atlasBoardUrl && !node.data.atlasDataRequest) {
                            throw new Error(t("wfRunDataSourceNoAtlasUrl").replace("{name}", node.data.label || ""));
                        }

                        addLog(`  → MCP Connection: ${node.data.mcpConnectionId}`, 'info');
                        if (node.data.atlasBoardUrl) addLog(`  → Board: ${node.data.atlasBoardUrl}`, 'info');
                        addLog(t("wfRunDataSourceCallMcp"), 'info');

                        const r = await apiFetch('/api/workflows/mcp-fetch', {
                            method: 'POST',
                            body: JSON.stringify({
                                agentConnectionId: node.data.agentConnectionId || '',
                                mcpConnectionId: node.data.mcpConnectionId || '',
                                boardUrl: node.data.atlasBoardUrl || '',
                                dataRequest: node.data.atlasDataRequest || '',
                                viewId: (node.data as Record<string, unknown>).viewId || '',
                                viewName: (node.data as Record<string, unknown>).viewName || '',
                            }),
                        }) as { ok: boolean; markdown?: string; views?: { name: string; rows: number }[]; message?: string; suggestions?: string[] };

                        if (!r.ok) {
                            const sug = (r.suggestions || []).slice(0, 8).join(', ');
                            throw new Error(`${r.message || t("wfRunDataSourceGetError")}${sug ? ` — gợi ý view: ${sug}` : ''}`);
                        }
                        (r.views || []).forEach((v) => addLog(`    ✓ ${v.name} (~${v.rows} dòng)`, 'success'));
                        addLog(t("wfRunDataSourceSuccess"), 'success');
                        finalResult = r.markdown || '';
                        nodeOutputs[node.id] = finalResult;
                    } else {
                        await new Promise(r => setTimeout(r, 400));
                        addLog(t("wfRunDataSourceReady"), 'success');
                    }
                }
                else if (node.data.taskType === 'taskExecution') {
                    const taskIds = node.data.taskIds || [];
                    if (taskIds.length === 0 && node.data.taskId) taskIds.push(node.data.taskId);
                    if (taskIds.length === 0) throw new Error(`Chưa chọn tác vụ nào trong node: ${node.data.label}`);

                    const tasksData = await apiFetch<WorkflowTask[]>('/api/workflows/tasks');
                    const allTasks: WorkflowTask[] = Array.isArray(tasksData) ? tasksData : [];

                    const executionResults: string[] = [];

                    for (const tid of taskIds) {
                        const task = allTasks.find((t) => t.id === tid);
                        if (!task) {
                            addLog(`  [!] Không tìm thấy tác vụ ID: ${tid}`, 'error');
                            addLog(`      → Task đã bị xóa khỏi Knowledge Base nhưng vẫn còn trong node workflow này.`, 'warn');
                            addLog(`      → Vào chỉnh sửa node và bỏ chọn task ID này để khắc phục.`, 'warn');
                            executionResults.push(`❌ Tác vụ ${tid}: Không tìm thấy (đã bị xóa khỏi hệ thống)`);
                            overallSuccess = false;
                            continue;
                        }

                        addLog(``, 'info');
                        addLog(`  → Đang chạy tác vụ: "${task.name}"`, 'info');

                        const { success, filesCount, errorMsg } = await streamCrawlTask(task, (line) => {
                            if (line.trim()) {
                                const type = line.includes('[!]') || line.includes('[!!!]') ? 'error'
                                    : line.includes('[v]') || line.includes('✓') || line.includes('[OK]') ? 'success'
                                    : line.includes('[*]') ? 'warn'
                                    : 'info';
                                addLog(`    ${line}`, type);
                            }
                        });

                        if (success) {
                            const summary = `✅ "${task.name}": Hoàn thành (${filesCount} tài liệu)`;
                            addLog(`  ${summary}`, 'success');
                            executionResults.push(summary);
                            totalFiles += filesCount;
                        } else {
                            // Phát hiện lỗi API key hết hạn (server trả về HTML thay vì JSON)
                            const isHtmlResponse = errorMsg && (errorMsg.includes('<!DOCTYPE') || errorMsg.includes('<html'));
                            const isGeminiError = errorMsg && errorMsg.includes('GoogleGenerativeAI Error');
                            const isRateLimitError = errorMsg && errorMsg.includes('429');
                            
                            let friendlyError = errorMsg || 'Lỗi không xác định';
                            if (isHtmlResponse) {
                                friendlyError = `⚠ API key đã hết hạn hoặc session bị ngắt — Server trả về trang HTML thay vì dữ liệu. Hãy tạo Personal Access Token mới tại: ${task.url}/plugins/personalaccesstokens/usertokens.action`;
                            } else if (isGeminiError) {
                                friendlyError = `⚠ Lỗi Gemini AI — ${errorMsg?.slice(0, 300)}`;
                            } else if (isRateLimitError) {
                                friendlyError = `⚠ Rate limit (429) — Hệ thống đang bị giới hạn tốc độ gọi API. Thử lại sau vài phút.`;
                            } else {
                                friendlyError = errorMsg?.slice(0, 300) || 'Lỗi không xác định';
                            }
                            
                            const summary = `❌ "${task.name}": Thất bại — ${friendlyError}`;
                            addLog(`  ${summary}`, 'error');
                            executionResults.push(summary);
                            overallSuccess = false;
                        }

                        // Delay nhỏ (2.5s) giữa các task để tránh bị Jira/Confluence Rate Limit (HTTP 429) hoặc block API
                        if (taskIds.indexOf(tid) < taskIds.length - 1) {
                            addLog(`  [⏳] Đợi 2.5s trước khi chạy tác vụ tiếp theo để tránh Rate Limit...`, 'info');
                            await new Promise(resolve => setTimeout(resolve, 2500));
                        }
                    }

                    finalResult = executionResults.join("\n");
                    nodeOutputs[node.id] = finalResult;
                    summaryLines.push(...executionResults);
                }
                else if (node.data.taskType === 'agentAction') {
                    const incomingEdge = edges.find(e => e.target === node.id);
                    const upstreamOutput = incomingEdge ? nodeOutputs[incomingEdge.source] : finalResult;

                    if (!node.data.agentWorkflowId && !node.data.agentSkillId && !node.data.agentInstruction) {
                        throw new Error(`Cần Instruction (hoặc chọn Agent/skill) cho node: ${node.data.label}`);
                    }

                    addLog(`  → Gửi agent Quéo phân tích dữ liệu...`, 'info');
                    const ar = await apiFetch('/api/workflows/agent-run', {
                        method: 'POST',
                        body: JSON.stringify({
                            agentConnectionId: node.data.agentConnectionId || '',
                            workflowId: node.data.agentWorkflowId || '',
                            skillId: node.data.agentSkillId || '',
                            instruction: node.data.agentInstruction
                                || `Phân tích dữ liệu dưới đây và viết báo cáo ${node.data.outputFormat || 'markdown'} súc tích, có số liệu cụ thể.`,
                            upstream: upstreamOutput || '',
                            sessionId: `didi-wf-${node.id}`,
                        }),
                    }) as { ok: boolean; response?: string; mode?: string };

                    addLog(`  ✓ Agent trả kết quả${ar.mode ? ` (mode: ${ar.mode})` : ''}.`, 'success');
                    finalResult = ar.response || '';
                    nodeOutputs[node.id] = finalResult;
                }
                else if (node.data.taskType === 'aiPrompt') {
                    addLog(`  → Đang gửi yêu cầu AI...`, 'info');
                    const formData = new FormData();
                    if (file) formData.append("file", file);
                    if (filePath) formData.append("filePath", filePath);

                    let resolvedPrompt = promptText;
                    const varRegex = /\{\{([^}]+)\}\}/g;
                    resolvedPrompt = resolvedPrompt.replace(varRegex, (match, varName) => {
                        if (varName === 'text') return match;
                        const sourceNode = orderedNodes.find(n => n.data.label === varName);
                        if (sourceNode) {
                            if (sourceNode.data.taskType === 'dataSource') return '{{text}}';
                            if (nodeOutputs[sourceNode.id]) return nodeOutputs[sourceNode.id];
                        }
                        return match;
                    });

                    formData.append("prompt", resolvedPrompt);
                    formData.append("model", node.data.model as string || "gemini-2.5-flash");

                    const data = await apiFetch<{ result: string }>("/api/workflows/execute", { method: "POST", body: formData });
                    addLog(`  ✓ AI xử lý thành công.`, 'success');
                    finalResult = data.result;
                    nodeOutputs[node.id] = finalResult;
                }
                else if (node.data.taskType === 'outputAction') {
                    const baseName = safeFileName(node.data.exportFileName as string || wfName, `workflow-result-${Date.now()}`);
                    if (node.data.exportMarkdown !== false && finalResult) {
                        downloadText(finalResult, `${baseName}.md`, "text/markdown;charset=utf-8");
                        addLog(`  ✓ Đã xuất Markdown: ${baseName}.md`, 'success');
                    }
                    if (node.data.exportDocx && finalResult) {
                        downloadBlob(buildDocxBlob(finalResult), `${baseName}.docx`);
                        addLog(`  ✓ Đã xuất Word: ${baseName}.docx`, 'success');
                    }
                    if (node.data.allowDownload && finalResult) {
                        downloadText(finalResult, `${baseName}.txt`, "text/plain;charset=utf-8");
                        addLog(`  ✓ Đã tải xuống kết quả.`, 'success');
                    }
                    if (node.data.email && typeof node.data.email === 'string' && node.data.email.trim()) {
                        addLog(`  → Đang gửi email tới ${node.data.email}...`, 'info');
                        await apiFetch("/api/workflows/email", {
                            method: "POST",
                            body: JSON.stringify({ to: node.data.email, workflowName: wfName, resultText: finalResult })
                        });
                        addLog(`  ✓ Email đã gửi thành công.`, 'success');
                    }
                    if (node.data.showInUI !== false) {
                        setResult(finalResult);
                    }
                    await new Promise(r => setTimeout(r, 400));
                }

                const endTime = performance.now();
                updateNodeData(node.id, { executionStatus: 'success', executionTimeMs: endTime - startTime });
            }

            // Final summary
            addLog(``, 'info');
            addLog(`─────────────────────────────────`, 'info');
            if (overallSuccess) {
                addLog(`✅ Quy trình hoàn thành thành công!`, 'success');
                if (totalFiles > 0) addLog(`   Tổng tài liệu đã đồng bộ: ${totalFiles}`, 'success');
            } else {
                addLog(`⚠ Quy trình hoàn thành với một số lỗi. Kiểm tra chi tiết bên trên.`, 'warn');
            }

            // Record to history
            await apiFetch('/api/history', {
                method: 'POST',
                body: JSON.stringify({
                    id: Date.now().toString(),
                    taskName: wfName,
                    date: new Date().toISOString(),
                    url: '',
                    status: overallSuccess ? 'success' : 'error',
                    processedFiles: totalFiles,
                    type: 'workflow',
                    errorLog: overallSuccess ? undefined : summaryLines.filter(line => line.includes('❌') || line.includes('[!]')).join('\n')
                })
            }).catch(() => {});

        } catch (err: unknown) {
            console.error(err);
            const message = err instanceof Error ? err.message : "Lỗi không xác định";
            overallSuccess = false;
            addLog(``, 'info');
            addLog(`─────────────────────────────────`, 'info');
            addLog(`❌ Lỗi: ${message}`, 'error');
            setError(message);
            nodes.forEach(n => {
                if (n.data.executionStatus === 'running') {
                    updateNodeData(n.id, { executionStatus: 'error', errorMsg: message });
                }
            });

            // Record error to history
            await apiFetch('/api/history', {
                method: 'POST',
                body: JSON.stringify({
                    id: Date.now().toString(),
                    taskName: getWorkflow(workflowId)?.name || localWorkflowName || "Workflow",
                    date: new Date().toISOString(),
                    url: '',
                    status: 'error',
                    processedFiles: 0,
                    type: 'workflow',
                    errorLog: message
                })
            }).catch(() => {});
        } finally {
            setIsExecuting(false);
        }
    };

    const displayedWorkflowName = getWorkflow(workflowId)?.name || localWorkflowName || "workflow-result";

    return (
        <div className="flex flex-col h-[calc(100vh-73px)] relative" ref={reactFlowWrapper}>
            {/* Editor Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 z-10">
                <div className="flex items-center gap-4">
                    <Link href="/workflows">
                        <Button variant="ghost" size="icon">
                            <ArrowLeft className="h-4 w-4" />
                        </Button>
                    </Link>
                    <div>
                        <div className="flex items-center group relative">
                            <input
                                value={localWorkflowName}
                                onChange={(e) => setLocalWorkflowName(e.target.value)}
                                onBlur={handleNameBlur}
                                className="text-xl font-bold tracking-tight mb-1 bg-transparent border-none outline-none focus:ring-2 focus:ring-indigo-500 rounded px-1 -ml-1 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors w-64"
                                placeholder="Workflow Name"
                            />
                            <PencilLine className="w-4 h-4 text-zinc-400 absolute right-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
                        </div>
                        <div className="flex items-center gap-2 text-xs text-zinc-500">
                            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                            Auto-saving to Local Storage
                        </div>
                    </div>
                </div>
                <div className="flex gap-2 relative">
                    <Button variant="outline" onClick={handleReset} disabled={isExecuting}>
                        <RotateCcw className="mr-2 h-4 w-4" /> Reset
                    </Button>
                    
                    <div className="relative">
                        <Button 
                            variant="outline" 
                            size="icon" 
                            className={isAutoSync ? "bg-indigo-50 border-indigo-200 text-indigo-600" : ""}
                            onClick={() => setShowScheduleSettings(!showScheduleSettings)}
                        >
                            <Clock className="h-4 w-4" />
                        </Button>
                        
                        {showScheduleSettings && (
                            <div className="absolute top-12 right-0 w-80 p-4 bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-2xl z-[100] space-y-4 animate-in fade-in slide-in-from-top-2 duration-200">
                                <div className="flex items-center justify-between">
                                    <h4 className="font-semibold text-sm">{t('workflowSchedule')}</h4>
                                    <input 
                                        type="checkbox" 
                                        checked={isAutoSync} 
                                        onChange={(e) => setIsAutoSync(e.target.checked)}
                                        className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500"
                                    />
                                </div>
                                
                                {isAutoSync && (
                                    <div className="space-y-3 pt-2">
                                        <div className="space-y-1.5">
                                            <label className="text-xs font-medium text-zinc-500">{t('syncFreqLabel')}</label>
                                            <select 
                                                value={syncFrequency} 
                                                onChange={(e) => setSyncFrequency(e.target.value as 'hourly' | 'daily' | 'weekly')}
                                                className="w-full text-sm border border-zinc-200 dark:border-zinc-800 bg-transparent rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                                            >
                                                <option value="hourly">Hourly</option>
                                                <option value="daily">Daily</option>
                                                <option value="weekly">Weekly</option>
                                            </select>
                                        </div>
                                        <div className="space-y-1.5">
                                            <label className="text-xs font-medium text-zinc-500">{t('syncTimeLabel')}</label>
                                            <input 
                                                type="time" 
                                                value={syncTime} 
                                                onChange={(e) => setSyncTime(e.target.value)}
                                                className="w-full text-sm border border-zinc-200 dark:border-zinc-800 bg-transparent rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                                            />
                                        </div>
                                    </div>
                                )}
                                <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800">
                                    <Button variant="ghost" size="sm" className="w-full text-xs" onClick={() => setShowScheduleSettings(false)}>Close</Button>
                                </div>
                            </div>
                        )}
                    </div>

                    <Button variant="outline" onClick={handleSave}>
                        <Save className="mr-2 h-4 w-4" /> Save
                    </Button>
                    <Button
                        className="bg-indigo-600 hover:bg-indigo-700 text-white min-w-[120px]"
                        onClick={handleTestRun}
                        disabled={isExecuting}
                    >
                        {isExecuting ? (
                            <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Running...</>
                        ) : (
                            <><Play className="mr-2 h-4 w-4" /> Test Run</>
                        )}
                    </Button>
                </div>
            </div>

            {/* Main Area */}
            <div className="flex-1 flex overflow-hidden">
                {/* Canvas Area */}
                <div className="flex-1 flex relative">
                    <ReactFlow
                        nodes={nodes}
                        edges={edges}
                        onNodesChange={onNodesChange}
                        onEdgesChange={onEdgesChange}
                        onConnect={onConnect}
                        onReconnect={onReconnect}
                        onSelectionChange={onSelectionChange}
                        onNodeClick={(_, node) => {
                            console.log("ReactFlow onNodeClick:", node.id);
                            setSelectedNodeId(node.id);
                            setSelectedEdgeId(null);
                        }}
                        onEdgeClick={(_, edge) => {
                            console.log("ReactFlow onEdgeClick:", edge.id);
                            setSelectedEdgeId(edge.id);
                            setSelectedNodeId(null);
                        }}
                        onPaneClick={() => {
                            console.log("ReactFlow onPaneClick");
                            setSelectedNodeId(null);
                            setSelectedEdgeId(null);
                        }}
                        nodeTypes={nodeTypes}
                        onDrop={onDrop}
                        onDragOver={onDragOver}
                        className="bg-zinc-50 dark:bg-zinc-900"
                        fitView
                        fitViewOptions={{ padding: 0.2 }}
                        snapToGrid={true}
                        snapGrid={[20, 20]}
                        panOnScroll={true}
                        selectionOnDrag={true}
                        panOnDrag={[1, 2]}
                        defaultEdgeOptions={{
                            type: 'step',
                            markerEnd: { type: MarkerType.ArrowClosed, width: 20, height: 20, color: '#a1a1aa' },
                            style: { strokeWidth: 2, stroke: '#a1a1aa' }
                        }}
                    >
                        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#a1a1aa" />
                        <Controls className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 shadow-md mb-4 ml-4" />

                        {/* Compact Node Toolbar */}
                        <Panel position="top-left" className="m-4">
                            <div className={`bg-white/80 dark:bg-zinc-950/80 backdrop-blur-md p-2 rounded-xl shadow-lg border border-zinc-200/50 dark:border-zinc-800/50 flex flex-col gap-2 pointer-events-auto transition-all duration-300 hover:bg-white dark:hover:bg-zinc-950 overflow-hidden ${isLibraryOpen ? 'w-48' : 'w-[52px]'}`}>
                                <div
                                    className="flex items-center justify-between cursor-pointer px-1 py-1 group/header"
                                    onClick={() => setIsLibraryOpen(!isLibraryOpen)}
                                >
                                    {isLibraryOpen && <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest pl-1">Nodes</span>}
                                    <div className="p-1 rounded bg-zinc-100/0 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors mx-auto">
                                        {isLibraryOpen ? <PanelLeftClose className="w-3.5 h-3.5 text-zinc-500" /> : <PanelLeftOpen className="w-3.5 h-3.5 text-zinc-500" />}
                                    </div>
                                </div>

                                <div className="flex flex-col gap-2 pt-2 border-t border-zinc-100 dark:border-zinc-800/50">
                                    <div
                                        className="p-2 border border-indigo-200 dark:border-indigo-900/50 rounded-lg bg-indigo-50/50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300 cursor-grab hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-colors tooltip-trigger flex items-center gap-3"
                                        onDragStart={(e) => e.dataTransfer.setData('application/reactflow', 'dataSource')}
                                        draggable
                                        title={!isLibraryOpen ? "Input Data" : undefined}
                                    >
                                        <Database className="w-4 h-4 flex-shrink-0" />
                                        {isLibraryOpen && <span className="text-xs font-semibold whitespace-nowrap animate-in fade-in duration-200">Input Data</span>}
                                    </div>
                                    <div
                                        className="p-2 border border-fuchsia-200 dark:border-fuchsia-900/50 rounded-lg bg-fuchsia-50/50 dark:bg-fuchsia-900/20 text-fuchsia-700 dark:text-fuchsia-300 cursor-grab hover:bg-fuchsia-100 dark:hover:bg-fuchsia-900/40 transition-colors tooltip-trigger flex items-center gap-3"
                                        onDragStart={(e) => e.dataTransfer.setData('application/reactflow', 'aiPrompt')}
                                        draggable
                                        title={!isLibraryOpen ? "AI Processing" : undefined}
                                    >
                                        <Cpu className="w-4 h-4 flex-shrink-0" />
                                        {isLibraryOpen && <span className="text-xs font-semibold whitespace-nowrap animate-in fade-in duration-200">AI Processing</span>}
                                    </div>
                                    <div
                                        className="p-2 border border-cyan-200 dark:border-cyan-900/50 rounded-lg bg-cyan-50/50 dark:bg-cyan-900/20 text-cyan-700 dark:text-cyan-300 cursor-grab hover:bg-cyan-100 dark:hover:bg-cyan-900/40 transition-colors tooltip-trigger flex items-center gap-3"
                                        onDragStart={(e) => e.dataTransfer.setData('application/reactflow', 'agentAction')}
                                        draggable
                                        title={!isLibraryOpen ? "Agent Action" : undefined}
                                    >
                                        <Workflow className="w-4 h-4 flex-shrink-0" />
                                        {isLibraryOpen && <span className="text-xs font-semibold whitespace-nowrap animate-in fade-in duration-200">Agent Action</span>}
                                    </div>
                                    <div
                                        className="p-2 border border-emerald-200 dark:border-emerald-900/50 rounded-lg bg-emerald-50/50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 cursor-grab hover:bg-emerald-100 dark:hover:bg-emerald-900/40 transition-colors tooltip-trigger flex items-center gap-3"
                                        onDragStart={(e) => e.dataTransfer.setData('application/reactflow', 'outputAction')}
                                        draggable
                                        title={!isLibraryOpen ? "Output Action" : undefined}
                                    >
                                        <Send className="w-4 h-4 flex-shrink-0" />
                                        {isLibraryOpen && <span className="text-xs font-semibold whitespace-nowrap animate-in fade-in duration-200">Output Action</span>}
                                    </div>
                                    <div
                                        className="p-2 border border-amber-200 dark:border-amber-900/50 rounded-lg bg-amber-50/50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 cursor-grab hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors tooltip-trigger flex items-center gap-3"
                                        onDragStart={(e) => e.dataTransfer.setData('application/reactflow', 'taskExecution')}
                                        draggable
                                        title={!isLibraryOpen ? "Task Run" : undefined}
                                    >
                                        <ListChecks className="w-4 h-4 flex-shrink-0" />
                                        {isLibraryOpen && <span className="text-xs font-semibold whitespace-nowrap animate-in fade-in duration-200">{t('runShort')} Task</span>}
                                    </div>
                                </div>
                            </div>
                        </Panel>
                    </ReactFlow>

                    {/* Live Execution Console Panel */}
                    {showResultPanel && (
                        <div className="absolute top-0 right-0 bottom-0 w-[420px] bg-zinc-950/97 backdrop-blur-md border-l border-zinc-800/60 shadow-2xl flex flex-col z-20 animate-in slide-in-from-right-8 duration-300">
                            {/* Header */}
                            <div className="px-4 py-3 flex items-center justify-between border-b border-zinc-800/60 flex-shrink-0">
                                <div className="flex items-center gap-2.5">
                                    {isExecuting ? (
                                        <Loader2 className="w-3.5 h-3.5 text-indigo-400 animate-spin" />
                                    ) : error ? (
                                        <div className="w-2 h-2 rounded-full bg-red-500" />
                                    ) : (
                                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                                    )}
                                    <h3 className="font-semibold text-[11px] uppercase tracking-wider text-zinc-400">
                                        {isExecuting ? 'Đang thực thi...' : error ? 'Thất bại' : 'Nhật ký thực thi'}
                                    </h3>
                                </div>
                                <Button variant="ghost" size="icon" className="h-6 w-6 rounded-full text-zinc-500 hover:text-white hover:bg-zinc-800" onClick={() => setShowResultPanel(false)}>
                                    <X className="w-3 h-3" />
                                </Button>
                            </div>

                            {/* Console Log Area */}
                            <div className="flex-1 overflow-auto p-3 font-mono text-[11px] leading-relaxed space-y-0.5">
                                {consoleLogs.length === 0 && !isExecuting && (
                                    <div className="text-zinc-600 italic">Chưa có log nào...</div>
                                )}
                                {consoleLogs.map((log, i) => (
                                    <div key={i} className={`whitespace-pre-wrap break-all ${
                                        log.type === 'error' ? 'text-red-400' :
                                        log.type === 'success' ? 'text-emerald-400' :
                                        log.type === 'warn' ? 'text-amber-400' :
                                        'text-zinc-300'
                                    }`}>
                                        {log.text || '\u00a0'}
                                    </div>
                                ))}
                                {isExecuting && (
                                    <div className="text-indigo-400 animate-pulse">▌</div>
                                )}
                                <div ref={consoleEndRef} />
                            </div>

                            {/* Summary footer when done */}
                            {!isExecuting && (error || result) && (
                                <div className={`px-4 py-3 border-t text-xs flex-shrink-0 ${
                                    error
                                        ? 'border-red-900/50 bg-red-950/30 text-red-400'
                                        : 'border-emerald-900/50 bg-emerald-950/20 text-emerald-400'
                                }`}>
                                    {error ? (
                                        <div><strong>❌ Lỗi:</strong> {error}</div>
                                    ) : (
                                        <div className="space-y-3">
                                            <div className="flex items-center gap-2">
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    className="h-7 rounded-lg border-emerald-800 bg-emerald-950/30 px-2 text-[11px] text-emerald-300 hover:bg-emerald-900/40"
                                                    onClick={() => downloadText(result || "", `${safeFileName(displayedWorkflowName, 'workflow-result')}.md`, "text/markdown;charset=utf-8")}
                                                >
                                                    <FileDown className="mr-1 h-3 w-3" />
                                                    Markdown
                                                </Button>
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    className="h-7 rounded-lg border-emerald-800 bg-emerald-950/30 px-2 text-[11px] text-emerald-300 hover:bg-emerald-900/40"
                                                    onClick={() => downloadBlob(buildDocxBlob(result || ""), `${safeFileName(displayedWorkflowName, 'workflow-result')}.docx`)}
                                                >
                                                    <FileDown className="mr-1 h-3 w-3" />
                                                    DOCX
                                                </Button>
                                            </div>
                                            <div className="max-h-40 overflow-auto whitespace-pre-wrap pr-1">{result}</div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                </div>

                {/* Right Sidebar for Configuration */}
                {selectedNodeId && (
                    <WorkflowSidebar
                        nodeId={selectedNodeId!}
                        onClose={() => setSelectedNodeId(null)}
                    />
                )}
                {selectedEdgeId && (
                    <WorkflowEdgeSidebar
                        edgeId={selectedEdgeId}
                        onClose={() => setSelectedEdgeId(null)}
                    />
                )}
            </div>
        </div>
    );
}

export function WorkflowEditor({ workflowId }: { workflowId: string }) {
    return (
        <ReactFlowProvider>
            <WorkflowCanvas workflowId={workflowId} />
        </ReactFlowProvider>
    );
}

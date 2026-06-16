import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
    Connection,
    Edge,
    EdgeChange,
    Node,
    NodeChange,
    addEdge,
    reconnectEdge,
    OnNodesChange,
    OnEdgesChange,
    OnConnect,
    applyNodeChanges,
    applyEdgeChanges,
    MarkerType,
} from '@xyflow/react';

export type WorkflowNodeData = {
    // Common
    label?: string;
    taskType?: 'start' | 'dataSource' | 'aiPrompt' | 'agentAction' | 'outputAction' | 'taskExecution';
    executionStatus?: 'idle' | 'running' | 'success' | 'error';
    executionTimeMs?: number;
    errorMsg?: string;
    taskId?: string; // Legacy: replaced by taskIds for multi-selection
    taskIds?: string[]; // Selected tasks for this node
    color?: string;
    width?: number;
    height?: number | string;

    // DataSourceNode specific
    fileType?: string;
    url?: string;
    filePath?: string;
    fileName?: string;
    fileSize?: number;
    sourceMode?: 'localFile' | 'atlasMcp';
    mcpConnectionId?: string;
    atlasBoardUrl?: string;
    atlasDataRequest?: string;

    // AIPromptNode specific
    prompt?: string;
    model?: string;

    // AgentAction specific
    agentConnectionId?: string;
    agentWorkflowId?: string;
    agentSkillId?: string;
    agentInstruction?: string;
    agentOutputName?: string;
    outputFormat?: 'markdown' | 'docx' | 'json' | 'csv' | 'text';

    // OutputNode specific
    showInUI?: boolean;
    allowDownload?: boolean;
    exportMarkdown?: boolean;
    exportDocx?: boolean;
    exportFileName?: string;
    email?: string;

    [key: string]: unknown;
};

export type AppNode = Node<WorkflowNodeData>;

type WorkflowState = {
    nodes: AppNode[];
    edges: Edge[];
    onNodesChange: OnNodesChange<AppNode>;
    onEdgesChange: OnEdgesChange;
    onConnect: OnConnect;
    onReconnect: (oldEdge: Edge, newConnection: Connection) => void;
    setNodes: (nodes: AppNode[]) => void;
    setEdges: (edges: Edge[]) => void;
    updateNodeData: (nodeId: string, data: Partial<WorkflowNodeData>) => void;
    updateEdge: (edgeId: string, edgeParams: Partial<Edge>) => void;
};

export const colorToHex: Record<string, string> = {
    zinc: '#71717a',
    red: '#ef4444',
    orange: '#f97316',
    amber: '#f59e0b',
    emerald: '#10b981',
    teal: '#14b8a6',
    cyan: '#06b6d4',
    blue: '#3b82f6',
    indigo: '#6366f1',
    violet: '#8b5cf6',
    fuchsia: '#d946ef',
    rose: '#f43f5e'
};

export const hexToColor: Record<string, string> = {
    '#71717a': 'zinc',
    '#ef4444': 'red',
    '#f97316': 'orange',
    '#f59e0b': 'amber',
    '#10b981': 'emerald',
    '#14b8a6': 'teal',
    '#06b6d4': 'cyan',
    '#3b82f6': 'blue',
    '#6366f1': 'indigo',
    '#8b5cf6': 'violet',
    '#d946ef': 'fuchsia',
    '#f43f5e': 'rose'
};

export function getHexColorForNode(node: AppNode) {
    const type = node.data?.taskType;
    const customColor = node.data?.color;
    const colorPrefix = customColor || (
        type === 'dataSource' ? 'indigo' :
            type === 'agentAction' ? 'cyan' :
            type === 'aiPrompt' ? 'fuchsia' :
                type === 'outputAction' ? 'emerald' :
                    type === 'taskExecution' ? 'amber' : 'zinc'
    );
    return colorToHex[colorPrefix] || '#6366f1';
}

export const useWorkflowStore = create<WorkflowState>()(
    persist(
        (set, get) => ({
            nodes: [],
            edges: [],
            onNodesChange: (changes: NodeChange<AppNode>[]) => {
                set({
                    nodes: applyNodeChanges(changes, get().nodes),
                });
            },
            onEdgesChange: (changes: EdgeChange[]) => {
                set({
                    edges: applyEdgeChanges(changes, get().edges),
                });
            },
            onConnect: (connection: Connection) => {
                const sourceNode = get().nodes.find(n => n.id === connection.source);
                const color = sourceNode ? getHexColorForNode(sourceNode) : '#6366f1';
                const edgeParams = {
                    ...connection,
                    animated: true,
                    type: 'step',
                    markerEnd: { type: MarkerType.ArrowClosed, width: 20, height: 20, color },
                    style: { stroke: color, strokeWidth: 2 }
                };
                set({
                    edges: addEdge(edgeParams, get().edges),
                });
            },
            onReconnect: (oldEdge: Edge, newConnection: Connection) => {
                const sourceNode = get().nodes.find(n => n.id === newConnection.source);
                const color = sourceNode ? getHexColorForNode(sourceNode) : '#6366f1';
                const edgeParams = {
                    ...newConnection,
                    animated: true,
                    type: 'step',
                    markerEnd: { type: MarkerType.ArrowClosed, width: 20, height: 20, color },
                    style: { stroke: color, strokeWidth: 2 }
                };
                set({
                    edges: reconnectEdge(oldEdge, edgeParams, get().edges),
                });
            },
            setNodes: (nodes: AppNode[]) => {
                set({ nodes });
            },
            setEdges: (edges: Edge[]) => {
                set({ edges });
            },
            updateNodeData: (nodeId: string, data: Partial<WorkflowNodeData>) => {
                set({
                    nodes: get().nodes.map((node) => {
                        if (node.id === nodeId) {
                            return { ...node, data: { ...node.data, ...data } };
                        }
                        return node;
                    }),
                });
            },
            updateEdge: (edgeId: string, edgeParams: Partial<Edge>) => {
                set({
                    edges: get().edges.map((edge) => {
                        if (edge.id === edgeId) {
                            return { ...edge, ...edgeParams };
                        }
                        return edge;
                    }),
                });
            },
        }),
        {
            name: 'workflow-storage', // name of item in the storage (must be unique)
        }
    )
);

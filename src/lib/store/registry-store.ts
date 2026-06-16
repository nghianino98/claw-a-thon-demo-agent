import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { AppNode } from './workflow-store';
import { Edge } from '@xyflow/react';
import { apiFetch } from '@/lib/api/client';

export type WorkflowMetadata = {
    id: string;
    name: string;
    description?: string;
    updatedAt: number;
    nodes: AppNode[];
    edges: Edge[];
    // Scheduling fields
    isAutoSync?: boolean;
    syncFrequency?: 'hourly' | 'daily' | 'weekly';
    syncTime?: string;
    lastSyncTime?: string;
};

type RegistryState = {
    workflows: WorkflowMetadata[];
    isLoading: boolean;
    loadError: string | null;
    loadWorkflows: () => Promise<WorkflowMetadata[]>;
    addWorkflow: (workflow: WorkflowMetadata) => void;
    updateWorkflow: (id: string, data: Partial<WorkflowMetadata>) => void;
    deleteWorkflow: (id: string) => void;
    getWorkflow: (id: string) => WorkflowMetadata | undefined;
    setWorkflows: (workflows: WorkflowMetadata[]) => void;
};

export const useRegistryStore = create<RegistryState>()(
    persist(
        (set, get) => ({
            workflows: [],
            isLoading: false,
            loadError: null,
            loadWorkflows: async () => {
                set({ isLoading: true, loadError: null });

                try {
                    const workflows = await apiFetch<WorkflowMetadata[]>('/api/workflows', { cache: 'no-store' });
                    if (!Array.isArray(workflows)) {
                        throw new Error('Dữ liệu workflows không hợp lệ');
                    }

                    set({ workflows, isLoading: false, loadError: null });
                    return workflows;
                } catch (error: unknown) {
                    const message = error instanceof Error ? error.message : 'Không thể tải workflows';
                    console.error(message, error);
                    set({ isLoading: false, loadError: message });
                    return get().workflows;
                }
            },
            addWorkflow: (workflow) => set((state) => ({
                workflows: [workflow, ...state.workflows]
            })),
            updateWorkflow: (id, data) => set((state) => ({
                workflows: state.workflows.map(w => w.id === id ? { ...w, ...data, updatedAt: Date.now() } : w)
            })),
            deleteWorkflow: (id) => {
                set((state) => ({
                    workflows: state.workflows.filter(w => w.id !== id)
                }));

                apiFetch('/api/workflows', {
                    method: 'DELETE',
                    body: JSON.stringify({ id })
                }).catch((error) => {
                    console.error('Failed to delete workflow from server', error);
                });
            },
            getWorkflow: (id) => get().workflows.find(w => w.id === id),
            setWorkflows: (workflows) => {
                set({ workflows });
                apiFetch('/api/workflows', {
                    method: 'POST',
                    body: JSON.stringify(workflows)
                }).catch((error) => {
                    console.error('Failed to save workflows order to server', error);
                });
            },
        }),
        {
            name: 'workflow-registry',
            partialize: (state) => ({ workflows: state.workflows }),
        }
    )
);

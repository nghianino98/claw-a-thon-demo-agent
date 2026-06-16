import { create } from "zustand";
import { persist } from "zustand/middleware";
import { apiFetch } from "@/lib/api/client";
import { normalizeAgentConnections, type AgentConnection } from "@/lib/api/agent-connections";

type AgentConnectState = {
  connections: AgentConnection[];
  selectedId: string;
  isLoading: boolean;
  loadError: string | null;
  setSelectedId: (id: string) => void;
  loadConnections: () => Promise<AgentConnection[]>;
  getSelectedConnection: () => AgentConnection | undefined;
};

export const useAgentConnectStore = create<AgentConnectState>()(
  persist(
    (set, get) => ({
      connections: [],
      selectedId: "",
      isLoading: false,
      loadError: null,
      setSelectedId: (id) => set({ selectedId: id }),
      loadConnections: async () => {
        set({ isLoading: true, loadError: null });
        try {
          const connections = normalizeAgentConnections(await apiFetch("/api/agent-connects"));
          const current = get().selectedId;
          const selectedExists = connections.some((connection) => connection.id === current && connection.enabled);
          const fallback =
            connections.find((connection) => connection.enabled && connection.isDefault) ||
            connections.find((connection) => connection.enabled) ||
            connections[0];
          set({
            connections,
            selectedId: selectedExists ? current : fallback?.id || "",
            isLoading: false,
            loadError: null,
          });
          return connections;
        } catch (error) {
          const message = error instanceof Error ? error.message : "Không thể tải Agent Connect.";
          set({ isLoading: false, loadError: message });
          return get().connections;
        }
      },
      getSelectedConnection: () => get().connections.find((connection) => connection.id === get().selectedId),
    }),
    {
      name: "agent-connect-store",
      partialize: (state) => ({ selectedId: state.selectedId }),
    },
  ),
);

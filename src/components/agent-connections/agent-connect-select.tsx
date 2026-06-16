"use client";

import * as React from "react";
import Link from "next/link";
import { Plug } from "lucide-react";
import { useAgentConnectStore } from "@/lib/store/agent-connect-store";

type AgentConnectSelectProps = {
  className?: string;
  onChange?: (id: string) => void;
};

export function AgentConnectSelect({ className = "", onChange }: AgentConnectSelectProps) {
  const { connections, selectedId, isLoading, loadConnections, setSelectedId } = useAgentConnectStore();

  React.useEffect(() => {
    loadConnections();
  }, [loadConnections]);

  const enabledConnections = connections.filter((connection) => connection.enabled);

  const handleChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedId(event.target.value);
    onChange?.(event.target.value);
  };

  if (!isLoading && enabledConnections.length === 0) {
    return (
      <Link
        href="/agent-admin/agent-connects"
        className={`inline-flex h-9 items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 text-xs font-semibold text-amber-800 hover:bg-amber-100 ${className}`}
      >
        <Plug className="h-3.5 w-3.5" />
        Khai báo Agent Connect
      </Link>
    );
  }

  return (
    <label className={`inline-flex items-center gap-2 ${className}`}>
      <span className="hidden text-xs font-bold uppercase tracking-wider text-zinc-500 sm:inline">Agent</span>
      <select
        value={selectedId}
        onChange={handleChange}
        disabled={isLoading}
        className="h-9 min-w-[220px] rounded-lg border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-800 shadow-sm outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 disabled:opacity-60"
      >
        <option value="">{isLoading ? "Đang tải Agent Connect..." : "Chọn Agent Connect"}</option>
        {enabledConnections.map((connection) => (
          <option key={connection.id} value={connection.id}>
            {connection.name || connection.id}
            {connection.isDefault ? " (default)" : ""}
          </option>
        ))}
      </select>
    </label>
  );
}

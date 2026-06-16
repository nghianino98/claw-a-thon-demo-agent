import { resolveRequiredRole, type RouteRule } from "@/lib/rbac/match";

const RULES: RouteRule[] = [
  { method: "POST", pattern: "/admin/api/kb/search-test", role: "viewer" },
  { method: "POST", pattern: "/admin/api/instructions", role: "operator" },
  { method: "POST", pattern: "/admin/api/instructions/:id/activate", role: "operator" },
  { method: "POST", pattern: "/admin/api/skills", role: "operator" },
  { method: "PATCH", pattern: "/admin/api/skills/:id", role: "operator" },
  { method: "POST", pattern: "/admin/api/workflows", role: "operator" },
  { method: "PATCH", pattern: "/admin/api/workflows/:id", role: "operator" },
  { method: "POST", pattern: "/admin/api/workflows/:id/run", role: "operator" },
  { method: "POST", pattern: "/admin/api/runs/:id/cancel", role: "operator" },
  { method: "POST", pattern: "/admin/api/mcp/servers", role: "operator" },
  { method: "PATCH", pattern: "/admin/api/mcp/servers/:id", role: "operator" },
  { method: "DELETE", pattern: "/admin/api/mcp/servers/:id", role: "operator" },
  { method: "PUT", pattern: "/admin/api/mcp/servers/:id/secret", role: "operator" },
  { method: "POST", pattern: "/admin/api/mcp/servers/:id/test", role: "operator" },
  { method: "POST", pattern: "/admin/api/kb/upload", role: "operator" },
  { method: "POST", pattern: "/admin/api/kb/:id/activate", role: "operator" },
  { method: "POST", pattern: "/admin/api/kb/delta", role: "operator" },
  { method: "POST", pattern: "/admin/api/access/:id", role: "operator" },
  { method: "PATCH", pattern: "/admin/api/settings", role: "superadmin" },
  { method: "POST", pattern: "/admin/api/backup", role: "superadmin" },
  { method: "POST", pattern: "/admin/api/backup/restore", role: "superadmin" },
  { method: "GET", pattern: "/admin/api/**", role: "viewer" },
];

export function requiredAgentAdminRole(method: string, path: string) {
  return resolveRequiredRole(RULES, method, path);
}

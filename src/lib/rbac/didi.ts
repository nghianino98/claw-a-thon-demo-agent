import { resolveRequiredRole, type RouteRule } from "@/lib/rbac/match";

const RULES: RouteRule[] = [
  { method: "GET", pattern: "/api/knowledge-base/tasks", role: "viewer" },
  { method: "POST", pattern: "/api/knowledge-base/tasks", role: "operator" },
  { method: "POST", pattern: "/api/knowledge-base/crawl", role: "operator" },
  { method: "POST", pattern: "/api/knowledge-base/test-connection", role: "viewer" },
  { method: "GET", pattern: "/api/knowledge-base/logs", role: "viewer" },
  { method: "POST", pattern: "/api/knowledge-base/open-folder", role: "superadmin" },
  { method: "POST", pattern: "/api/knowledge-base/generate-diagram", role: "operator" },
  { method: "POST", pattern: "/api/knowledge-base/generate-doc-prompt", role: "operator" },
  { method: "POST", pattern: "/api/knowledge-base/generate-image", role: "operator" },
  { method: "POST", pattern: "/api/knowledge-base/push-to-agent", role: "operator" },
  { method: "GET", pattern: "/api/workflows", role: "viewer" },
  { method: "POST", pattern: "/api/workflows", role: "operator" },
  { method: "DELETE", pattern: "/api/workflows", role: "operator" },
  { method: "GET", pattern: "/api/workflows/tasks", role: "viewer" },
  { method: "POST", pattern: "/api/workflows/execute", role: "operator" },
  { method: "POST", pattern: "/api/workflows/email", role: "operator" },
  { method: "GET", pattern: "/api/history", role: "viewer" },
  { method: "POST", pattern: "/api/history", role: "operator" },
  { method: "DELETE", pattern: "/api/history", role: "operator" },
  { method: "GET", pattern: "/api/accounts/**", role: "superadmin" },
  { method: "POST", pattern: "/api/accounts/**", role: "superadmin" },
  { method: "PATCH", pattern: "/api/accounts/**", role: "superadmin" },
  { method: "DELETE", pattern: "/api/accounts/**", role: "superadmin" },
];

export function requiredDidiRole(method: string, path: string) {
  return resolveRequiredRole(RULES, method, path);
}

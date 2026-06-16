import type { Role } from "@/lib/rbac/roles";

export type RouteRule = {
  method: string;
  pattern: string;
  role: Role;
};

function splitPath(path: string) {
  return path.replace(/\/+$/g, "").split("/").filter(Boolean);
}

export function pathMatches(pattern: string, path: string) {
  if (pattern.endsWith("/**")) {
    const prefix = pattern.slice(0, -3);
    return path === prefix || path.startsWith(`${prefix}/`);
  }

  const patternParts = splitPath(pattern);
  const pathParts = splitPath(path);
  if (patternParts.length !== pathParts.length) return false;

  return patternParts.every((part, index) => part.startsWith(":") || part === pathParts[index]);
}

function specificity(pattern: string) {
  return pattern
    .split("/")
    .filter(Boolean)
    .reduce((score, part) => {
      if (part === "**") return score;
      if (part.startsWith(":")) return score + 1;
      return score + 3;
    }, 0);
}

export function resolveRequiredRole(rules: RouteRule[], method: string, path: string): Role | null {
  const normalizedMethod = method.toUpperCase();
  const matches = rules
    .filter((rule) => rule.method === normalizedMethod && pathMatches(rule.pattern, path))
    .sort((a, b) => specificity(b.pattern) - specificity(a.pattern));
  return matches[0]?.role || null;
}

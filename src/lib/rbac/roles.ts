export type Role = "viewer" | "operator" | "superadmin";

export const ROLE_ORDER: Record<Role, number> = {
  viewer: 1,
  operator: 2,
  superadmin: 3,
};

export function hasRole(actual: Role, required: Role) {
  return ROLE_ORDER[actual] >= ROLE_ORDER[required];
}

export function isRole(value: unknown): value is Role {
  return value === "viewer" || value === "operator" || value === "superadmin";
}

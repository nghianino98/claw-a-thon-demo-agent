import * as React from "react";
import { useAuth } from "@/lib/store/auth-store";

export const ROLE_ORDER = {
  viewer: 1,
  operator: 2,
  superadmin: 3,
};

interface CanProps {
  role: "viewer" | "operator" | "superadmin";
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export function Can({ role, children, fallback = null }: CanProps) {
  const { user, authMode } = useAuth();

  // In local mode, bypass authorization gating completely
  if (authMode === "off") {
    return <>{children}</>;
  }

  if (!user) {
    return <>{fallback}</>;
  }

  const userScore = ROLE_ORDER[user.role] || 1;
  const needScore = ROLE_ORDER[role] || 1;

  if (userScore >= needScore) {
    return <>{children}</>;
  }

  return <>{fallback}</>;
}

interface RoleGateProps {
  allowedRoles: ("viewer" | "operator" | "superadmin")[];
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export function RoleGate({ allowedRoles, children, fallback = null }: RoleGateProps) {
  const { user, authMode } = useAuth();

  // In local mode, bypass authorization gating completely
  if (authMode === "off") {
    return <>{children}</>;
  }

  if (!user) {
    return <>{fallback}</>;
  }

  if (allowedRoles.includes(user.role)) {
    return <>{children}</>;
  }

  return <>{fallback}</>;
}


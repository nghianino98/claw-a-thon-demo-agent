import * as React from "react";
import { cn } from "@/lib/utils";

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: "default" | "success" | "danger" | "warning" | "secondary" | "outline";
}

export function Badge({
  children,
  variant = "default",
  className,
  ...props
}: BadgeProps) {
  const styles = {
    default: "bg-[--color-primary-soft] text-[--color-primary] border border-[--color-primary]/10",
    success: "bg-[--color-success-soft] text-[--color-success] border border-[--color-success]/10",
    danger: "bg-[--color-danger-soft] text-[--color-danger] border border-[--color-danger]/10",
    warning: "bg-[--color-warning-soft] text-[--color-warning] border border-[--color-warning]/10",
    secondary: "bg-zinc-100 text-zinc-800 border border-zinc-200",
    outline: "bg-transparent text-zinc-500 border border-zinc-200",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider",
        styles[variant],
        className
      )}
      {...props}
    >
      {children}
    </span>
  );
}

import * as React from "react";
import { cn } from "@/lib/utils";

interface PageShellProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

export function PageShell({ children, className, ...props }: PageShellProps) {
  return (
    <div
      className={cn(
        "flex flex-1 flex-col p-6 min-h-full w-full bg-[--color-surface-muted] text-zinc-900",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

interface PageHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  pulseTitle?: boolean;
}

export function PageHeader({
  title,
  subtitle,
  actions,
  pulseTitle = false,
  className,
  ...props
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8 border-b border-zinc-200/50 pb-5",
        className
      )}
      {...props}
    >
      <div className="space-y-1">
        <h1 className="text-3xl font-extrabold tracking-tight text-zinc-900 animate-slide-in-left">
          <span className={cn("inline-block", pulseTitle && "animate-heartbeat")}>
            {title}
          </span>
        </h1>
        {subtitle && <p className="text-sm text-zinc-500">{subtitle}</p>}
      </div>
      {actions && (
        <div className="flex items-center gap-3 shrink-0 animate-fade-in-up">
          {actions}
        </div>
      )}
    </div>
  );
}

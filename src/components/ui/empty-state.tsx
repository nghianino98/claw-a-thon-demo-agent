import * as React from "react";
import { cn } from "@/lib/utils";
import { Database } from "lucide-react";

interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export function EmptyState({
  title,
  description,
  action,
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center p-8 py-16 bg-white border border-zinc-200 rounded-2xl shadow-sm",
        className
      )}
      {...props}
    >
      <div className="p-4 bg-[--color-primary-soft] text-[--color-primary] rounded-2xl mb-4">
        <Database className="w-8 h-8" />
      </div>
      <h3 className="font-bold text-zinc-900 text-lg mb-1">{title}</h3>
      {description && (
        <p className="text-zinc-500 text-sm max-w-sm mb-6 leading-relaxed">
          {description}
        </p>
      )}
      {action && <div className="animate-fade-in-up">{action}</div>}
    </div>
  );
}

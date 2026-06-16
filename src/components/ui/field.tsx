import * as React from "react";
import { cn } from "@/lib/utils";
import { LucideIcon } from "lucide-react";

interface FieldProps extends React.HTMLAttributes<HTMLDivElement> {
  label?: string;
  icon?: LucideIcon;
  hint?: string;
  error?: string;
  required?: boolean;
}

export const Field = React.forwardRef<HTMLDivElement, FieldProps>(
  ({ label, icon: Icon, hint, error, required, children, className, ...props }, ref) => {
    return (
      <div ref={ref} className={cn("space-y-1.5 w-full", className)} {...props}>
        {label && (
          <label className="text-sm font-semibold text-zinc-700 flex items-center gap-1.5">
            {Icon && <Icon className="w-4 h-4 text-[--color-primary]" />}
            <span>
              {label}
              {required && <span className="text-[--color-danger] ml-0.5">*</span>}
            </span>
          </label>
        )}
        <div className="relative">
          {children}
        </div>
        {error ? (
          <p className="text-xs font-semibold text-[--color-danger] animate-fade-in-up">
            {error}
          </p>
        ) : hint ? (
          <p className="text-xs text-zinc-500">
            {hint}
          </p>
        ) : null}
      </div>
    );
  }
);

Field.displayName = "Field";

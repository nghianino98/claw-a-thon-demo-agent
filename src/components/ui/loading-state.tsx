import * as React from "react";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

interface LoadingStateProps extends React.HTMLAttributes<HTMLDivElement> {
  message?: string;
  size?: "sm" | "md" | "lg";
}

export function LoadingState({
  message = "Đang tải dữ liệu...",
  size = "md",
  className,
  ...props
}: LoadingStateProps) {
  const sizeClasses = {
    sm: "w-6 h-6 border-2",
    md: "w-10 h-10 border-4",
    lg: "w-16 h-16 border-4",
  };

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center p-8 py-16 bg-white border border-zinc-200 rounded-2xl shadow-sm min-h-[300px]",
        className
      )}
      {...props}
    >
      <div className="relative flex items-center justify-center mb-4">
        <Loader2
          className={cn(
            "animate-spin text-[--color-primary]",
            size === "sm" && "w-6 h-6",
            size === "md" && "w-10 h-10",
            size === "lg" && "w-16 h-16"
          )}
        />
      </div>
      <p className="text-zinc-500 font-semibold text-sm animate-pulse">
        {message}
      </p>
    </div>
  );
}

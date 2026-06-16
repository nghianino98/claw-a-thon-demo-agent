"use client";

import * as React from "react";
import { useToastStore } from "@/lib/store/toast-store";
import { CheckCircle2, AlertCircle, AlertTriangle, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

export function ToastContainer() {
  const { toasts, removeToast } = useToastStore();

  if (toasts.length === 0) return null;

  const icons = {
    success: <CheckCircle2 className="w-5 h-5 text-[--color-success]" />,
    error: <AlertCircle className="w-5 h-5 text-[--color-danger]" />,
    warning: <AlertTriangle className="w-5 h-5 text-[--color-warning]" />,
    info: <Info className="w-5 h-5 text-[--color-primary]" />,
  };

  const bgStyles = {
    success: "border-green-200 bg-green-50/90 text-green-900",
    error: "border-red-200 bg-red-50/90 text-red-900",
    warning: "border-amber-200 bg-amber-50/90 text-amber-900",
    info: "border-blue-200 bg-blue-50/90 text-blue-900",
  };

  return (
    <div className="fixed bottom-5 right-5 z-[100] flex flex-col gap-3 max-w-md w-full">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={cn(
            "flex items-start gap-3 p-4 rounded-xl border shadow-lg backdrop-blur-sm transition-all duration-300 animate-fade-in-up",
            bgStyles[toast.type]
          )}
        >
          <div className="shrink-0 mt-0.5">{icons[toast.type]}</div>
          <p className="flex-1 text-sm font-semibold leading-relaxed">
            {toast.message}
          </p>
          <button
            onClick={() => removeToast(toast.id)}
            className="p-1 hover:bg-zinc-200/50 rounded-lg transition-colors cursor-pointer shrink-0"
          >
            <X className="w-4 h-4 opacity-55" />
          </button>
        </div>
      ))}
    </div>
  );
}

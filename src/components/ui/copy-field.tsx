"use client";

import * as React from "react";
import { Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface CopyFieldProps extends React.HTMLAttributes<HTMLDivElement> {
  value: string;
  placeholder?: string;
  hideValue?: boolean;
}

export function CopyField({
  value,
  placeholder = "Không có giá trị",
  hideValue = false,
  className,
  ...props
}: CopyFieldProps) {
  const [copied, setCopied] = React.useState(false);

  const handleCopy = async () => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy text:", err);
    }
  };

  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 w-full",
        className
      )}
      {...props}
    >
      <input
        type={hideValue && !copied ? "password" : "text"}
        readOnly
        value={value || ""}
        placeholder={placeholder}
        className="flex-1 bg-transparent text-sm font-mono focus:outline-none select-all text-zinc-700"
      />
      <button
        type="button"
        onClick={handleCopy}
        disabled={!value}
        className="p-1.5 hover:bg-zinc-200 text-zinc-500 hover:text-zinc-950 rounded-lg transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {copied ? (
          <Check className="w-4 h-4 text-[--color-success]" />
        ) : (
          <Copy className="w-4 h-4" />
        )}
      </button>
    </div>
  );
}

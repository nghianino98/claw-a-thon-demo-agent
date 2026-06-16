"use client";

import * as React from "react";
import dynamic from "next/dynamic";

const MDEditor = dynamic(() => import("@uiw/react-md-editor"), { ssr: false });

interface MarkdownEditorProps {
  value: string;
  onChange: (val?: string) => void;
  preview?: "edit" | "preview" | "live";
  height?: number;
}

export function MarkdownEditor({
  value,
  onChange,
  preview = "live",
  height = 400,
}: MarkdownEditorProps) {
  return (
    <div className="w-full border border-zinc-200 rounded-xl overflow-hidden shadow-sm bg-white" data-color-mode="light">
      <MDEditor
        value={value}
        onChange={onChange}
        preview={preview}
        height={height}
        className="!border-none"
      />
    </div>
  );
}

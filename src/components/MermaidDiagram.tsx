"use client";

import React, { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';

mermaid.initialize({
    startOnLoad: true,
    theme: 'default',
    securityLevel: 'loose',
});

interface MermaidProps {
    chart: string;
}

export default function MermaidDiagram({ chart }: MermaidProps) {
    const ref = useRef<HTMLDivElement>(null);
    const [svg, setSvg] = useState<string>('');

    useEffect(() => {
        if (chart) {
            try {
                mermaid.render(`mermaid-${Math.random().toString(36).substring(2, 9)}`, chart)
                    .then((result) => {
                        setSvg(result.svg);
                    })
                    .catch(e => {
                        console.error("Mermaid error:", e);
                        setSvg(`<div class="text-red-500 font-mono text-sm">Lỗi Render Biểu Đồ: Thử lại với dữ liệu rõ ràng hơn.</div>`);
                    });
            } catch (err: any) {
                setSvg(`<div class="text-red-500 font-mono text-sm">Lỗi Render Biểu Đồ: Cú pháp sơ đồ do hệ thống sinh ra bị lỗi.</div>`);
            }
        }
    }, [chart]);

    if (!chart) return null;

    return (
        <div
            ref={ref}
            className="flex justify-center items-center bg-gray-50 border border-gray-200 rounded-xl p-8 overflow-x-auto w-full mb-8 shadow-inner"
            dangerouslySetInnerHTML={{ __html: svg }}
        />
    );
}

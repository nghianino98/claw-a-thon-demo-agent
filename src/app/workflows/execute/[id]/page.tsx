"use client";

import { use, useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, Upload, File, X, Play, Loader2, Download, Mail, CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { Input } from "@/components/ui/input";

// Note: In a real app we'd fetch this using the params
const mockWorkflowData = {
    name: "Invoice Data Extractor (Demo)",
    description: "Extracts vendor name, total amount, and date from PDF/TXT files.",
    prompt: "You are an expert data extraction assistant. Extract the vendor name, total amount, and date from the following content: {{text}}\n\nFormat the output as clean text or markdown."
};

export default function ExecuteWorkflowPage({
    params,
}: {
    params: Promise<{ id: string }>
}) {
    const { id } = use(params);
    const [file, setFile] = useState<File | null>(null);
    const [isHovering, setIsHovering] = useState(false);
    const [isExecuting, setIsExecuting] = useState(false);
    const [result, setResult] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isSendingEmail, setIsSendingEmail] = useState(false);
    const [emailSent, setEmailSent] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        setIsHovering(true);
    };

    const handleDragLeave = () => {
        setIsHovering(false);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsHovering(false);

        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            setFile(e.dataTransfer.files[0]);
        }
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            setFile(e.target.files[0]);
        }
    };

    const executeWorkflow = async () => {
        if (!file) return;

        setIsExecuting(true);
        setResult(null);
        setError(null);
        setEmailSent(false);

        try {
            const formData = new FormData();
            formData.append("file", file);
            formData.append("prompt", mockWorkflowData.prompt);

            const response = await fetch("/api/workflows/execute", {
                method: "POST",
                body: formData,
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || "Failed to execute workflow");
            }

            setResult(data.result);
        } catch (err: any) {
            console.error("Execution failed:", err);
            setError(err.message || "An unexpected error occurred");
        } finally {
            setIsExecuting(false);
        }
    };

    const handleDownload = () => {
        if (!result) return;
        const blob = new Blob([result], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `result-${file?.name || "workflow"}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const handleSendEmail = async () => {
        if (!result) return;
        const email = window.prompt("Enter email address to send results to:");
        if (!email) return;

        setIsSendingEmail(true);
        try {
            const response = await fetch("/api/workflows/email", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    to: email,
                    workflowName: mockWorkflowData.name,
                    resultText: result
                })
            });

            const data = await response.json();
            if (!response.ok) throw new Error(data.error || "Failed to send email");

            setEmailSent(true);
            setTimeout(() => setEmailSent(false), 3000);
        } catch (err: any) {
            alert("Email sending failed: " + (err.message || "Unknown error"));
        } finally {
            setIsSendingEmail(false);
        }
    };

    return (
        <div className="space-y-8 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <div className="flex items-center gap-4">
                <Link href="/workflows">
                    <Button variant="ghost" size="icon">
                        <ArrowLeft className="h-4 w-4" />
                    </Button>
                </Link>
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Execute: {mockWorkflowData.name}</h1>
                    <p className="text-zinc-500 dark:text-zinc-400 mt-1">
                        {mockWorkflowData.description}
                    </p>
                </div>
            </div>

            <div className="grid gap-8 md:grid-cols-[1fr_1fr]">
                <div className="space-y-8">
                    {/* Input Configuration */}
                    <Card>
                        <CardHeader>
                            <CardTitle>Input Data</CardTitle>
                            <CardDescription>Upload a file to process with this workflow.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            {!file ? (
                                <div
                                    className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer
                    ${isHovering
                                            ? "border-indigo-500 bg-indigo-50/50 dark:bg-indigo-900/10"
                                            : "border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900/50"
                                        }
                  `}
                                    onDragOver={handleDragOver}
                                    onDragLeave={handleDragLeave}
                                    onDrop={handleDrop}
                                    onClick={() => fileInputRef.current?.click()}
                                >
                                    <div className="mx-auto w-12 h-12 rounded-full bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center mb-4 text-indigo-600 dark:text-indigo-400">
                                        <Upload className="h-6 w-6" />
                                    </div>
                                    <h3 className="text-sm font-semibold mb-1">Click to upload or drag and drop</h3>
                                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                                        Supported formats: PDF, TXT, CSV (Max 10MB)
                                    </p>
                                    <input
                                        type="file"
                                        className="hidden"
                                        ref={fileInputRef}
                                        onChange={handleFileChange}
                                        accept=".pdf,.txt,.csv"
                                    />
                                </div>
                            ) : (
                                <div className="border border-zinc-200 dark:border-zinc-800 rounded-lg p-4 flex items-center justify-between bg-zinc-50 dark:bg-zinc-900/50">
                                    <div className="flex items-center gap-3 overflow-hidden">
                                        <div className="p-2 bg-white dark:bg-zinc-950 rounded shadow-sm border border-zinc-100 dark:border-zinc-800">
                                            <File className="h-5 w-5 text-indigo-500" />
                                        </div>
                                        <div className="truncate">
                                            <p className="text-sm font-medium truncate">{file.name}</p>
                                            <p className="text-xs text-zinc-500">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                                        </div>
                                    </div>
                                    <Button variant="ghost" size="icon" onClick={() => setFile(null)} className="flex-shrink-0 text-zinc-500 hover:text-red-500">
                                        <X className="h-4 w-4" />
                                    </Button>
                                </div>
                            )}
                            {error && (
                                <div className="mt-4 p-3 bg-red-50 dark:bg-red-950/50 text-red-600 dark:text-red-400 text-sm rounded-md border border-red-200 dark:border-red-900">
                                    {error}
                                </div>
                            )}
                        </CardContent>
                        <CardFooter>
                            <Button
                                onClick={executeWorkflow}
                                disabled={!file || isExecuting}
                                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white"
                            >
                                {isExecuting ? (
                                    <>
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        Processing...
                                    </>
                                ) : (
                                    <>
                                        <Play className="mr-2 h-4 w-4" />
                                        Run Workflow
                                    </>
                                )}
                            </Button>
                        </CardFooter>
                    </Card>
                </div>

                <div className="space-y-8">
                    {/* Output Display */}
                    <Card className="h-full flex flex-col">
                        <CardHeader>
                            <CardTitle>Results</CardTitle>
                            <CardDescription>Output from the AI processing will appear here.</CardDescription>
                        </CardHeader>
                        <CardContent className="flex-1 flex flex-col">
                            {result ? (
                                <div className="space-y-4 h-full flex flex-col">
                                    <div className="relative flex-1 bg-zinc-950 text-zinc-50 p-4 rounded-md font-mono text-sm overflow-auto max-h-[400px]">
                                        <pre className="whitespace-pre-wrap font-sans text-sm">
                                            {result}
                                        </pre>
                                    </div>

                                    <div className="flex gap-2 pt-4 border-t border-zinc-100 dark:border-zinc-800">
                                        <Button variant="outline" className="flex-1" onClick={handleDownload}>
                                            <Download className="mr-2 h-4 w-4" /> Download .txt
                                        </Button>
                                        <Button variant="outline" className="flex-1" onClick={handleSendEmail} disabled={isSendingEmail || emailSent}>
                                            {isSendingEmail ? (
                                                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Sending...</>
                                            ) : emailSent ? (
                                                <><CheckCircle2 className="mr-2 h-4 w-4 text-green-500" /> Sent!</>
                                            ) : (
                                                <><Mail className="mr-2 h-4 w-4" /> Send Email</>
                                            )}
                                        </Button>
                                    </div>
                                </div>
                            ) : (
                                <div className="flex-1 flex flex-col items-center justify-center text-center p-8 border-2 border-dashed border-zinc-200 dark:border-zinc-800 rounded-lg bg-zinc-50/50 dark:bg-zinc-900/20 text-zinc-500">
                                    {isExecuting ? (
                                        <>
                                            <Loader2 className="h-8 w-8 animate-spin mb-4 text-indigo-500" />
                                            <p className="text-sm">The AI is analyzing your document...</p>
                                            <p className="text-xs mt-1">This usually takes 5-10 seconds depending on file size.</p>
                                        </>
                                    ) : (
                                        <>
                                            <div className="w-12 h-12 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center mb-4">
                                                <File className="h-6 w-6 text-zinc-400" />
                                            </div>
                                            <p className="text-sm">Upload a file and run the workflow to see results.</p>
                                        </>
                                    )}
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
}

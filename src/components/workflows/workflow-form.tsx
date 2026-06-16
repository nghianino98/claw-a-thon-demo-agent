"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, Save, Play } from "lucide-react";
import Link from "next/link";

interface WorkflowFormProps {
    initialData?: any;
    isEditing?: boolean;
}

export function WorkflowForm({ initialData, isEditing = false }: WorkflowFormProps) {
    return (
        <div className="space-y-8 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <Link href="/workflows">
                        <Button variant="ghost" size="icon">
                            <ArrowLeft className="h-4 w-4" />
                        </Button>
                    </Link>
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight">
                            {isEditing ? "Edit Workflow" : "Create New Workflow"}
                        </h1>
                        <p className="text-zinc-500 dark:text-zinc-400 mt-1">
                            Configure how your AI workflow processes input data.
                        </p>
                    </div>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline">
                        <Save className="mr-2 h-4 w-4" /> Save Draft
                    </Button>
                    <Button>
                        <Play className="mr-2 h-4 w-4" /> Save & Build
                    </Button>
                </div>
            </div>

            <div className="grid gap-8 md:grid-cols-[2fr_1fr]">
                <div className="space-y-8">
                    {/* General Information */}
                    <Card>
                        <CardHeader>
                            <CardTitle>General Information</CardTitle>
                            <CardDescription>Basic details about your workflow.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="space-y-2">
                                <label className="text-sm font-medium leading-none">Workflow Name</label>
                                <Input placeholder="e.g., Invoice Data Extractor" defaultValue={initialData?.name} />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium leading-none">Description (Optional)</label>
                                <Textarea
                                    placeholder="Describe what this workflow does..."
                                    defaultValue={initialData?.description}
                                    className="resize-none"
                                />
                            </div>
                        </CardContent>
                    </Card>

                    {/* Prompt Configuration */}
                    <Card>
                        <CardHeader>
                            <CardTitle>AI Instructions (Prompt)</CardTitle>
                            <CardDescription>
                                Define the instructions the AI should follow. Use {"{{text}}"} to reference the uploaded file's content.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="space-y-2">
                                <div className="flex justify-between items-center">
                                    <label className="text-sm font-medium leading-none">System Prompt</label>
                                    <span className="text-xs text-zinc-500 bg-zinc-100 dark:bg-zinc-800 px-2 py-1 rounded">Available variables: {"{{text}}"}</span>
                                </div>
                                <Textarea
                                    placeholder="e.g., You are an expert data extraction assistant. Extract the vendor name, total amount, and date from the following content: {{text}}"
                                    defaultValue={initialData?.prompt}
                                    className="min-h-[200px] font-mono text-sm"
                                />
                            </div>
                        </CardContent>
                    </Card>
                </div>

                <div className="space-y-8">
                    {/* Output Configuration */}
                    <Card>
                        <CardHeader>
                            <CardTitle>Output Settings</CardTitle>
                            <CardDescription>Configure how you receive results.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {/* Note: In a real app we would use Switch/Checkbox components here */}
                            <div className="flex items-center justify-between p-3 border border-zinc-200 dark:border-zinc-800 rounded-lg">
                                <div className="space-y-0.5">
                                    <label className="text-sm font-medium">Show in UI</label>
                                    <p className="text-xs text-zinc-500">Display results immediately after execution</p>
                                </div>
                                <div className="h-5 w-5 bg-indigo-500 rounded border border-indigo-600 shadow-sm flex items-center justify-center">
                                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                                        <path d="M10 3L4.5 8.5L2 6" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                    </svg>
                                </div>
                            </div>

                            <div className="flex items-center justify-between p-3 border border-zinc-200 dark:border-zinc-800 rounded-lg">
                                <div className="space-y-0.5">
                                    <label className="text-sm font-medium">Allow Download</label>
                                    <p className="text-xs text-zinc-500">Enable downloading results as .txt</p>
                                </div>
                                <div className="h-5 w-5 bg-indigo-500 rounded border border-indigo-600 shadow-sm flex items-center justify-center">
                                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                                        <path d="M10 3L4.5 8.5L2 6" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                    </svg>
                                </div>
                            </div>

                            <div className="space-y-3 pt-4 border-t border-zinc-200 dark:border-zinc-800">
                                <div className="space-y-0.5">
                                    <label className="text-sm font-medium">Email Notification (Optional)</label>
                                    <p className="text-xs text-zinc-500">Send results to an email address</p>
                                </div>
                                <Input placeholder="name@example.com" type="email" />
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
}

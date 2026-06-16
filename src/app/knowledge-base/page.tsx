"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import {
    Database, Play, CheckCircle2, AlertCircle, Folder,
    Settings, Settings2, Key, FileText, ChevronRight, Loader2, Link as LinkIcon, Check,
    Plus, Trash2, Edit2, ArrowLeft, Bot, Image as ImageIcon, Network, Download, Copy,
    LayoutGrid, List, GripVertical, Clock, Cpu, Activity, FileCode2, FileDown,
    Search, X, Save
} from "lucide-react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  rectSortingStrategy,
  verticalListSortingStrategy,
  useSortable
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import dynamic from 'next/dynamic';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import MermaidDiagram from '@/components/MermaidDiagram';

const MDEditor = dynamic(() => import('@uiw/react-md-editor'), { ssr: false });

type LogEntry = {
    type: 'log' | 'error' | 'done' | 'llm_chunk' | 'cost_estimation';
    message?: string;
    code?: number;
    inputTokens?: number;
    outputTokens?: number;
};

type CrawlRule = {
    id: string;
    keywords: string;
    parentUrl: string;
    includeChildren: boolean;
};

type CrawlTask = {
    id: string;
    name: string;
    source: 'confluence' | 'gitlab' | 'jira';
    url: string;
    username: string;
    apiKey: string;
    rules: CrawlRule[];
    formats: string[];
    outputDir: string;
    queryPrompt?: string;
    modelSelection?: string;
    downloadFiles?: boolean;
    enableAiProcessing?: boolean;
    isAutoSync?: boolean;
    syncFrequency?: string;
    syncTime?: string;
    lastSyncTime?: string | null;
    projectId?: string;
    groupId?: string;
    branch?: string;
    projectKey?: string;
    jql?: string;
};

import { useTranslation, useI18nStore } from "@/lib/store/i18n-store";
import { useSettingsStore, CrawlerSource } from "@/lib/store/settings-store";
import { useAuth, useAuthStore } from "@/lib/store/auth-store";
import { ConfluenceIcon, JiraIcon, GitLabIcon } from "@/components/ui/brand-icons";
import Link from "next/link";

const ALLOWED_PREFIXES: Record<string, string[]> = {
  confluence: ["02. Context/Confluence", "03. Fact/Confluence"],
  jira: ["02. Context/Jira", "03. Fact/Jira", "03. Fact/CS Ticket"],
  gitlab: ["03. Fact/Source Code", "02. Context/GitLab"],
};

function SortableTaskCard({
    task,
    layout,
    onLoad,
    onCopy,
    onDelete,
    onRun,
    isManualSort,
    t,
    columns,
    columnWeights,
    totalWeight
}: {
    task: CrawlTask,
    layout: 'gallery' | 'list',
    onLoad: (id: string) => void,
    onCopy: (t: CrawlTask, e: React.MouseEvent) => void,
    onDelete: (id: string, e: React.MouseEvent) => void,
    onRun: (t: CrawlTask, e: React.MouseEvent) => void,
    isManualSort: boolean,
    t: any,
    columns?: any,
    columnWeights?: any,
    totalWeight?: number
}) {
    const getColWidth = (key: string) => {
        if (!columns || !columnWeights || !totalWeight) return 'auto';
        return `${(columnWeights[key] / totalWeight) * 100}%`;
    };
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id, disabled: !isManualSort });
    const style = { transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 10 : 1, opacity: isDragging ? 0.8 : 1 };

    if (layout === 'list') {
        return (
            <div
                ref={setNodeRef} style={style}
                className="bg-white hover:bg-blue-50/40 transition-colors overflow-hidden flex items-center px-6 py-4 gap-4 group"
            >
                {/* Dragger Column - Fixed Width */}
                <div className="w-10 shrink-0 flex items-center justify-center">
                    {isManualSort && (
                        <div {...attributes} {...(listeners as any)} className="text-gray-300 hover:text-gray-500 cursor-grab active:cursor-grabbing p-1 touch-none">
                            <GripVertical className="w-5 h-5" />
                        </div>
                    )}
                </div>

                <div 
                    className="flex-1 min-w-0 flex items-center gap-6 cursor-pointer"
                    onClick={() => onLoad(task.id)}
                >
                    {/* Tên tác vụ */}
                    {(!columns || columns.name) && (
                        <div style={{ width: getColWidth('name') }} className="min-w-[200px]">
                            <h3 className="text-sm font-semibold text-gray-900 mb-0.5 line-clamp-1 group-hover:text-zalopay-blue transition-colors">
                                {task.name}
                            </h3>
                            <div className="flex items-center gap-1.5 text-xs text-gray-400">
                                <LinkIcon className="w-3 h-3 shrink-0" />
                                <span className="truncate" title={task.url}>{task.url}</span>
                            </div>
                        </div>
                    )}

                    {/* Nền tảng */}
                    {(!columns || columns.platform) && (
                        <div style={{ width: getColWidth('platform') }} className="min-w-[80px] hidden sm:flex items-center gap-2">
                            {task.source === 'confluence' && (
                                <span className="flex items-center gap-1.5 px-2 py-1 bg-blue-50 text-[#0144DB] border border-blue-100 rounded-lg text-[10px] font-bold uppercase tracking-tight">
                                    <ConfluenceIcon className="w-3 h-3 text-[#0144DB]" /> Conf
                                </span>
                            )}
                            {task.source === 'gitlab' && (
                                <span className="flex items-center gap-1.5 px-2 py-1 bg-orange-50 text-orange-600 border border-orange-100 rounded-lg text-[10px] font-bold uppercase tracking-tight">
                                    <GitLabIcon className="w-3 h-3 text-[#FC6D26]" /> GitLab
                                </span>
                            )}
                            {task.source === 'jira' && (
                                <span className="flex items-center gap-1.5 px-2 py-1 bg-indigo-50 text-indigo-600 border border-indigo-100 rounded-lg text-[10px] font-bold uppercase tracking-tight">
                                    <JiraIcon className="w-3 h-3 text-[#0052CC]" /> Jira
                                </span>
                            )}
                        </div>
                    )}

                    {/* Thư mục lưu */}
                    {(!columns || columns.output) && (
                        <div style={{ width: getColWidth('output') }} className="min-w-[120px] hidden sm:flex items-center gap-1.5 overflow-hidden">
                            <Folder className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                            <span className="text-xs text-gray-600 truncate" title={task.outputDir}>
                                {task.outputDir ? (task.outputDir.split(/[\/\\]/).filter(Boolean).slice(-2).join('/') || task.outputDir) : '-'}
                            </span>
                        </div>
                    )}

                    {/* Đồng bộ tự động */}
                    {(!columns || columns.sync) && (
                        <div style={{ width: getColWidth('sync') }} className="min-w-[60px] hidden sm:block text-center text-xs">
                            {task.isAutoSync ? (
                                <span className="inline-flex items-center gap-1 font-bold text-zalopay-green bg-green-50 px-2 py-0.5 rounded-md border border-green-100 uppercase tracking-tighter">
                                    <Clock className="w-3 h-3" /> Bật
                                </span>
                            ) : (
                                <span className="inline-flex items-center font-bold text-gray-400 bg-gray-50 px-2 py-0.5 rounded-md border border-gray-100 uppercase tracking-tighter">
                                    Tắt
                                </span>
                            )}
                        </div>
                    )}

                    {/* Xuất dữ liệu */}
                    {(!columns || columns.export) && (
                        <div style={{ width: getColWidth('export') }} className="min-w-[60px] hidden sm:flex flex-wrap gap-1 content-center items-center justify-center">
                            {task.formats?.map(f => (
                                <span key={f} className="inline-flex items-center gap-1 text-[10px] uppercase font-bold bg-blue-50 text-[#0144DB] px-1.5 py-0.5 rounded-md border border-blue-100/50" title={f}>
                                    {f === 'md' ? <FileText className="w-3 h-3" /> : f === 'raw' ? <FileCode2 className="w-3 h-3" /> : <FileDown className="w-3 h-3" />}
                                    {f}
                                </span>
                            ))}
                        </div>
                    )}

                    {/* Xử lý tài liệu bằng AI */}
                    {(!columns || columns.ai) && (
                        <div style={{ width: getColWidth('ai') }} className="min-w-[80px] hidden sm:block">
                            {task.enableAiProcessing ? (
                                <span className="inline-flex items-center gap-1 text-xs font-bold text-purple-600 bg-purple-50 px-2 py-0.5 rounded-md border border-purple-100 uppercase tracking-tighter">
                                    <Cpu className="w-3 h-3" /> {task.modelSelection?.split(/[\- ]/)[0] || 'AI'}
                                </span>
                            ) : (
                                <span className="inline-flex items-center text-xs font-bold text-gray-400 bg-gray-50 px-2 py-0.5 rounded-md border border-gray-100 uppercase tracking-tighter">
                                    Tắt AI
                                </span>
                            )}
                        </div>
                    )}

                    {/* Thao tác */}
                    {(!columns || columns.actions) && (
                        <div style={{ width: getColWidth('actions') }} className="shrink-0 flex items-center justify-end gap-0.5 z-30 relative">
                            <button 
                                onClick={(e) => { e.stopPropagation(); onCopy(task, e); }} 
                                className="p-1.5 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors opacity-40 hover:opacity-100" 
                                title="Sao chép"
                            >
                                <Copy className="w-3.5 h-3.5" />
                            </button>
                            <button 
                                onClick={(e) => { e.stopPropagation(); onDelete(task.id, e); }} 
                                className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors opacity-40 hover:opacity-100" 
                                title={t('deleteTask')}
                            >
                                <Trash2 className="w-3.5 h-3.5" />
                            </button>
                            <button 
                                onClick={(e) => { e.stopPropagation(); onLoad(task.id); }} 
                                className="p-1.5 text-gray-400 hover:text-zalopay-blue hover:bg-blue-50 rounded-lg transition-colors opacity-40 hover:opacity-100" 
                                title={t('editTask')}
                            >
                                <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button 
                                onClick={(e) => { e.stopPropagation(); onRun(task, e); }} 
                                className="ml-1 p-1.5 bg-zalopay-blue/5 hover:bg-zalopay-blue/10 text-zalopay-blue rounded-xl transition-all shadow-sm hover:scale-105 active:scale-95" 
                                title={t('runTask')}
                            >
                                <Play className="w-3.5 h-3.5 fill-current" />
                            </button>
                        </div>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div
            ref={setNodeRef} style={style}
            className="bg-white rounded-2xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow overflow-hidden flex flex-col group relative"
        >
            {isManualSort && (
                <div 
                    {...attributes} 
                    {...(listeners as any)} 
                    className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 cursor-grab active:cursor-grabbing z-20 p-1.5 bg-white/90 backdrop-blur-sm rounded-lg shadow-sm border border-gray-100 touch-none"
                >
                    <GripVertical className="w-5 h-5 pointer-events-none" />
                </div>
            )}
            <div className="p-5 border-b border-gray-100 flex-1 cursor-pointer" onClick={() => onLoad(task.id)}>
                <h3 className={`font-semibold text-lg text-gray-900 mb-2 group-hover:text-zalopay-blue transition-colors line-clamp-2 ${isManualSort ? 'pr-10' : ''}`}>{task.name}</h3>

                <div className="space-y-2 mt-4 text-sm text-gray-600">
                    <div className="flex items-start gap-2 min-w-0">
                        <LinkIcon className="w-4 h-4 mt-0.5 shrink-0" />
                        <span className="line-clamp-1 break-all min-w-0" title={task.url}>{task.url}</span>
                    </div>
                    {task.rules && task.rules.length > 0 ? (
                        <div className="flex flex-col gap-1 mt-2 border-t border-gray-100 pt-2">
                            <span className="text-xs font-semibold text-gray-500 mb-1">{task.rules.length} {t('listRules')}</span>
                            {task.rules.slice(0, 2).map((r, i) => (
                                <div key={r.id || i} className="flex items-start gap-2 text-xs min-w-0">
                                    <Settings className="w-3.5 h-3.5 mt-0.5 shrink-0 text-gray-400" />
                                    <span className="line-clamp-1 break-all min-w-0">
                                        {r.keywords ? `KW: ${r.keywords}` : `URL: ${r.parentUrl.split('?')[1] || r.parentUrl}`}
                                    </span>
                                </div>
                            ))}
                            {task.rules.length > 2 && (
                                <span className="text-xs text-gray-400 italic">+{task.rules.length - 2} {t('listRulesOther')}</span>
                            )}
                        </div>
                    ) : (
                        // Fallback
                        <>
                            {(task as any).keywords && (
                                <div className="flex items-start gap-2 min-w-0">
                                    <Settings className="w-4 h-4 mt-0.5 shrink-0" />
                                    <span className="line-clamp-2 text-xs break-all min-w-0">{t('listKeywords')} {(task as any).keywords}</span>
                                </div>
                            )}
                            {(task as any).parentUrl && !(task as any).keywords && (
                                <div className="flex items-start gap-2 min-w-0">
                                    <Folder className="w-4 h-4 mt-0.5 shrink-0" />
                                    <span className="line-clamp-2 text-xs break-all min-w-0">{t('listParent')} {(task as any).parentUrl}</span>
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>
            <div className="bg-zalopay-bg px-5 py-3 flex items-center justify-between">
                <div className="flex flex-col gap-1.5">
                    <div className="flex gap-2">
                        {task.formats?.map(f => (
                            <span key={f} className="inline-flex items-center gap-1 uppercase bg-gray-100 text-gray-700 font-bold px-1.5 py-0.5 rounded text-[9px] tracking-tight border border-gray-200">
                                {f === 'md' ? <FileText className="w-2.5 h-2.5" /> : f === 'raw' ? <FileCode2 className="w-2.5 h-2.5" /> : <FileDown className="w-2.5 h-2.5" />}
                                {f}
                            </span>
                        ))}
                    </div>
                    <div className="flex items-center gap-1.5">
                        {task.source === 'confluence' && (
                            <div className="flex items-center gap-1 text-[10px] font-bold text-[#0144DB] uppercase tracking-tighter">
                                <ConfluenceIcon className="w-2.5 h-2.5 text-[#0144DB]" /> Conf
                            </div>
                        )}
                        {task.source === 'gitlab' && (
                            <div className="flex items-center gap-1 text-[10px] font-bold text-orange-600 uppercase tracking-tighter">
                                <GitLabIcon className="w-2.5 h-2.5 text-[#FC6D26]" /> GitLab
                            </div>
                        )}
                        {task.source === 'jira' && (
                            <div className="flex items-center gap-1 text-[10px] font-bold text-indigo-600 uppercase tracking-tighter">
                                <JiraIcon className="w-2.5 h-2.5 text-[#0052CC]" /> Jira
                            </div>
                        )}
                    </div>
                </div>
                <div className="flex items-center gap-1">
                    <button 
                        onClick={(e) => { e.stopPropagation(); onCopy(task, e); }} 
                        className="p-1.5 text-gray-400 hover:text-green-500 hover:bg-green-50 rounded transition-colors" 
                        title="Sao chép"
                    >
                        <Copy className="w-4 h-4" />
                    </button>
                    <button 
                        onClick={(e) => { e.stopPropagation(); onDelete(task.id, e); }} 
                        className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors" 
                        title={t('deleteTask')}
                    >
                        <Trash2 className="w-4 h-4" />
                    </button>
                    <button 
                        onClick={(e) => { e.stopPropagation(); onLoad(task.id); }} 
                        className="p-1.5 text-gray-400 hover:text-zalopay-blue hover:bg-indigo-50 rounded transition-colors" 
                        title={t('editTask')}
                    >
                        <Edit2 className="w-4 h-4" />
                    </button>
                    <button 
                        onClick={(e) => { e.stopPropagation(); onRun(task, e); }} 
                        className="ml-1 p-1.5 bg-zalopay-blue/10 hover:bg-indigo-200 text-zalopay-blue rounded transition-colors" 
                        title={t('runTask')}
                    >
                        <Play className="w-4 h-4 fill-current" />
                    </button>
                </div>
            </div>
        </div>
    );
}

export default function KnowledgeBasePage() {
    const { getDefaults } = useSettingsStore();
    const { language } = useI18nStore();
    const t = useTranslation();

    const { authMode, user } = useAuth();
    const defaults = getDefaults(user?.username || 'local');
    const tasksStorageKey = user?.username ? `kb_tasks_${user.username}` : "kb_tasks";
    const [userCredentials, setUserCredentials] = useState<any[]>([]);
    const [selectedCredRef, setSelectedCredRef] = useState<{ source: string; label: string } | null>(null);

    // Form State
    const [source, setSource] = useState<"confluence" | "gitlab" | "jira">("confluence");

    // Task State
    const [tasks, setTasks] = useState<CrawlTask[]>([]);
    const [selectedTaskId, setSelectedTaskId] = useState("");
    const [pendingRunTaskId, setPendingRunTaskId] = useState<string | null>(null);
    const [taskName, setTaskName] = useState("");

    // Push to Agent KB states
    const [pathPrefix, setPathPrefix] = useState("02. Context/Confluence");
    const [pushStatus, setPushStatus] = useState<"idle" | "checking" | "ready" | "pushing" | "success" | "error">("idle");
    const [pushFileCount, setPushFileCount] = useState(0);
    const [pushMessage, setPushMessage] = useState("");

    // Load credentials in server mode
    useEffect(() => {
        if (authMode !== "required") return;
        
        fetch("/api/credentials")
            .then(res => res.json())
            .then(data => {
                const creds = data.credentials || [];
                setUserCredentials(creds);
                
                // Set default matching source & label (only if not editing an existing task with credentialRef)
                if (!selectedTaskId) {
                    const matched = creds.find((c: any) => c.source === source && c.label === "default");
                    if (matched) {
                        setSelectedCredRef({ source: matched.source, label: matched.label });
                    } else {
                        const firstMatch = creds.find((c: any) => c.source === source);
                        if (firstMatch) {
                            setSelectedCredRef({ source: firstMatch.source, label: firstMatch.label });
                        } else {
                            setSelectedCredRef(null);
                        }
                    }
                }
            })
            .catch(err => console.error("Failed to load credentials in knowledge-base:", err));
    }, [authMode, source, selectedTaskId]);

    // Automatically update pathPrefix when source changes
    useEffect(() => {
        if (source === "confluence") setPathPrefix("02. Context/Confluence");
        else if (source === "gitlab") setPathPrefix("03. Fact/Source Code");
        else if (source === "jira") setPathPrefix("02. Context/Jira");
    }, [source]);

    const [isMounted, setIsMounted] = useState(false);
    useEffect(() => {
        setIsMounted(true);
    }, []);

    // Form State
    const [url, setUrl] = useState("https://confluence.example.com");
    const [username, setUsername] = useState("");
    const [apiKey, setApiKey] = useState("");
    
    // New Source Fields
    const [projectId, setProjectId] = useState("");
    const [groupId, setGroupId] = useState("");
    const [branch, setBranch] = useState("main");
    const [projectKey, setProjectKey] = useState("");
    const [jql, setJql] = useState("");

    // View State
    const [view, setView] = useState<'list' | 'edit'>('list');

    // Layout & Sort State
    const [taskLayout, setTaskLayout] = useState<'gallery' | 'list'>('list');
    const [taskSort, setTaskSort] = useState<'manual' | 'newest' | 'oldest'>('manual');

    // Column state for list view
    const DEFAULT_COLUMN_WEIGHTS = {
        name: 400, platform: 100, output: 150, sync: 70, export: 80, ai: 100, actions: 100
    };
    const [columns, setColumns] = useState({
        name: true, platform: true, output: true, sync: true, export: true, ai: true, actions: true
    });
    const [columnWeights, setColumnWeights] = useState(DEFAULT_COLUMN_WEIGHTS);
    const [showColumnMenu, setShowColumnMenu] = useState(false);
    const columnMenuRef = useRef<HTMLDivElement>(null);
    const listTableRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (columnMenuRef.current && !columnMenuRef.current.contains(event.target as Node)) {
                setShowColumnMenu(false);
            }
        };
        if (showColumnMenu) document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [showColumnMenu]);

    useEffect(() => {
        const saved = localStorage.getItem('taskColumns');
        if (saved) {
            try { setColumns(prev => ({ ...prev, ...JSON.parse(saved) })); } catch(e) {}
        }
        const savedWeights = localStorage.getItem('taskColumnWeights');
        if (savedWeights) {
            try { setColumnWeights({ ...DEFAULT_COLUMN_WEIGHTS, ...JSON.parse(savedWeights) }); } catch(e) {}
        }
    }, []);

    const toggleColumn = (key: keyof typeof columns) => {
        setColumns(prev => {
            const next = { ...prev, [key]: !prev[key] };
            localStorage.setItem('taskColumns', JSON.stringify(next));
            return next;
        });
    };

    const handleResizeStart = (e: React.MouseEvent, key: keyof typeof columnWeights) => {
        e.preventDefault();
        e.stopPropagation();
        const tableWidth = listTableRef.current?.offsetWidth || 1200;
        
        let currentX = e.clientX;
        let currentTotalWeight = Object.entries(columns).reduce((acc, [k, isVisible]) => acc + (isVisible ? columnWeights[k as keyof typeof columnWeights] : 0), 0);
        let currentWeight = columnWeights[key];

        const handleMouseMove = (moveEvent: MouseEvent) => {
            const deltaX = moveEvent.clientX - currentX;
            currentX = moveEvent.clientX;
            
            const S = currentTotalWeight;
            const T = tableWidth;
            const P = currentWeight / S + deltaX / T;
            
            if (P < 0.02 || P > 0.98) return;

            const x = (S * deltaX / T) / (1 - P);
            
            currentWeight = Math.max(30, currentWeight + x); 
            currentTotalWeight += x;

            setColumnWeights(prev => ({ ...prev, [key]: currentWeight }));
        };

        const handleMouseUp = () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
            setColumnWeights(prev => {
                localStorage.setItem('taskColumnWeights', JSON.stringify(prev));
                return prev;
            });
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
    };

    const totalWeight = useMemo(() => {
        return Object.entries(columns).reduce((acc, [key, isVisible]) => {
            return acc + (isVisible ? columnWeights[key as keyof typeof columnWeights] : 0);
        }, 0);
    }, [columns, columnWeights]);
    
    const getColWidth = (key: keyof typeof columnWeights) => {
        if (!columns[key]) return '0px';
        return `${(columnWeights[key] / totalWeight) * 100}%`;
    };

    const renderTh = (key: keyof typeof DEFAULT_COLUMN_WEIGHTS, label: string, align: 'left'|'center'|'right' = 'left', extraClass: string = '') => {
        if (!columns[key]) return null;
        return (
            <div style={{ width: getColWidth(key) }} className={`text-${align} relative group/th min-w-[60px] ${extraClass}`}>
                {label}
                {key !== 'actions' && (
                    <div 
                        onMouseDown={(e) => handleResizeStart(e, key)}
                        className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-[#0144DB] opacity-0 group-hover/th:opacity-100 transition-opacity z-10"
                    />
                )}
            </div>
        );
    };


    // Pagination State
    const [currentPage, setCurrentPage] = useState(1);
    const [pageSize, setPageSize] = useState(20);
    const [aiInputTokens, setAiInputTokens] = useState(0);
    const [aiOutputTokens, setAiOutputTokens] = useState(0);

    // Abort Controller Ref
    const abortControllerRef = useRef<AbortController | null>(null);

    // Rules State
    const [rules, setRules] = useState<CrawlRule[]>([
        { id: '1', keywords: "product, feature, architecture, API", parentUrl: "", includeChildren: false }
    ]);
    const [queryPrompt, setQueryPrompt] = useState("");
    const [modelSelection, setModelSelection] = useState("gemini-2.5-flash");
    const [downloadFiles, setDownloadFiles] = useState(true);
    const [enableAiProcessing, setEnableAiProcessing] = useState(true);
    const [formats, setFormats] = useState<string[]>(['md', 'pdf']);
    const [outputDir, setOutputDir] = useState("");

    // AutoSync State
    const [isAutoSync, setIsAutoSync] = useState(false);
    const [syncFrequency, setSyncFrequency] = useState("daily");
    const [syncTime, setSyncTime] = useState("02:00");
    const [lastSyncTime, setLastSyncTime] = useState<string | null>(null);

    // Execution State
    const [isRunning, setIsRunning] = useState(false);
    const [isComplete, setIsComplete] = useState(false);
    const [statusLogs, setStatusLogs] = useState<LogEntry[]>([]);
    const [outputFolderLocation, setOutputFolderLocation] = useState("");
    const [processedFiles, setProcessedFiles] = useState(0);
    const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
    const [testMessage, setTestMessage] = useState('');
    const [llmOutput, setLlmOutput] = useState("");
    
    // Search & Filter State
    const [searchTerm, setSearchTerm] = useState("");
    const [filterPlatforms, setFilterPlatforms] = useState<string[]>([]);
    const [filterSync, setFilterSync] = useState("all");
    const [filterAi, setFilterAi] = useState("all");

    // Post-Processing State
    const [isGeneratingImage, setIsGeneratingImage] = useState(false);
    const [illustrationUrl, setIllustrationUrl] = useState("");
    const [illustrationPrompt, setIllustrationPrompt] = useState("");
    const [isIllustrationError, setIsIllustrationError] = useState(false);
    const [isGeneratingDiagram, setIsGeneratingDiagram] = useState(false);
    const [diagramCode, setDiagramCode] = useState("");

    // Editor State
    const [editedContent, setEditedContent] = useState("");

    const logsEndRef = useRef<HTMLDivElement>(null);

    // dnd-kit sensors
    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    );

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;
        if (active.id !== over?.id && over) {
            setTasks((items) => {
                const oldIndex = items.findIndex((i) => i.id === active.id);
                const newIndex = items.findIndex((i) => i.id === over.id);
                const newTasks = arrayMove(items, oldIndex, newIndex);
                localStorage.setItem(tasksStorageKey, JSON.stringify(newTasks));
                fetch('/api/knowledge-base/tasks', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ tasks: newTasks })
                });
                return newTasks;
            });
        }
    };

    // Auto-scroll logs
    useEffect(() => {
        logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [statusLogs]);

    useEffect(() => {
        // Load from backend API first
        fetch('/api/knowledge-base/tasks')
            .then(res => res.json())
            .then(data => {
                if (data.tasks && data.tasks.length > 0) {
                    setTasks(data.tasks);
                    localStorage.setItem(tasksStorageKey, JSON.stringify(data.tasks));
                } else {
                    // Fallback to local storage if API is empty
                    const savedTasks = localStorage.getItem(tasksStorageKey);
                    if (savedTasks) {
                        try {
                            const parsed = JSON.parse(savedTasks);
                            setTasks(parsed);
                            // Sync them up to backend
                            fetch('/api/knowledge-base/tasks', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ tasks: parsed })
                            });
                        } catch (e) {
                            console.error("Failed to parse tasks");
                        }
                    }
                }
            })
            .catch(err => console.error("Failed to load tasks from backend", err));
    }, []);

    const saveTask = () => {
        if (!taskName.trim()) {
            alert("Vui lòng nhập tên tác vụ để lưu.");
            return;
        }

        const isRequired = authMode === "required";
        const newTask: any = {
            id: selectedTaskId || Date.now().toString(),
            name: taskName,
            source, url, rules, formats, queryPrompt, modelSelection, downloadFiles, enableAiProcessing,
            isAutoSync, syncFrequency, syncTime, lastSyncTime,
            projectId, groupId, branch, projectKey, jql
        };

        if (isRequired) {
            newTask.credentialRef = selectedCredRef;
            newTask.username = "";
            newTask.apiKey = "";
            newTask.outputDir = outputDir;
        } else {
            newTask.username = username;
            newTask.apiKey = apiKey;
            newTask.outputDir = outputDir;
        }

        const existingIndex = tasks.findIndex(t => t.id === newTask.id);
        let updatedTasks = [...tasks];

        if (existingIndex >= 0) {
            updatedTasks[existingIndex] = newTask;
        } else {
            updatedTasks.unshift(newTask);
            setSelectedTaskId(newTask.id);
        }

        setTasks(updatedTasks);
        localStorage.setItem(tasksStorageKey, JSON.stringify(updatedTasks));

        const csrfToken = useAuthStore.getState().csrfToken;
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (isRequired && csrfToken) {
            headers['X-CSRF-Token'] = csrfToken;
        }

        fetch('/api/knowledge-base/tasks', {
            method: 'POST',
            headers,
            body: JSON.stringify({ tasks: updatedTasks })
        });
        alert("Đã lưu tác vụ thành công!");
        // setView('list');
    };

    const deleteTask = (taskId: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (confirm("Bạn có chắc chắn muốn xoá tác vụ này không?")) {
            const updatedTasks = tasks.filter(t => t.id !== taskId);
            setTasks(updatedTasks);
            localStorage.setItem(tasksStorageKey, JSON.stringify(updatedTasks));

            const isRequired = authMode === "required";
            const csrfToken = useAuthStore.getState().csrfToken;
            const headers: Record<string, string> = { 'Content-Type': 'application/json' };
            if (isRequired && csrfToken) {
                headers['X-CSRF-Token'] = csrfToken;
            }

            fetch('/api/knowledge-base/tasks', {
                method: 'POST',
                headers,
                body: JSON.stringify({ tasks: updatedTasks })
            });
            if (selectedTaskId === taskId) {
                setSelectedTaskId("");
            }
        }
    };

    const copyTask = (task: CrawlTask, e?: React.MouseEvent) => {
        if (e) e.stopPropagation();
        
        setSelectedTaskId("");
        setTaskName(`${task.name} Copy version`);
        setSource(task.source);
        setUrl(task.url);
        setUsername(task.username);
        setApiKey(task.apiKey);

        if (task.rules && task.rules.length > 0) {
            setRules(task.rules.map(r => ({ ...r, id: Date.now().toString() + Math.random().toString(36).substring(7) })));
        } else if ((task as any).keywords || (task as any).parentUrl) {
            setRules([{
                id: Date.now().toString(),
                keywords: (task as any).keywords || "",
                parentUrl: (task as any).parentUrl || "",
                includeChildren: (task as any).includeChildren || false
            }]);
        } else {
            setRules([{ id: Date.now().toString(), keywords: "", parentUrl: "", includeChildren: false }]);
        }

        setQueryPrompt(task.queryPrompt || "");
        setModelSelection(task.modelSelection || "gemini-2.5-flash");
        setDownloadFiles(task.downloadFiles ?? true);
        setEnableAiProcessing(task.enableAiProcessing ?? true);
        setFormats(task.formats || ['md']);
        setOutputDir(task.outputDir);
        setIsAutoSync(task.isAutoSync || false);
        setSyncFrequency(task.syncFrequency || "daily");
        setSyncTime(task.syncTime || "02:00");
        setLastSyncTime(task.lastSyncTime || null);

        // New fields
        setProjectId(task.projectId || "");
        setGroupId(task.groupId || "");
        setBranch(task.branch || "main");
        setProjectKey(task.projectKey || "");
        setJql(task.jql || "");

        setView('edit');
    };

    const runTaskFromList = (task: CrawlTask, e: React.MouseEvent) => {
        e.stopPropagation();
        loadTask(task.id);
        setView('edit');
        setPendingRunTaskId(task.id);
    };

    useEffect(() => {
        if (pendingRunTaskId && selectedTaskId === pendingRunTaskId && view === 'edit') {
            const timer = setTimeout(() => {
                handleRun();
                setPendingRunTaskId(null);
            }, 50);
            return () => clearTimeout(timer);
        }
    }, [pendingRunTaskId, selectedTaskId, view]);

    const applyDefaultsForSource = (src: CrawlerSource) => {
        const sourceDefaults = defaults[src];
        setUrl(sourceDefaults.url);
        setUsername(sourceDefaults.username);
        setApiKey(sourceDefaults.apiKey);
        
        if (src === 'gitlab') {
            setProjectId(sourceDefaults.projectId || "");
            setGroupId(sourceDefaults.groupId || "");
            setBranch(sourceDefaults.branch || "main");
            setFormats(['raw']);
        } else if (src === 'jira') {
            setProjectKey(sourceDefaults.projectKey || "");
            setFormats(['md']);
        } else {
            setFormats(['md']);
        }
    };

    const createNewTask = () => {
        setSelectedTaskId("");
        setTaskName("");
        setSource("confluence");
        
        // Apply defaults from settings
        const confDefaults = defaults.confluence;
        setUrl(confDefaults.url);
        setUsername(confDefaults.username);
        setApiKey(confDefaults.apiKey);
        
        setRules([{ id: Date.now().toString(), keywords: "product, feature, architecture, API", parentUrl: "", includeChildren: false }]);
        setQueryPrompt("");
        setModelSelection("gemini-2.5-flash");
        setDownloadFiles(true);
        setEnableAiProcessing(true);
        setFormats(['md', 'pdf']);
        setOutputDir("");
        setIsAutoSync(false);
        setSyncFrequency("daily");
        setSyncTime("02:00");
        setLastSyncTime(null);
        setProjectId("");
        setGroupId("");
        setBranch("main");
        setProjectKey("");
        setJql("");
        setView('edit');
    };

    const loadTask = async (taskId: string) => {
        if (!taskId) {
            setSelectedTaskId("");
            setTaskName("");
            setStatusLogs([]);
            setLlmOutput("");
            setEditedContent("");
            setIsComplete(false);
            return;
        }

        const task = tasks.find(t => t.id === taskId);
        if (task) {
            setSelectedTaskId(task.id);
            setTaskName(task.name);
            setSource(task.source);
            setUrl(task.url);
            setSelectedCredRef((task as any).credentialRef || null);
            setUsername(task.username || "");
            setApiKey(task.apiKey || "");

            if (task.rules && task.rules.length > 0) {
                setRules(task.rules);
            } else if ((task as any).keywords || (task as any).parentUrl) {
                // Backward compatibility for old saved tasks
                setRules([{
                    id: Date.now().toString(),
                    keywords: (task as any).keywords || "",
                    parentUrl: (task as any).parentUrl || "",
                    includeChildren: (task as any).includeChildren || false
                }]);
            } else {
                setRules([{ id: Date.now().toString(), keywords: "", parentUrl: "", includeChildren: false }]);
            }

            setQueryPrompt(task.queryPrompt || "");
            setModelSelection(task.modelSelection || "gemini-2.5-flash");
            setDownloadFiles(task.downloadFiles ?? true);
            setEnableAiProcessing(task.enableAiProcessing ?? true);
            setFormats(task.formats || ['md']);
            setOutputDir(task.outputDir);
            setIsAutoSync(task.isAutoSync || false);
            setSyncFrequency(task.syncFrequency || "daily");
            setSyncTime(task.syncTime || "02:00");
            setLastSyncTime(task.lastSyncTime || null);
            setProjectId(task.projectId || "");
            setGroupId(task.groupId || "");
            setBranch(task.branch || "main");
            setProjectKey(task.projectKey || "");
            setJql(task.jql || "");
            
            // Fetch logs for this task
            try {
                const logRes = await fetch(`/api/knowledge-base/logs?taskId=${taskId}`);
                const logData = await logRes.json();
                if (logData.logs) {
                    setStatusLogs(logData.logs);
                    
                    // Re-calculate derived states from logs
                    let fullLlm = "";
                    let isDone = false;
                    let pFiles = 0;
                    
                    for (const entry of logData.logs) {
                        if (entry.type === 'llm_chunk') {
                            fullLlm += entry.message || "";
                        }
                        if (entry.type === 'done') {
                            isDone = true;
                        }
                        if (entry.type === 'log' && entry.message?.includes("[PROGRESS]")) {
                            pFiles++;
                        }
                    }
                    
                    setLlmOutput(fullLlm);
                    setEditedContent(fullLlm);
                    setIsComplete(isDone);
                    setProcessedFiles(pFiles);
                } else {
                    setStatusLogs([]);
                    setLlmOutput("");
                    setEditedContent("");
                    setIsComplete(false);
                    setProcessedFiles(0);
                }
            } catch (err) {
                console.error("Failed to load task logs:", err);
            }

            setView('edit');
        }
    };

    const handleFormatToggle = (fmt: string) => {
        setFormats(prev =>
            prev.includes(fmt) ? prev.filter(f => f !== fmt) : [...prev, fmt]
        );
    };

    const handleRun = async () => {
        const isRequired = authMode === "required";
        if (isRequired) {
            if (!selectedCredRef) {
                alert("Vui lòng chọn thông tin xác thực (Credential)");
                return;
            }
        } else {
            if (!apiKey) {
                alert("Vui lòng nhập Confluence API Key");
                return;
            }
        }

        setIsRunning(true);
        setIsComplete(false);
        setStatusLogs([]);
        setOutputFolderLocation("");
        setProcessedFiles(0);
        setLlmOutput("");
        setAiInputTokens(0);
        setAiOutputTokens(0);

        // Initialize AbortController
        abortControllerRef.current = new AbortController();

        let currentProcessedFiles = 0;
        let currentInputTokens = 0;
        let currentOutputTokens = 0;

        const actualTaskName = taskName || (selectedTaskId ? tasks.find(t => t.id === selectedTaskId)?.name : `Khám phá URL thủ công`) || `Tác vụ quét ${source}`;

        const csrfToken = useAuthStore.getState().csrfToken;
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (isRequired && csrfToken) {
            headers['X-CSRF-Token'] = csrfToken;
        }

        try {
            const response = await fetch('/api/knowledge-base/crawl', {
                method: 'POST',
                headers,
                signal: abortControllerRef.current.signal,
                body: JSON.stringify(
                    isRequired
                    ? {
                        source, url, credentialRef: selectedCredRef, rules, formats, outputDir, queryPrompt, modelSelection, downloadFiles, enableAiProcessing,
                        lastSyncTime, projectId, groupId, branch, projectKey, jql,
                        taskId: selectedTaskId, taskName: actualTaskName
                      }
                    : {
                        source, url, username, apiKey, rules, formats, outputDir, queryPrompt, modelSelection, downloadFiles, enableAiProcessing,
                        lastSyncTime, projectId, groupId, branch, projectKey, jql,
                        taskId: selectedTaskId, taskName: actualTaskName
                      }
                )
            });

            if (!response.body) throw new Error("No response string from server API.");

            const reader = response.body.getReader();
            const decoder = new TextDecoder();

            while (true) {
                const { value, done } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value);
                const events = chunk.split('\n\n').filter(Boolean);

                for (const event of events) {
                    if (event.startsWith('data: ')) {
                        try {
                            const data: LogEntry = JSON.parse(event.replace('data: ', ''));
                            setStatusLogs(prev => [...prev, data]);

                            if (data.type === 'log' && data.message?.includes("FOLDER_LOCATION_SIGNAL:")) {
                                setOutputFolderLocation(data.message.split("FOLDER_LOCATION_SIGNAL:")[1].trim());
                            } else if (data.type === 'log' && data.message?.includes("[PROGRESS]")) {
                                setProcessedFiles(prev => prev + 1);
                            }

                            if (data.type === 'llm_chunk') {
                                setLlmOutput(prev => prev + (data.message || ""));
                                setEditedContent(prev => prev + (data.message || ""));
                            }

                            if (data.type === 'cost_estimation') {
                                currentInputTokens = data.inputTokens || 0;
                                currentOutputTokens = data.outputTokens || 0;
                                setAiInputTokens(currentInputTokens);
                                setAiOutputTokens(currentOutputTokens);
                            }

                            if (data.type === 'done') {
                                setIsRunning(false);
                                setIsComplete(true);

                                // Update lastSyncTime for the current task
                                if (selectedTaskId) {
                                    const now = new Date().toISOString();
                                    setLastSyncTime(now);
                                    setTasks(prevTasks => {
                                        const newTasks = prevTasks.map(t => 
                                            t.id === selectedTaskId ? { ...t, lastSyncTime: now } : t
                                        );
                                        localStorage.setItem(tasksStorageKey, JSON.stringify(newTasks));
                                        // Sync to backend
                                        fetch('/api/knowledge-base/tasks', {
                                            method: 'POST',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify({ tasks: newTasks })
                                        });
                                        return newTasks;
                                    });
                                }
                            }
                        } catch (e) {
                            console.error("Parse error for SSE data:", e);
                        }
                    }
                }
            }
        } catch (error: any) {
            if (error.name === 'AbortError') {
                setStatusLogs(prev => [...prev, { type: 'log', message: 'Tác vụ đã bị huỷ bởi người dùng.' }]);
            } else {
                setStatusLogs(prev => [...prev, { type: 'error', message: `Lỗi kết nối: ${error.message}` }]);
            }
            setIsRunning(false);
        } finally {
            abortControllerRef.current = null;
        }
    };

    const handleStop = () => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }
    };

    const handlePushCheck = async () => {
        if (!selectedTaskId) return;
        setPushStatus("checking");
        setPushMessage("");
        try {
            const csrfToken = useAuthStore.getState().csrfToken;
            const headers: Record<string, string> = { 'Content-Type': 'application/json' };
            if (csrfToken) {
                headers['X-CSRF-Token'] = csrfToken;
            }
            const res = await fetch('/api/knowledge-base/push-to-agent', {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    taskId: selectedTaskId,
                    source,
                    pathPrefix
                })
            });
            const data = await res.json();
            if (res.ok && data.status === "ready_to_package") {
                setPushStatus("ready");
                setPushFileCount(data.fileCount);
                setPushMessage(`Đã kiểm tra xong. Sẵn sàng đẩy ${data.fileCount} file lên Agent.`);
            } else {
                setPushStatus("error");
                setPushMessage(data.error || "Có lỗi xảy ra khi kiểm tra delta.");
            }
        } catch (err: any) {
            setPushStatus("error");
            setPushMessage(err.message || "Lỗi kết nối.");
        }
    };

    const handleGenerateImage = async () => {
        if (!llmOutput) return;
        setIsGeneratingImage(true);
        setIsIllustrationError(false);
        try {
            const response = await fetch('/api/knowledge-base/generate-image', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: llmOutput, modelSelection }),
            });
            const data = await response.json();
            if (data.svgCode) {
                // Convert raw SVG string to a data URI for the <img> tag
                const encodedSvg = `data:image/svg+xml;utf8,${encodeURIComponent(data.svgCode)}`;
                setIllustrationUrl(encodedSvg);
                setIllustrationPrompt(data.prompt);
            } else if (data.imageUrl) {
                setIllustrationUrl(data.imageUrl);
                setIllustrationPrompt(data.prompt);
            } else {
                alert("Lỗi tạo ảnh: " + data.error);
            }
        } catch (error) {
            console.error(error);
            alert("Đã xảy ra lỗi khi tạo ảnh minh hoạ.");
        } finally {
            setIsGeneratingImage(false);
        }
    };

    const handleGenerateDiagram = async () => {
        if (!llmOutput) return;
        setIsGeneratingDiagram(true);
        try {
            const response = await fetch('/api/knowledge-base/generate-diagram', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: llmOutput, modelSelection }),
            });
            const data = await response.json();
            if (data.diagramCode) {
                setDiagramCode(data.diagramCode);
            } else {
                alert("Lỗi tạo sơ đồ: " + data.error);
            }
        } catch (error) {
            console.error(error);
            alert("Đã xảy ra lỗi khi phân tích và tạo sơ đồ.");
        } finally {
            setIsGeneratingDiagram(false);
        }
    };

    const handleDownloadMarkdown = () => {
        const element = document.createElement("a");
        const file = new Blob([editedContent], { type: 'text/markdown' });
        element.href = URL.createObjectURL(file);

        let cleanName = "AI_Result";
        if (queryPrompt) {
            cleanName = queryPrompt.substring(0, 30).replace(/[^a-zA-Z0-9 ]/g, "").trim().replace(/ /g, "_");
        }
        element.download = `${cleanName}_${Date.now()}.md`;

        document.body.appendChild(element); // Required for this to work in FireFox
        element.click();
        element.remove();
    };

    const handleDownloadImage = () => {
        if (!illustrationUrl) return;

        const element = document.createElement("a");
        element.href = illustrationUrl;
        element.download = `AI_Illustration_${Date.now()}.svg`;
        document.body.appendChild(element);
        element.click();
        element.remove();
    };

    const handleDownloadDiagram = () => {
        if (!diagramCode) return;

        // Find the rendered SVG within the Mermaid container
        const svgElement = document.querySelector('.mermaid svg');
        if (!svgElement) {
            alert("Không tìm thấy SVG của sơ đồ để tải xuống.");
            return;
        }

        // Clone the SVG so we don't modify the visible DOM
        const clone = svgElement.cloneNode(true) as SVGSVGElement;

        // Set white background for the SVG and ensure standard namespace
        clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        clone.setAttribute('style', 'background-color: white;');

        const svgData = new XMLSerializer().serializeToString(clone);
        const blob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(blob);

        const element = document.createElement("a");
        element.href = url;
        element.download = `Mermaid_Diagram_${Date.now()}.svg`;
        document.body.appendChild(element);
        element.click();
        element.remove();
        URL.revokeObjectURL(url);
    };

    const handleViewResults = async () => {
        if (!outputFolderLocation) return;

        try {
            const csrfToken = useAuthStore.getState().csrfToken;
            const headers: Record<string, string> = { 'Content-Type': 'application/json' };
            if (authMode === "required" && csrfToken) {
                headers['X-CSRF-Token'] = csrfToken;
            }
            await fetch('/api/knowledge-base/open-folder', {
                method: 'POST',
                headers,
                body: JSON.stringify({ path: outputFolderLocation })
            });
        } catch (e) {
            console.error(e);
            alert("Để xem kết quả vui lòng mở thư mục:" + outputFolderLocation);
        }
    };

    const handleTestConnection = async () => {
        if (!url || !apiKey) {
            setTestStatus('error');
            setTestMessage(language === 'vi' ? 'Thiếu URL hoặc API Key' : 'Missing URL or API Key');
            return;
        }

        setTestStatus('testing');
        setTestMessage('');
        try {
            const res = await fetch('/api/knowledge-base/test-connection', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ source, url, username, apiKey })
            });
            const result = await res.json();
            if (result.success) {
                setTestStatus('success');
                setTestMessage(result.message);
            } else {
                setTestStatus('error');
                setTestMessage(result.message);
            }
        } catch (err: any) {
            setTestStatus('error');
            setTestMessage(err.message);
        }
    };

    const filteredTasks = useMemo(() => {
        return tasks.filter(task => {
            // Task Name fuzzy match
            const nameMatch = (task.name || "").toLowerCase().includes((searchTerm || "").toLowerCase());
            
            // Platform match (Multi-select)
            const platformMatch = filterPlatforms.length === 0 || filterPlatforms.includes(task.source);
            
            // Sync match
            const syncMatch = filterSync === 'all' || 
                (filterSync === 'on' && task.isAutoSync) || 
                (filterSync === 'off' && !task.isAutoSync);
            
            // AI match
            const aiMatch = filterAi === 'all' || 
                (filterAi === 'on' && task.enableAiProcessing) || 
                (filterAi === 'off' && !task.enableAiProcessing);
                
            return nameMatch && platformMatch && syncMatch && aiMatch;
        });
    }, [tasks, searchTerm, filterPlatforms, filterSync, filterAi]);

    const sortedTasks = useMemo(() => {
        const sorted = [...filteredTasks].sort((a, b) => {
            if (taskSort === 'newest') {
                return parseInt(b.id) - parseInt(a.id);
            } else if (taskSort === 'oldest') {
                return parseInt(a.id) - parseInt(b.id);
            }
            return 0; // manual
        });
        return sorted;
    }, [filteredTasks, taskSort]);

    const totalPages = Math.ceil(sortedTasks.length / pageSize);
    const paginatedTasks = useMemo(() => {
        const start = (currentPage - 1) * pageSize;
        return sortedTasks.slice(start, start + pageSize);
    }, [sortedTasks, currentPage, pageSize]);

    const EditTestConnectionButton = () => {
        const [status, setStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
        const [message, setMessage] = useState('');

        const handleTest = async () => {
            if (!url || !apiKey) {
                setStatus('error');
                setMessage(language === 'vi' ? 'Thiếu URL/API Key' : 'Missing URL/API Key');
                return;
            }

            setStatus('testing');
            try {
                const res = await fetch('/api/knowledge-base/test-connection', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        source, url, username, apiKey, projectId, groupId, branch, projectKey 
                    })
                });
                const result = await res.json();
                if (result.success) {
                    setStatus('success');
                    setMessage(result.message);
                } else {
                    setStatus('error');
                    setMessage(result.message);
                }
            } catch (err: any) {
                setStatus('error');
                setMessage(err.message);
            }
        };

        return (
            <div className="flex flex-col items-end gap-1">
                <button
                    onClick={handleTest}
                    disabled={status === 'testing'}
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all shadow-sm ${
                        status === 'testing' 
                            ? 'bg-gray-100 text-gray-400' 
                            : status === 'success'
                            ? 'bg-green-50 text-green-700 border border-green-200'
                            : status === 'error'
                            ? 'bg-red-50 text-red-700 border border-red-200'
                            : 'bg-white border border-[#0144DB]/30 text-[#0144DB] hover:bg-blue-50'
                    }`}
                >
                    {status === 'testing' ? (
                        <div className="w-3.5 h-3.5 border-2 border-gray-300 border-t-gray-500 rounded-full animate-spin" />
                    ) : (
                        <Activity className={`w-3.5 h-3.5 ${status === 'success' ? 'text-green-600' : status === 'error' ? 'text-red-500' : 'text-[#0144DB]'}`} />
                    )}
                    {status === 'testing' ? t('testing') : t('testConnection')}
                </button>
                {message && (
                    <p className={`text-[9px] font-medium leading-tight text-right absolute top-full mt-1 ${status === 'success' ? 'text-green-600' : 'text-red-500'}`}>
                        {message}
                    </p>
                )}
            </div>
        );
    };

    const itemIds = useMemo(() => paginatedTasks.map(t => t.id), [paginatedTasks]);

    // Reset page to 1 when sort or page size changes
    useEffect(() => {
        setCurrentPage(1);
    }, [taskSort, pageSize]);

    if (!isMounted) {
        return <div className="flex flex-1 items-center justify-center p-10 h-screen"><Loader2 className="w-8 h-8 animate-spin text-zalopay-blue" /></div>;
    }

    return (
        <div className="flex flex-1 flex-col p-6 h-full w-full max-w-full bg-zalopay-bg">
            <div className="mb-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-[2.5rem] font-bold tracking-tight text-gray-900 animate-slide-in-left pb-1.5 opacity-0 inline-block">
                        <span className="inline-block animate-heartbeat">{t('pageTitle')}</span>
                    </h1>
                    <p className="mt-2 text-gray-500">
                        {t('pageSubtitle')}
                    </p>
                </div>

                {view === 'list' && (
                    <div className="flex-1 flex flex-col sm:flex-row items-start sm:items-center justify-end gap-4 w-full sm:w-auto">


                        <div className="flex items-center gap-3">
                            {taskLayout === 'list' && (
                                <div className="relative" ref={columnMenuRef}>
                                    <button
                                        onClick={() => setShowColumnMenu(!showColumnMenu)}
                                        className={`h-10 flex items-center gap-2 bg-white border ${showColumnMenu ? 'border-[#0144DB] ring-1 ring-[#0144DB]/10' : 'border-gray-200'} text-gray-700 text-sm font-bold rounded-xl px-4 shadow-sm hover:bg-gray-50 transition-all`}
                                    >
                                        <Settings2 className="w-4 h-4" />
                                        Ẩn/hiện cột
                                    </button>
                                    {showColumnMenu && (
                                        <div className="absolute right-0 top-full mt-2 w-56 bg-white border border-gray-200 rounded-xl shadow-lg z-50 py-2">
                                            <div className="px-3 pb-2 mb-2 border-b border-gray-100 text-xs font-bold text-gray-400 uppercase tracking-wider">
                                                Tùy chỉnh hiển thị
                                            </div>
                                            {[
                                                { key: 'name', label: 'Tên tác vụ' },
                                                { key: 'platform', label: t('thPlatform') },
                                                { key: 'output', label: t('thOutputPath') },
                                                { key: 'sync', label: 'Đồng bộ' },
                                                { key: 'export', label: 'Xuất' },
                                                { key: 'ai', label: 'Xử lý AI' },
                                                { key: 'actions', label: 'Thao tác' }
                                            ].map((col) => (
                                                <button
                                                    key={col.key}
                                                    onClick={() => toggleColumn(col.key as keyof typeof columns)}
                                                    className="w-full px-4 py-2 flex items-center justify-between hover:bg-gray-50 text-sm"
                                                >
                                                    <span className="text-gray-700 font-medium">{col.label}</span>
                                                    <div className={`w-10 h-5 rounded-full transition-colors relative ${columns[col.key as keyof typeof columns] ? 'bg-green-500' : 'bg-gray-200'}`}>
                                                        <div className={`absolute top-1 left-1 bg-white w-3 h-3 rounded-full transition-transform ${columns[col.key as keyof typeof columns] ? 'translate-x-5' : 'translate-x-0'}`} />
                                                    </div>
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}
                            <select
                                value={taskSort}
                                onChange={(e) => setTaskSort(e.target.value as any)}
                                className="h-10 bg-white border border-gray-200 text-gray-700 text-sm font-bold rounded-xl px-3 shadow-sm focus:outline-none focus:border-[#0144DB] transition-all cursor-pointer hover:bg-gray-50"
                            >
                                <option value="manual">Sắp xếp: Thủ công</option>
                                <option value="newest">Sắp xếp: Mới nhất</option>
                                <option value="oldest">Sắp xếp: Cũ nhất</option>
                            </select>
                            <button
                                onClick={createNewTask}
                                className="flex items-center gap-2 bg-[#0144DB] hover:opacity-90 text-white px-5 py-2.5 rounded-xl font-medium shadow-sm transition-all h-10 whitespace-nowrap"
                            >
                                <Plus className="w-5 h-5" />
                                {t('newTask')}
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {view === 'list' ? (
                /* LIST VIEW */
                <DndContext 
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={handleDragEnd}
                >
                    <SortableContext 
                        items={itemIds}
                        strategy={taskLayout === 'gallery' ? rectSortingStrategy : verticalListSortingStrategy}
                    >
                        <div className={taskLayout === 'gallery' ? "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6" : "flex flex-col bg-white rounded-2xl border border-gray-200 shadow-sm overflow-visible divide-y divide-gray-100"}>
                            {taskLayout === 'list' && tasks.length > 0 && (
                                <div className="hidden sm:flex flex-col bg-gray-50 border-b border-gray-200 z-30 sticky top-0 shadow-sm rounded-t-2xl overflow-hidden">
                                    {/* Table Labels Row */}
                                    <div ref={listTableRef} className="flex items-center px-6 py-3 gap-4 border-b border-gray-200/60 font-bold text-gray-400 text-[10px] uppercase tracking-widest relative">
                                        <div className="w-10 shrink-0"></div>
                                        {renderTh('name', 'Tên tác vụ', 'left', 'min-w-[200px]')}
                                        {renderTh('platform', t('thPlatform'), 'left', 'min-w-[80px]')}
                                        {renderTh('output', t('thOutputPath'), 'left', 'min-w-[120px]')}
                                        {renderTh('sync', 'Đồng bộ', 'center', 'min-w-[60px]')}
                                        {renderTh('export', 'Xuất', 'center', 'min-w-[60px]')}
                                        {renderTh('ai', 'Xử lý AI', 'left', 'min-w-[80px]')}
                                        {renderTh('actions', 'Thao tác', 'right', 'shrink-0 pr-4')}
                                    </div>

                                    {/* Excel-style Filter Row */}
                                    <div className="flex items-center px-6 py-2 gap-4 bg-white/50 backdrop-blur-sm">
                                        <div className="w-10 shrink-0 flex justify-center">
                                            <Activity className="w-3.5 h-3.5 text-gray-300" />
                                        </div>
                                        
                                        {columns.name && (
                                            <div style={{ width: getColWidth('name') }} className="min-w-[200px] relative group">
                                                <div className="absolute inset-y-0 left-0 pl-2 flex items-center pointer-events-none">
                                                    <Search className="h-3 w-3 text-gray-300 group-focus-within:text-[#0144DB] transition-colors" />
                                                </div>
                                                <input
                                                    type="text"
                                                    placeholder="Lọc tên..."
                                                    className="w-full bg-transparent border-none p-0 pl-7 text-xs font-bold text-gray-600 focus:ring-0 placeholder:text-gray-300 placeholder:font-normal"
                                                    value={searchTerm}
                                                    onChange={(e) => setSearchTerm(e.target.value)}
                                                />
                                            </div>
                                        )}

                                        {columns.platform && (
                                            <div style={{ width: getColWidth('platform') }} className="min-w-[80px]">
                                                <div className="flex items-center gap-1">
                                                    {[
                                                        { id: 'confluence', icon: ConfluenceIcon, colorClass: 'text-[#0144DB]' },
                                                        { id: 'jira', icon: JiraIcon, colorClass: 'text-[#0052CC]' },
                                                        { id: 'gitlab', icon: GitLabIcon, colorClass: 'text-[#FC6D26]' }
                                                    ].map(plt => {
                                                        const IconComponent = plt.icon;
                                                        return (
                                                            <button
                                                                key={plt.id}
                                                                onClick={() => setFilterPlatforms(prev => 
                                                                    prev.includes(plt.id) ? prev.filter(p => p !== plt.id) : [...prev, plt.id]
                                                                )}
                                                                className={`w-6 h-6 rounded flex items-center justify-center transition-all ${
                                                                    filterPlatforms.includes(plt.id) 
                                                                        ? 'bg-blue-50 border border-blue-100' 
                                                                        : 'opacity-30 hover:opacity-100'
                                                                }`}
                                                            >
                                                                <IconComponent className={`w-3.5 h-3.5 ${plt.colorClass}`} />
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        )}

                                        {columns.output && <div style={{ width: getColWidth('output') }} className="min-w-[120px]"></div>}

                                        {columns.sync && (
                                            <div style={{ width: getColWidth('sync') }} className="min-w-[60px] flex justify-center">
                                                <select
                                                    value={filterSync}
                                                    onChange={(e) => setFilterSync(e.target.value)}
                                                    className="bg-transparent border-none p-0 text-[10px] font-bold text-gray-500 focus:ring-0 cursor-pointer hover:text-[#0144DB] transition-colors"
                                                >
                                                    <option value="all">Tất cả</option>
                                                    <option value="on">Bật</option>
                                                    <option value="off">Tắt</option>
                                                </select>
                                            </div>
                                        )}

                                        {columns.export && <div style={{ width: getColWidth('export') }} className="min-w-[60px]"></div>}

                                        {columns.ai && (
                                            <div style={{ width: getColWidth('ai') }} className="min-w-[80px]">
                                                <select
                                                    value={filterAi}
                                                    onChange={(e) => setFilterAi(e.target.value)}
                                                    className="bg-transparent border-none p-0 text-[10px] font-bold text-gray-500 focus:ring-0 cursor-pointer hover:text-[#0144DB] transition-colors"
                                                >
                                                    <option value="all">Tất cả</option>
                                                    <option value="on">AI Bật</option>
                                                    <option value="off">AI Tắt</option>
                                                </select>
                                            </div>
                                        )}

                                        {columns.actions && (
                                            <div style={{ width: getColWidth('actions') }} className="shrink-0 flex justify-end pr-4">
                                                {(searchTerm || filterPlatforms.length > 0 || filterSync !== 'all' || filterAi !== 'all') && (
                                                    <button
                                                        onClick={() => {
                                                            setSearchTerm("");
                                                            setFilterPlatforms([]);
                                                            setFilterSync("all");
                                                            setFilterAi("all");
                                                        }}
                                                        className="p-1 text-red-400 hover:text-red-600 transition-colors"
                                                        title="Xoá tất cả lọc"
                                                    >
                                                        <X className="w-4 h-4" />
                                                    </button>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            {sortedTasks.length === 0 ? (
                                <div className="col-span-full py-16 flex flex-col items-center justify-center border-2 border-dashed border-gray-300 rounded-2xl">
                                    <Database className="w-12 h-12 text-gray-300 mb-4" />
                                    <h3 className="text-lg font-medium text-gray-900 mb-1">{t('emptyTasksTitle')}</h3>
                                    <p className="text-sm text-gray-500 mb-6 text-center max-w-sm">
                                        {t('emptyTasksDesc')}
                                    </p>
                                    <button
                                        onClick={createNewTask}
                                        className="flex items-center gap-2 bg-[#0144DB] hover:opacity-90 text-white px-5 py-2.5 rounded-xl font-medium transition-all"
                                    >
                                        <Plus className="w-5 h-5" />
                                        {t('newTask')}
                                    </button>
                                </div>
                            ) : (
                                <>
                                    {paginatedTasks.map(task => (
                                        <SortableTaskCard 
                                            key={task.id} 
                                            task={task} 
                                            layout={taskLayout} 
                                            onLoad={loadTask} 
                                            onCopy={copyTask} 
                                            onDelete={deleteTask} 
                                            onRun={runTaskFromList} 
                                            isManualSort={taskSort === 'manual'}
                                            t={t}
                                            columns={columns}
                                            columnWeights={columnWeights}
                                            totalWeight={totalWeight}
                                        />
                                    ))}
                                </>
                            )}
                        </div>

                        {/* Pagination Footer */}
                        {view === 'list' && sortedTasks.length > 0 && (
                            <div className="bg-gray-50/80 backdrop-blur-sm border-t border-gray-100 px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-4 rounded-b-2xl">
                                <div className="text-sm text-gray-500 font-medium">
                                    Hiển thị <span className="text-gray-900">{(currentPage - 1) * pageSize + 1}</span> - <span className="text-gray-900">{Math.min(currentPage * pageSize, sortedTasks.length)}</span> trong tổng số <span className="text-gray-900">{sortedTasks.length}</span> tác vụ
                                </div>
                                <div className="flex items-center gap-6">
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs text-gray-400 font-bold uppercase tracking-tight">Số bản ghi:</span>
                                        <select
                                            value={pageSize}
                                            onChange={(e) => setPageSize(Number(e.target.value))}
                                            className="bg-white border border-gray-200 text-gray-700 text-xs font-bold rounded-lg px-2 py-1 shadow-sm focus:outline-none focus:border-[#0144DB]"
                                        >
                                            <option value={20}>20</option>
                                            <option value={50}>50</option>
                                            <option value={100}>100</option>
                                        </select>
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <button
                                            onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                                            disabled={currentPage === 1}
                                            className="p-2 rounded-lg hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                                        >
                                            <ChevronRight className="w-4 h-4 rotate-180" />
                                        </button>
                                        
                                        <div className="flex items-center gap-1">
                                            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                                                let p = i + 1;
                                                if (totalPages > 5 && currentPage > 3) {
                                                    p = currentPage - 3 + i;
                                                    if (p + 5 > totalPages) p = totalPages - 4;
                                                }
                                                if (p <= 0) p = 1;
                                                if (p > totalPages) return null;

                                                return (
                                                    <button
                                                        key={p}
                                                        onClick={() => setCurrentPage(p)}
                                                        className={`w-8 h-8 flex items-center justify-center rounded-lg text-sm font-bold transition-all ${currentPage === p ? 'bg-[#0144DB] text-white shadow-sm' : 'text-gray-500 hover:bg-gray-200'}`}
                                                    >
                                                        {p}
                                                    </button>
                                                );
                                            })}
                                            {totalPages > 5 && currentPage + 2 < totalPages && (
                                                <>
                                                    <span className="text-gray-400 mx-1">...</span>
                                                    <button
                                                        onClick={() => setCurrentPage(totalPages)}
                                                        className={`w-8 h-8 flex items-center justify-center rounded-lg text-sm font-bold transition-all ${currentPage === totalPages ? 'bg-[#0144DB] text-white shadow-sm' : 'text-gray-500 hover:bg-gray-200'}`}
                                                    >
                                                        {totalPages}
                                                    </button>
                                                </>
                                            )}
                                        </div>

                                        <button
                                            onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                                            disabled={currentPage === totalPages}
                                            className="p-2 rounded-lg hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                                        >
                                            <ChevronRight className="w-4 h-4" />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}
                    </SortableContext>
                </DndContext>
            ) : (
                /* EDIT VIEW */
                <div className="max-w-4xl mx-auto space-y-6 relative">
                    {/* Sticky Sub-Header for Back Action */}
                    <div className="sticky top-0 z-[60] bg-zalopay-bg/95 backdrop-blur-sm py-4 border-b border-gray-200 flex items-center justify-between mb-8 -mx-2 px-2">
                        <div className="flex items-center gap-4">
                            <div className="p-2 bg-[#0144DB]/10 rounded-lg">
                                <Edit2 className="w-5 h-5 text-[#0144DB]" />
                            </div>
                            <div className="flex flex-col">
                                <h2 className="text-base font-bold text-gray-900 tracking-tight">
                                    {selectedTaskId ? t('editTitle') : t('createTitle')}
                                </h2>
                                <span className="text-[10px] text-gray-400 font-mono italic">#{selectedTaskId || 'new-task'}</span>
                            </div>
                        </div>

                        <div className="flex items-center gap-2 flex-nowrap overflow-x-auto no-scrollbar">
                            {/* 1. Save Task */}
                            <button
                                onClick={saveTask}
                                className="flex-shrink-0 flex items-center justify-center w-10 h-10 bg-[#0144DB] text-white rounded-xl hover:opacity-90 transition-all shadow-sm active:scale-95"
                                title={t('saveTaskAction')}
                            >
                                <Save className="w-5 h-5" />
                            </button>

                            {/* 2. Delete Task (Only if exists) */}
                            {selectedTaskId && (
                                <button
                                    onClick={(e) => {
                                        if (confirm(language === 'vi' ? 'Bạn có chắc chắn muốn xoá tác vụ này?' : 'Are you sure you want to delete this task?')) {
                                            deleteTask(selectedTaskId, e);
                                        }
                                    }}
                                    className="flex-shrink-0 flex items-center justify-center w-10 h-10 bg-white border border-red-200 text-red-500 rounded-xl hover:bg-red-50 transition-all shadow-sm active:scale-95"
                                    title={t('deleteTaskAction')}
                                >
                                    <Trash2 className="w-5 h-5" />
                                </button>
                            )}

                            {/* 3. Clone/Copy Task (Only if exists) */}
                            {selectedTaskId && (
                                <button
                                    onClick={(e) => {
                                        const currentTask = tasks.find(t => t.id === selectedTaskId);
                                        if (currentTask) copyTask(currentTask, e);
                                    }}
                                    className="flex-shrink-0 flex items-center justify-center w-10 h-10 bg-white border border-[#0144DB]/30 text-[#0144DB] rounded-xl hover:bg-blue-50 transition-all shadow-sm active:scale-95"
                                    title={t('copyTaskAction')}
                                >
                                    <Copy className="w-5 h-5" />
                                </button>
                            )}

                            {/* 4. Run Now */}
                            <button
                                onClick={handleRun}
                                disabled={isRunning}
                                className="flex-shrink-0 flex items-center justify-center w-10 h-10 bg-green-50 hover:bg-green-100 text-green-600 rounded-xl transition-all shadow-sm active:scale-95 disabled:opacity-50"
                                title={t('runNowAction')}
                            >
                                {isRunning ? <Loader2 className="w-5 h-5 animate-spin" /> : <Play className="w-5 h-5 fill-current" />}
                            </button>

                            <div className="w-px h-8 bg-gray-200 mx-1 flex-shrink-0"></div>

                            {/* 5. Test Connection */}
                            <div className="flex-shrink-0">
                                <EditTestConnectionButton />
                            </div>

                            <div className="w-px h-8 bg-gray-200 mx-1 flex-shrink-0"></div>

                            {/* 6. Back to List */}
                            <button
                                onClick={() => setView('list')}
                                className="flex-shrink-0 flex items-center justify-center w-10 h-10 bg-white border border-gray-300 hover:bg-gray-100 text-gray-500 rounded-xl transition-all shadow-sm active:scale-95"
                                title={t('backToList')}
                            >
                                <ArrowLeft className="w-5 h-5" />
                            </button>
                        </div>
                    </div>
                    {/* Configuration Panel */}
                    <div className="space-y-6">
                        {/* Task Management Info */}
                        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                            <div className="border-b border-gray-200 px-6 py-4 flex items-center gap-2 bg-[#0144DB]/5">
                                <Edit2 className="w-5 h-5 text-[#0144DB]" />
                                <h2 className="font-semibold text-lg text-[#0144DB]">{t('labelTaskName')}</h2>
                            </div>
                            <div className="p-6 flex flex-col gap-4">
                                <div className="w-full relative">
                                    <label className="block text-sm font-medium mb-1.5 text-gray-700">{t('labelTaskName')}</label>
                                    <input
                                        type="text"
                                        placeholder={t('phTaskName')}
                                        className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-[#0144DB] focus:outline-none focus:ring-1 focus:ring-[#0144DB]"
                                        value={taskName}
                                        onChange={e => setTaskName(e.target.value)}
                                    />
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Data Source & Auth */}
                    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                        <div className="border-b border-gray-200 px-6 py-4 flex items-center gap-2 bg-[#0144DB]/5">
                            <Database className="w-5 h-5 text-[#0144DB]" />
                            <h2 className="font-semibold text-lg text-[#0144DB]">{t('sourceSystem')}</h2>
                        </div>
                        <div className="p-6 space-y-5">
                            <div>
                                <label className="block text-sm font-medium mb-1.5 text-gray-700">{t('labelPlatform')}</label>
                                <div className="flex flex-wrap gap-3">
                                    {[
                                        { id: 'confluence', name: 'Confluence', icon: ConfluenceIcon, colorClass: 'text-[#0144DB]' },
                                        { id: 'jira', name: 'Jira', icon: JiraIcon, colorClass: 'text-[#0052CC]' },
                                        { id: 'gitlab', name: 'GitLab', icon: GitLabIcon, colorClass: 'text-[#FC6D26]' }
                                    ].map(plt => {
                                        const IconComponent = plt.icon;
                                        return (
                                            <button
                                                key={plt.id}
                                                type="button"
                                                onClick={() => {
                                                    setSource(plt.id as any);
                                                    if (!selectedTaskId) applyDefaultsForSource(plt.id as any);
                                                }}
                                                className={`flex items-center gap-2.5 px-4 py-2.5 rounded-xl border-2 transition-all ${
                                                    source === plt.id 
                                                        ? 'border-[#0144DB] bg-blue-50/50 shadow-sm' 
                                                        : 'border-gray-100 bg-white hover:border-gray-200'
                                                }`}
                                            >
                                                <IconComponent className={`w-5 h-5 ${plt.colorClass}`} />
                                                <span className={`text-sm font-bold ${source === plt.id ? 'text-[#0144DB]' : 'text-gray-600'}`}>{plt.name}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-5 gap-y-4">
                                {/* Row 1: URL & Username */}
                                <div>
                                    <label className="block text-sm font-medium mb-1.5 text-gray-700">
                                        {source === 'confluence' ? t('labelBaseUrl') : source === 'gitlab' ? 'GitLab Instance URL' : 'Jira Instance URL'}
                                    </label>
                                    <div className="relative">
                                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                            <LinkIcon className="h-4 w-4 text-gray-400" />
                                        </div>
                                        <input
                                            type="text"
                                            className="w-full rounded-xl border border-gray-300 bg-white pl-10 pr-3 py-2 text-sm focus:border-zalopay-blue focus:ring-zalopay-blue shadow-sm"
                                            value={url}
                                            placeholder={source === 'confluence' ? 'https://confluence.example.com' : source === 'gitlab' ? 'https://gitlab.com' : 'https://your-domain.atlassian.net'}
                                            onChange={e => setUrl(e.target.value)}
                                        />
                                    </div>
                                </div>
                                {authMode !== "required" && (
                                    <div>
                                        <label className="block text-sm font-medium mb-1.5 text-gray-700">
                                            {source === 'gitlab' ? 'GitLab Username (optional)' : t('labelUsername')}
                                        </label>
                                        <input
                                            type="text"
                                            className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm focus:border-zalopay-blue focus:ring-zalopay-blue shadow-sm"
                                            value={username}
                                            placeholder={source === 'jira' ? 'your-email@company.com' : 'username'}
                                            onChange={e => setUsername(e.target.value)}
                                        />
                                    </div>
                                )}

                                {/* Row 2: Credential & Project ID/Key */}
                                {authMode === "required" ? (
                                    <div>
                                        <label className="block text-sm font-medium mb-1.5 text-gray-700">
                                            Thông tin xác thực (Credential Vault)
                                        </label>
                                        <select
                                            value={selectedCredRef ? `${selectedCredRef.source}:${selectedCredRef.label}` : ""}
                                            onChange={(e) => {
                                                if (e.target.value === "") {
                                                    setSelectedCredRef(null);
                                                } else {
                                                    const [s, l] = e.target.value.split(":");
                                                    setSelectedCredRef({ source: s, label: l });
                                                }
                                            }}
                                            className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm focus:border-[#0144DB] focus:outline-none focus:ring-1 focus:ring-[#0144DB] shadow-sm"
                                        >
                                            <option value="">-- Chọn Credential --</option>
                                            {userCredentials
                                                .filter((c: any) => c.source === source)
                                                .map((c: any) => (
                                                    <option key={c.id} value={`${c.source}:${c.label}`}>
                                                        {c.label} ({c.username})
                                                    </option>
                                                ))
                                            }
                                        </select>
                                        {userCredentials.filter((c: any) => c.source === source).length === 0 && (
                                            <p className="text-[10px] text-red-500 mt-1">
                                                Bạn chưa cấu hình credential cho {source}. Vui lòng tới <Link href="/account" className="underline text-blue-600">Tài khoản</Link> để cấu hình.
                                            </p>
                                        )}
                                    </div>
                                ) : (
                                    <div>
                                        <label className="block text-sm font-medium mb-1.5 text-gray-700">
                                            {source === 'confluence' ? t('labelApiKey') : source === 'gitlab' ? 'Personal Access Token' : 'Jira API Token'}
                                        </label>
                                        <div className="relative">
                                            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                                <Key className="h-4 w-4 text-gray-400" />
                                            </div>
                                            <input
                                                type="password"
                                                className="w-full rounded-xl border border-gray-300 bg-white pl-10 pr-3 py-2 text-sm focus:border-zalopay-blue focus:ring-zalopay-blue shadow-sm"
                                                placeholder={source === 'confluence' ? t('phApiKey') : 'glpat-xxxxxxxx'}
                                                value={apiKey}
                                                onChange={e => setApiKey(e.target.value)}
                                            />
                                        </div>
                                    </div>
                                )}
                                <div className={source === 'confluence' ? 'invisible pointer-events-none' : ''}>
                                    <label className="block text-sm font-medium mb-1.5 text-gray-700">
                                        {source === 'gitlab' ? 'Project Path / ID' : 'Project Key'}
                                    </label>
                                    <input
                                        type="text"
                                        className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm focus:border-zalopay-blue focus:ring-zalopay-blue shadow-sm"
                                        placeholder={source === 'gitlab' ? "group/project or 12345" : "PROJ"}
                                        value={source === 'gitlab' ? projectId : projectKey}
                                        onChange={e => source === 'gitlab' ? setProjectId(e.target.value) : setProjectKey(e.target.value)}
                                    />
                                    {source === 'gitlab' && <p className="text-[9px] text-gray-400 mt-1 italic">Để trống nếu muốn đồng bộ theo Nhóm (Group)</p>}
                                </div>

                                {/* Row 3: Group/JQL & Branch (Empty if Jira/Conf) */}
                                <div className={source === 'confluence' ? 'invisible pointer-events-none' : ''}>
                                    <label className="block text-sm font-medium mb-1.5 text-gray-700">
                                        {source === 'gitlab' ? 'Group Path / ID' : 'JQL Filter (Optional)'}
                                    </label>
                                    <input
                                        type="text"
                                        className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm focus:border-zalopay-blue focus:ring-zalopay-blue shadow-sm"
                                        placeholder={source === 'gitlab' ? "group or wealth/mmf" : 'status = "In Progress"'}
                                        value={source === 'gitlab' ? groupId : jql}
                                        onChange={e => source === 'gitlab' ? setGroupId(e.target.value) : setJql(e.target.value)}
                                    />
                                    {source === 'gitlab' && <p className="text-[9px] text-gray-400 mt-1 italic">Dùng để đồng bộ tất cả repo trong Nhóm</p>}
                                </div>
                                <div className={source !== 'gitlab' ? 'invisible pointer-events-none' : ''}>
                                    <label className="block text-sm font-medium mb-1.5 text-gray-700">Branch</label>
                                    <input
                                        type="text"
                                        className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm focus:border-zalopay-blue focus:ring-zalopay-blue shadow-sm"
                                        placeholder="main"
                                        value={branch}
                                        onChange={e => setBranch(e.target.value)}
                                    />
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Crawl Rules - Only for Confluence */}
                    <div className={`transition-all duration-500 overflow-hidden ${source === 'confluence' ? 'max-h-[2000px] opacity-100 mb-6' : 'max-h-0 opacity-0 mb-0'}`}>
                        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                            <div className="border-b border-gray-200 px-6 py-4 flex items-center justify-between bg-[#0144DB]/5">
                                <div className="flex items-center gap-2">
                                    <Settings className="w-5 h-5 text-[#0144DB]" />
                                    <h2 className="font-semibold text-lg text-[#0144DB]">{t('crawlingRules')}</h2>
                                </div>
                                <button
                                    onClick={() => setRules([...rules, { id: Date.now().toString(), keywords: "", parentUrl: "", includeChildren: false }])}
                                    className="flex items-center gap-1 px-3 py-1.5 bg-white border border-[#0144DB] text-[#0144DB] text-sm font-medium rounded-lg hover:bg-[#0144DB]/5 transition-colors shadow-sm"
                                >
                                    <Plus className="w-4 h-4" /> {t('addRule')}
                                </button>
                            </div>
                            <div className="p-6 space-y-6">
                                {rules.map((rule, idx) => (
                                    <div key={rule.id} className="relative bg-gray-50 border border-gray-200 rounded-xl p-5 shadow-sm group">
                                    <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button
                                            onClick={() => setRules(rules.filter(r => r.id !== rule.id))}
                                            className="p-1.5 bg-white text-red-500 hover:bg-red-50 hover:text-red-700 rounded-lg border border-red-100 shadow-sm"
                                            title={t('deleteRuleText')}
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                    <h3 className="text-sm font-bold text-gray-800 mb-4 flex items-center gap-2">
                                        <span className="bg-[#0144DB] text-white w-6 h-6 inline-flex items-center justify-center rounded-full text-xs">{idx + 1}</span> Rule #{idx + 1}
                                    </h3>
                                    <div className="space-y-4">
                                        <div>
                                            <label className="block text-sm font-medium mb-1.5 text-gray-700">{t('labelParentUrl')}</label>
                                            <p className="text-xs text-gray-500 mb-2">{t('descParentUrl')}</p>
                                            <input
                                                type="text"
                                                className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm focus:border-[#0144DB] focus:ring-[#0144DB]"
                                                value={rule.parentUrl}
                                                placeholder="https://confluence.example.com/pages/viewpage.action?pageId=1234567"
                                                onChange={e => {
                                                    const newRules = [...rules];
                                                    newRules[idx].parentUrl = e.target.value;
                                                    setRules(newRules);
                                                }}
                                            />
                                            <div className="mt-4 flex items-start gap-3 bg-white border border-gray-200 p-3 rounded-xl shadow-sm">
                                                <input
                                                    type="checkbox"
                                                    id={`includeChildren-${rule.id}`}
                                                    className="w-5 h-5 mt-0.5 rounded border-gray-300 text-[#0144DB] focus:ring-[#0144DB] cursor-pointer"
                                                    checked={rule.includeChildren}
                                                    onChange={e => {
                                                        const newRules = [...rules];
                                                        newRules[idx].includeChildren = e.target.checked;
                                                        setRules(newRules);
                                                    }}
                                                />
                                                <div>
                                                    <label htmlFor={`includeChildren-${rule.id}`} className="text-sm font-medium block text-gray-900 cursor-pointer">{t('labelIncludeChildren')}</label>
                                                    <p className="text-xs text-gray-500 mt-0.5">{t('descIncludeChildren')}</p>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="relative border-t border-gray-200 pt-4">
                                            <label className="block text-sm font-medium mb-1.5 text-gray-700">{t('labelKeywordsSearch')}</label>
                                            <p className="text-xs text-gray-500 mb-2">{t('descKeywordsSearch')}</p>
                                            <input
                                                type="text"
                                                className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm focus:border-[#0144DB] focus:ring-[#0144DB]"
                                                value={rule.keywords}
                                                placeholder={t('phKeywordsSearch')}
                                                onChange={e => {
                                                    const newRules = [...rules];
                                                    newRules[idx].keywords = e.target.value;
                                                    setRules(newRules);
                                                }}
                                            />
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>

                        {rules.length === 0 && (
                                <div className="text-center py-8 text-gray-500 border border-dashed border-gray-300 rounded-xl bg-gray-50">
                                    <p className="text-sm">Chưa có quy tắc thu thập nào. Vui lòng bấm "Thêm Rule" để bắt đầu.</p>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Auto Sync Settings */}
                    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                        <div className="border-b border-gray-200 px-6 py-4 flex items-center justify-between bg-[#0144DB]/5">
                            <div className="flex items-center gap-2">
                                <Bot className="w-5 h-5 text-[#0144DB]" />
                                <h2 className="font-semibold text-lg text-[#0144DB]">{t('syncTitle')}</h2>
                            </div>
                            <label className="flex items-center gap-3 cursor-pointer bg-white px-3 py-2 rounded-xl border border-gray-200 hover:bg-gray-50 transition-colors shadow-sm">
                                <div className="relative inline-flex items-center">
                                    <input
                                        type="checkbox"
                                        className="sr-only peer"
                                        checked={isAutoSync}
                                        onChange={e => setIsAutoSync(e.target.checked)}
                                    />
                                    <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#0144DB]"></div>
                                </div>
                                <span className="text-sm font-semibold text-gray-700">{t('syncBackground')}</span>
                            </label>
                        </div>
                        {isAutoSync && (
                            <div className="p-6 space-y-6 bg-blue-50/30">
                                <div className="flex items-center gap-2 bg-blue-50 text-blue-700 p-3 rounded-lg text-sm mb-2 shadow-sm border border-blue-100">
                                    <AlertCircle className="w-4 h-4 shrink-0" />
                                    <span>{t('syncAlert')}</span>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                    <div>
                                        <label className="block text-sm font-medium mb-1.5 text-gray-700">{t('syncFrequency')}</label>
                                        <select
                                            className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-[#0144DB] focus:outline-none focus:ring-1 focus:ring-[#0144DB]"
                                            value={syncFrequency}
                                            onChange={e => setSyncFrequency(e.target.value)}
                                        >
                                            <option value="hourly">{t('syncFreqHourly')}</option>
                                            <option value="daily">{t('syncFreqDaily')}</option>
                                            <option value="weekly">{t('syncFreqWeekly')}</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium mb-1.5 text-gray-700">{t('syncTime')}</label>
                                        <input
                                            type="time"
                                            className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-[#0144DB] focus:ring-[#0144DB]"
                                            value={syncTime}
                                            onChange={e => setSyncTime(e.target.value)}
                                            disabled={syncFrequency === 'hourly'}
                                        />
                                    </div>
                                </div>
                                {lastSyncTime && (
                                    <div className="text-xs text-gray-500 font-medium">
                                        {t('lastSync')} <span className="text-gray-900">{new Date(lastSyncTime).toLocaleString(language === 'vi' ? 'vi-VN' : 'en-US')}</span>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Output Settings */}
                    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                        <div className="border-b border-gray-200 px-6 py-4 flex items-center justify-between bg-[#0144DB]/5">
                            <div className="flex items-center gap-2">
                                <FileText className="w-5 h-5 text-[#0144DB]" />
                                <h2 className="font-semibold text-lg text-[#0144DB]">{t('outputConfig')}</h2>
                            </div>
                            <label className="flex items-center gap-3 cursor-pointer bg-white px-3 py-2 rounded-xl border border-gray-200 hover:bg-gray-50 transition-colors shadow-sm">
                                <div className="relative inline-flex items-center">
                                    <input
                                        type="checkbox"
                                        className="sr-only peer"
                                        checked={downloadFiles}
                                        onChange={e => setDownloadFiles(e.target.checked)}
                                    />
                                    <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#0144DB]"></div>
                                </div>
                                <span className="text-sm font-semibold text-gray-700">{t('labelDownload')}</span>
                            </label>
                        </div>

                        {downloadFiles ? (
                            <div className="p-6 space-y-6">
                                <div>
                                    <label className="block text-sm font-medium mb-3 text-gray-700">{t('labelFormat')}</label>
                                    <div className="flex gap-6">
                                        <label className="flex items-center gap-2 cursor-pointer">
                                            <input
                                                type="checkbox"
                                                className="w-5 h-5 rounded border-gray-300 text-[#0144DB] focus:ring-[#0144DB]"
                                                checked={formats.includes('md')}
                                                onChange={() => handleFormatToggle('md')}
                                            />
                                            <span className="text-gray-900 font-medium">Markdown (.md)</span>
                                        </label>
                                        <label className="flex items-center gap-2 cursor-pointer">
                                            <input
                                                type="checkbox"
                                                className="w-5 h-5 rounded border-gray-300 text-[#0144DB] focus:ring-[#0144DB]"
                                                checked={formats.includes('pdf')}
                                                onChange={() => handleFormatToggle('pdf')}
                                            />
                                            <span className="text-gray-900 font-medium">PDF (.pdf)</span>
                                        </label>
                                        <label className="flex items-center gap-2 cursor-pointer">
                                            <input
                                                type="checkbox"
                                                className="w-5 h-5 rounded border-gray-300 text-[#0144DB] focus:ring-[#0144DB]"
                                                checked={formats.includes('raw')}
                                                onChange={() => handleFormatToggle('raw')}
                                            />
                                            <span className="text-gray-900 font-medium">{t('formatOriginal')}</span>
                                        </label>
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium mb-1.5 text-gray-700">{t('labelOutputDir')}</label>
                                    <div className="relative">
                                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                            <Folder className="h-4 w-4 text-gray-400" />
                                        </div>
                                        <input
                                            type="text"
                                            className="w-full rounded-xl border border-gray-300 bg-white pl-10 pr-3 py-2 text-sm focus:border-zalopay-blue focus:ring-zalopay-blue"
                                            value={outputDir}
                                            onChange={e => setOutputDir(e.target.value)}
                                            placeholder="/Users/username/Desktop/Output"
                                        />
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="px-6 py-5 bg-gray-50 flex items-center gap-3">
                                <AlertCircle className="w-5 h-5 text-gray-400" />
                                <p className="text-sm text-gray-600">{t('descNoDownload')}</p>
                            </div>
                        )}
                    </div>

                    {/* AI Query Specification */}
                    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                        <div className="border-b border-gray-200 px-6 py-4 flex items-center justify-between bg-[#0144DB]/5">
                            <div className="flex items-center gap-2">
                                <Bot className="w-5 h-5 text-[#0144DB]" />
                                <h2 className="font-semibold text-lg text-[#0144DB]">{t('aiConfig')}</h2>
                            </div>
                            <label className="flex items-center gap-3 cursor-pointer bg-white px-3 py-2 rounded-xl border border-gray-200 hover:bg-gray-50 transition-colors shadow-sm">
                                <div className="relative inline-flex items-center">
                                    <input
                                        type="checkbox"
                                        className="sr-only peer"
                                        checked={enableAiProcessing}
                                        onChange={e => setEnableAiProcessing(e.target.checked)}
                                    />
                                    <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#0144DB]"></div>
                                </div>
                                <span className="text-sm font-semibold text-gray-700">{t('labelAiEnable')}</span>
                            </label>
                        </div>

                        {enableAiProcessing && (
                            <div className="p-6 space-y-6">
                                <div>
                                    <label className="block text-sm font-medium mb-1.5 text-gray-700">{t('labelAiPrompt')}</label>
                                    <p className="text-xs text-gray-500 mb-3">{t('descAiPrompt')}</p>
                                    <textarea
                                        className="w-full rounded-xl border border-gray-300 bg-white px-3 py-3 text-sm focus:border-[#0144DB] focus:ring-[#0144DB] min-h-[120px] resize-y"
                                        value={queryPrompt}
                                        placeholder="Ví dụ: Tóm tắt lại luồng lỗi khi Redeem MMF, trích xuất tất cả các bảng mã lỗi thành định dạng bảng..."
                                        onChange={e => setQueryPrompt(e.target.value)}
                                    />
                                </div>
                                <div className="pt-2 border-t border-gray-100">
                                    <label className="block text-sm font-medium mb-1.5 text-gray-700">{t('labelAiModel')}</label>
                                    <select
                                        className="w-full sm:w-1/2 rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm focus:border-[#0144DB] focus:ring-[#0144DB]"
                                        value={modelSelection}
                                        onChange={e => setModelSelection(e.target.value)}
                                    >
                                        <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
                                        <option value="gemini-3.1">Gemini 3.1</option>
                                        <option value="gemini-3.0">Gemini 3.0</option>
                                        <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
                                        <option value="gemini-2.0-flash">Gemini 2.0 Flash</option>
                                    </select>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Actions and Execution Panel */}
                <div className="space-y-6">
                        <div className="flex flex-col gap-4 pt-6 border-t border-gray-200">
                            <div className="flex flex-col sm:flex-row gap-4">
                                <button
                                    onClick={saveTask}
                                    disabled={isRunning}
                                    className="flex-1 flex items-center justify-center gap-2 bg-white border-2 border-[#0144DB] text-[#0144DB] hover:bg-blue-50 disabled:opacity-50 disabled:cursor-not-allowed px-6 py-4 rounded-2xl font-bold shadow-sm transition-all text-lg"
                                >
                                    <CheckCircle2 className="w-5 h-5" /> 
                                    Lưu tác vụ
                                </button>
                                
                                {isRunning ? (
                                    <button
                                        onClick={handleStop}
                                        className="flex-1 flex items-center justify-center gap-2 bg-red-500 hover:bg-red-600 text-white px-6 py-4 rounded-2xl font-bold shadow-sm transition-all text-lg"
                                    >
                                        <AlertCircle className="w-5 h-5 fill-current" /> {t('stopProcessing')}
                                    </button>
                                ) : (
                                    <button
                                        onClick={handleRun}
                                        disabled={authMode === "required" ? !selectedCredRef : !apiKey}
                                        className="flex-1 flex items-center justify-center gap-2 bg-[#33D387] hover:opacity-90 disabled:bg-gray-300 disabled:cursor-not-allowed text-white px-6 py-4 rounded-2xl font-bold shadow-sm transition-all text-lg"
                                    >
                                        <Play className="w-5 h-5 fill-current" /> Thực hiện ngay
                                    </button>
                                )}
                            </div>
                        </div>
                        {testMessage && (
                            <p className={`text-sm px-2 font-medium ${testStatus === 'success' ? 'text-green-600' : 'text-red-500'}`}>
                                {testMessage}
                            </p>
                        )}

                        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden flex flex-col mb-12">
                            <div className="h-[400px] bg-gray-900 p-4 font-mono text-xs overflow-y-auto">
                                {statusLogs.length === 0 ? (
                                    <div className="h-full flex flex-col items-center justify-center text-gray-500 space-y-3">
                                        <Settings className="w-8 h-8 opacity-20" />
                                        <p>{t('logsPlaceholder')}</p>
                                    </div>
                                ) : (
                                    <div className="space-y-1">
                                        {statusLogs.map((log, idx) => (
                                            <div key={idx} className={`${log.type === 'error' ? 'text-red-400' :
                                                log.type === 'done' ? 'text-zalopay-green font-bold mt-4' :
                                                    'text-gray-300'
                                                }`}>
                                                {log.type === 'done' ? (
                                                    <span className="flex items-center gap-2 mt-2">
                                                        <CheckCircle2 className="w-4 h-4 text-zalopay-green" />
                                                        [{t('doneWithCode')} {log.code}]
                                                    </span>
                                                ) : (
                                                    <span className={`${log.message?.includes('401 Client Error') ? 'text-red-500 font-medium' : ''}`}>
                                                        {log.message}
                                                    </span>
                                                )}
                                            </div>
                                        ))}
                                        <div ref={logsEndRef} />
                                    </div>
                                )}
                            </div>

                            {isComplete && (
                                <div className="border-t border-gray-200 p-4 bg-zalopay-bg">
                                    <div className="flex items-start gap-3 mb-4">
                                        <CheckCircle2 className="w-6 h-6 text-zalopay-green shrink-0" />
                                        <div>
                                            <h3 className="font-semibold text-zalopay-green">{t('completeTitle')} ({processedFiles} file)!</h3>
                                            <p className="text-xs text-gray-600 mt-1">
                                                {t('completeDesc1')} {processedFiles} {t('completeDesc2')}
                                            </p>
                                        </div>
                                    </div>
                                    {authMode !== "required" ? (
                                        <button
                                            onClick={handleViewResults}
                                            className="w-full flex items-center justify-center gap-2 bg-white border border-gray-300 hover:bg-zalopay-bg px-4 py-3 rounded-xl text-sm font-medium transition-colors"
                                        >
                                            <Folder className="w-4 h-4" />
                                            Xem thư mục kết quả
                                        </button>
                                    ) : (
                                        <div className="mt-4 border-t border-gray-200 pt-4">
                                            <h4 className="text-sm font-bold text-gray-800 mb-2 flex items-center gap-1.5">
                                                <Bot className="w-4 h-4 text-[#0144DB]" />
                                                Đồng bộ tri thức lên Agent Admin
                                            </h4>
                                            <div className="space-y-3">
                                                <div>
                                                    <label className="block text-xs font-semibold text-gray-500 mb-1">Đường dẫn đích trên Agent (Path Prefix)</label>
                                                    <input
                                                        type="text"
                                                        className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-xs focus:border-[#0144DB] focus:ring-[#0144DB] shadow-sm"
                                                        value={pathPrefix}
                                                        onChange={e => setPathPrefix(e.target.value)}
                                                        placeholder="Ví dụ: 02. Context/Confluence/MMF"
                                                    />
                                                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                                                        <span className="text-[10px] text-gray-400 self-center">Gợi ý:</span>
                                                        {(ALLOWED_PREFIXES[source] || []).map(p => (
                                                            <button
                                                                key={p}
                                                                type="button"
                                                                onClick={() => setPathPrefix(p)}
                                                                className="px-2 py-0.5 rounded bg-gray-100 text-gray-600 hover:bg-gray-200 text-[10px] font-medium transition-colors"
                                                            >
                                                                {p}
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                                
                                                <div className="flex flex-col gap-2">
                                                    <button
                                                        onClick={handlePushCheck}
                                                        disabled={pushStatus === "checking" || pushStatus === "pushing"}
                                                        className="w-full flex items-center justify-center gap-1.5 bg-[#0144DB] hover:opacity-90 disabled:opacity-50 text-white px-4 py-2.5 rounded-xl text-xs font-bold transition-all shadow-sm"
                                                    >
                                                        {pushStatus === "checking" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Activity className="w-3.5 h-3.5" />}
                                                        Kiểm tra delta
                                                    </button>

                                                    {pushStatus === "ready" && (
                                                        <div className="relative group w-full">
                                                            <button
                                                                disabled
                                                                className="w-full flex items-center justify-center gap-1.5 bg-gray-100 text-gray-400 border border-gray-200 px-4 py-2.5 rounded-xl text-xs font-bold cursor-not-allowed transition-all"
                                                            >
                                                                Đẩy tri thức (Sắp có)
                                                            </button>
                                                            <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 w-64 bg-zinc-900 text-white text-[10px] p-2 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-20 shadow-md text-center">
                                                                Tính năng đóng gói delta zip tự động đang được phát triển.
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                                
                                                {pushMessage && (
                                                    <div className={`p-3 rounded-xl border text-xs leading-relaxed ${
                                                        pushStatus === "success" || pushStatus === "ready"
                                                            ? "bg-green-50 border-green-200 text-green-700" 
                                                            : pushStatus === "error"
                                                            ? "bg-red-50 border-red-200 text-red-700"
                                                            : "bg-blue-50 border-blue-200 text-blue-700"
                                                    }`}>
                                                        <p className="font-semibold">{pushMessage}</p>
                                                        {pushStatus === "ready" && (
                                                            <p className="mt-1 text-[11px] text-gray-500 font-medium">
                                                                Thông tin delta sẵn sàng. Dòng chảy tri thức lên Agent Admin đã được kích hoạt.
                                                            </p>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* AI Output Window */}
                            {llmOutput && (
                                <div className="border-t border-gray-200">
                                    <div className="bg-green-500/10 px-6 py-4 border-b border-gray-200 flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <Bot className="w-5 h-5 text-green-600" />
                                            <h3 className="font-semibold text-lg text-green-600">{t('aiResultTitle')} ({modelSelection})</h3>
                                        </div>
                                        <div className="flex gap-3">
                                            <button
                                                onClick={handleGenerateImage}
                                                disabled={isGeneratingImage}
                                                className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all shadow-sm border bg-white text-gray-700 border-gray-300 hover:bg-gray-50 disabled:opacity-50"
                                            >
                                                {isGeneratingImage ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImageIcon className="w-4 h-4" />}
                                                Tạo ảnh minh hoạ
                                            </button>
                                            <button
                                                onClick={handleGenerateDiagram}
                                                disabled={isGeneratingDiagram}
                                                className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all shadow-sm border bg-white text-gray-700 border-gray-300 hover:bg-gray-50 disabled:opacity-50"
                                            >
                                                {isGeneratingDiagram ? <Loader2 className="w-4 h-4 animate-spin" /> : <Network className="w-4 h-4" />}
                                                Tạo sơ đồ
                                            </button>
                                        </div>
                                    </div>
                                    <div className="bg-gray-50 px-8 py-10 transition-colors overflow-x-auto border-t border-gray-200">
                                        <div className="max-w-none">
                                            <div data-color-mode="light" className="w-full mb-10 relative z-10">
                                                <div className="flex border border-gray-200 border-b-0 rounded-t-xl bg-gray-100 px-4 py-3 justify-between items-center relative z-20 mx-[-1px]">
                                                    <h4 className="font-semibold text-gray-800 m-0 flex items-center gap-2">
                                                        <Edit2 className="w-5 h-5 text-blue-600" /> {t('editorTitle')}
                                                    </h4>
                                                    <button
                                                        onClick={handleDownloadMarkdown}
                                                        className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold transition-all shadow-sm shrink-0"
                                                    >
                                                        <Download className="w-4 h-4" /> {t('dlMdBtn')}
                                                    </button>
                                                </div>
                                                <div className="rounded-b-xl overflow-hidden shadow-sm border border-gray-200 mx-[-1px] mb-[-1px]">
                                                    <MDEditor
                                                        value={editedContent}
                                                        onChange={(val) => setEditedContent(val || '')}
                                                        height={800}
                                                        visibleDragbar={false}
                                                        preview="preview"
                                                    />
                                                </div>
                                            </div>
                                            {illustrationUrl && !isIllustrationError && (
                                                <div className="mb-8 w-full">
                                                    <div className="flex border border-gray-200 border-b-0 rounded-t-xl bg-gray-100 px-4 py-3 justify-between items-center relative z-20">
                                                        <h4 className="font-semibold text-gray-800 m-0 flex items-center gap-2">
                                                            <ImageIcon className="w-5 h-5 text-purple-600" /> {t('aiImageTitle')}
                                                        </h4>
                                                        <button
                                                            onClick={handleDownloadImage}
                                                            className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-xs font-semibold transition-all shadow-sm shrink-0"
                                                        >
                                                            <Download className="w-4 h-4" /> {t('dlImgBtn')}
                                                        </button>
                                                    </div>
                                                    <img
                                                        src={illustrationUrl}
                                                        alt="AI Generated Illustration"
                                                        className="w-full h-auto rounded-b-xl shadow-sm border border-gray-200"
                                                        onError={() => setIsIllustrationError(true)}
                                                    />
                                                    {illustrationPrompt && <p className="text-center text-xs text-gray-400 mt-2 italic flex justify-center items-center gap-2"><ImageIcon className="w-3 h-3" /> {t('imgPrompt')} {illustrationPrompt}</p>}
                                                </div>
                                            )}
                                            {illustrationUrl && isIllustrationError && (
                                                <div className="mb-8 w-full bg-slate-50 border border-slate-200 rounded-xl p-10 flex flex-col items-center justify-center text-slate-500 shadow-sm">
                                                    <ImageIcon className="w-8 h-8 mb-3 opacity-50" />
                                                    <p className="font-medium text-sm text-center">{t('imgErrorDesc1')}</p>
                                                    <p className="text-xs max-w-md text-center mt-2 opacity-75">Gợi ý {t('imgPrompt')} {illustrationPrompt}</p>
                                                </div>
                                            )}
                                            {diagramCode && (
                                                <div className="mb-8 w-full">
                                                    <div className="flex border border-gray-200 border-b-0 rounded-t-xl bg-gray-100 px-4 py-3 justify-between items-center relative z-20">
                                                        <h4 className="font-semibold text-gray-800 m-0 flex items-center gap-2">
                                                            <Network className="w-5 h-5 text-orange-600" /> {t('aiDiagTitle')}
                                                        </h4>
                                                        <button
                                                            onClick={handleDownloadDiagram}
                                                            className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-600 hover:bg-orange-700 text-white rounded-lg text-xs font-semibold transition-all shadow-sm shrink-0"
                                                        >
                                                            <Download className="w-4 h-4" /> {t('dlSvgBtn')}
                                                        </button>
                                                    </div>
                                                    <div className="bg-white border border-gray-200 rounded-b-xl p-4 overflow-x-auto shadow-sm">
                                                        <MermaidDiagram chart={diagramCode} />
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

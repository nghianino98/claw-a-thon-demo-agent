"use client";

import { useEffect, useState, useMemo, useRef, useCallback } from "react";
import { Clock, Search, ExternalLink, Calendar, CheckCircle2, AlertCircle, Trash2, DollarSign, Calculator, X, Eye, Cpu, Settings2, Check } from "lucide-react";
import Link from "next/link";
import { DayPicker, DateRange } from "react-day-picker";
import "react-day-picker/style.css";
import { format } from "date-fns";
import { vi } from "date-fns/locale";

type HistoryEntry = {
    id: string; // timestamp
    taskName: string;
    modelName?: string;
    date: string; // ISO String
    url: string;
    keywords: string;
    status: 'success' | 'error';
    inputTokens: number;
    outputTokens: number;
    processedFiles: number;
    type?: 'manual' | 'auto'; // New field for categorization
    errorLog?: string; // Detailed error log for debugging
}

import { useI18nStore, useTranslation } from "@/lib/store/i18n-store";

const DEFAULT_COLUMN_WEIGHTS = {
    time: 160, task: 350, mode: 90, docs: 90,
    result: 110, model: 170, cost: 130, action: 110
};

export default function HistoryPage() {
    const [history, setHistory] = useState<HistoryEntry[]>([]);
    const [searchTerm, setSearchTerm] = useState("");
    const [filterType, setFilterType] = useState("all"); // all | manual | auto
    const [filterStatus, setFilterStatus] = useState("all"); // all | success | error
    const [filterPlatform, setFilterPlatform] = useState("all"); // all | confluence | jira | gitlab
    const [dateRange, setDateRange] = useState<DateRange | undefined>();
    const [showDatePicker, setShowDatePicker] = useState(false);
    const [currency, setCurrency] = useState<'USD' | 'VND'>('USD');
    const [showPricingModal, setShowPricingModal] = useState(false);
    const [selectedEntry, setSelectedEntry] = useState<HistoryEntry | null>(null);
    const [columns, setColumns] = useState({
        time: true, task: true, mode: true, docs: true,
        result: true, model: true, cost: true, action: true
    });
    const [columnWeights, setColumnWeights] = useState(DEFAULT_COLUMN_WEIGHTS);
    const [showColumnMenu, setShowColumnMenu] = useState(false);
    const t = useTranslation();
    const pageHeaderRef = useRef<HTMLDivElement>(null);
    const columnMenuRef = useRef<HTMLDivElement>(null);
    const tableRef = useRef<HTMLTableElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (columnMenuRef.current && !columnMenuRef.current.contains(event.target as Node)) {
                setShowColumnMenu(false);
            }
        };
        if (showColumnMenu) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [showColumnMenu]);

    useEffect(() => {
        const saved = localStorage.getItem('historyColumns');
        if (saved) {
            try {
                setColumns(prev => ({ ...prev, ...JSON.parse(saved) }));
            } catch(e) {}
        }
        const savedWeights = localStorage.getItem('historyColumnWeights');
        if (savedWeights) {
            try {
                setColumnWeights({ ...DEFAULT_COLUMN_WEIGHTS, ...JSON.parse(savedWeights) });
            } catch(e) {}
        }
    }, []);

    const toggleColumn = (key: keyof typeof columns) => {
        setColumns(prev => {
            const next = { ...prev, [key]: !prev[key] };
            localStorage.setItem('historyColumns', JSON.stringify(next));
            return next;
        });
    };
    
    const [headerHeight, setHeaderHeight] = useState(148);

    useEffect(() => {
        const measure = () => {
            if (pageHeaderRef.current) {
                setHeaderHeight(pageHeaderRef.current.offsetHeight);
            }
        };
        measure();
        window.addEventListener('resize', measure);
        return () => window.removeEventListener('resize', measure);
    }, []);

    const hasActiveFilter = filterType !== 'all' || filterStatus !== 'all' || filterPlatform !== 'all' || searchTerm !== '' || dateRange?.from;

    const fetchHistory = useCallback(async () => {
        try {
            const res = await fetch('/api/history');
            const data = await res.json();
            setHistory(Array.isArray(data) ? data : []);
        } catch (e) {
            console.error("Failed to fetch history:", e);
            setHistory([]);
        }
    }, []);

    useEffect(() => {
        fetchHistory();
    }, [fetchHistory]);

    const clearHistory = async () => {
        if (confirm(t('clearHistory'))) {
            try {
                await fetch('/api/history', { method: 'DELETE' });
                setHistory([]);
            } catch (e) {
                console.error("Failed to clear history:", e);
            }
        }
    };

    const deleteEntry = async (id: string) => {
        try {
            await fetch(`/api/history?id=${id}`, { method: 'DELETE' });
            setHistory(prev => prev.filter(h => h.id !== id));
        } catch (e) {
            console.error("Failed to delete entry:", e);
        }
    };

    const filteredHistory = useMemo(() => {
        if (!Array.isArray(history)) return [];
        return history.filter(h => {
            const nameMatch = !searchTerm ||
                (h.taskName || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
                (h.keywords || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
                (h.url || "").toLowerCase().includes(searchTerm.toLowerCase());
            const typeMatch = filterType === 'all' || (h.type || 'manual') === filterType;
            const statusMatch = filterStatus === 'all' || h.status === filterStatus;
            const platformMatch = filterPlatform === 'all' ||
                (h.url || '').toLowerCase().includes(filterPlatform === 'confluence' ? 'confluence' : filterPlatform === 'jira' ? 'jira' : 'gitlab');
            const entryDate = new Date(h.date);
            const fromMatch = !dateRange?.from || entryDate >= new Date(dateRange.from.setHours(0,0,0,0));
            const toMatch = !dateRange?.to || entryDate <= new Date(dateRange.to.setHours(23,59,59,999));
            return nameMatch && typeMatch && statusMatch && platformMatch && fromMatch && toMatch;
        });
    }, [history, searchTerm, filterType, filterStatus, filterPlatform, dateRange]);

    const EXCHANGE_RATE = 25400; // 1 USD = 25,400 VND

    const formatCost = (tokens: number, ratePer1M: number) => {
        if (!tokens || tokens === 0) return currency === 'USD' ? "$0.0000" : "0 ₫";
        const costInUsd = (tokens / 1000000) * ratePer1M;
        if (currency === 'USD') {
            return "$" + costInUsd.toFixed(4);
        } else {
            return Math.round(costInUsd * EXCHANGE_RATE).toLocaleString('vi-VN') + " ₫";
        }
    };

    const handleResizeStart = (e: React.MouseEvent, key: keyof typeof columnWeights) => {
        e.preventDefault();
        e.stopPropagation();
        const tableWidth = tableRef.current?.offsetWidth || 1200;
        
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
                localStorage.setItem('historyColumnWeights', JSON.stringify(prev));
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
    const getColWidth = (key: keyof typeof columnWeights) => `${(columnWeights[key] / totalWeight) * 100}%`;

    const renderTh = (key: keyof typeof DEFAULT_COLUMN_WEIGHTS, label: string, align: 'left'|'center'|'right') => {
        if (!columns[key]) return null;
        return (
            <th key={key} className={`px-6 py-4 font-semibold text-${align} relative group/th`}>
                {label}
                {key !== 'action' && (
                    <div 
                        onMouseDown={(e) => handleResizeStart(e, key)}
                        className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-[#0144DB] opacity-0 group-hover/th:opacity-100 transition-opacity z-10"
                    />
                )}
            </th>
        );
    };

    return (
        <div className="flex flex-col bg-zalopay-bg" style={{ height: '100%' }}>
            {/* Page header — always visible, no sticky needed */}
            <div ref={pageHeaderRef} className="shrink-0 px-6 pt-6 pb-4 flex flex-col sm:flex-row gap-4 sm:items-center justify-between">
                <div>
                    <h1 className="text-[2.5rem] font-bold tracking-tight text-gray-900 pb-1.5 inline-block">
                        {t('historyTitle')}
                    </h1>
                    <p className="mt-2 text-gray-500">{t('historyDesc')}</p>
                </div>
                {(Array.isArray(history) && history.length > 0) && (
                    <div className="flex items-center gap-3">
                        <div className="relative" ref={columnMenuRef}>
                            <button
                                onClick={() => setShowColumnMenu(p => !p)}
                                className={`h-10 flex items-center justify-center gap-2 px-4 border ${showColumnMenu ? 'border-[#0144DB] ring-1 ring-[#0144DB]/10' : 'border-gray-200'} text-gray-700 hover:bg-gray-50 rounded-xl font-bold transition-all text-sm bg-white shadow-sm`}
                            >
                                <Settings2 className="w-4 h-4" /> Ẩn/hiện cột
                            </button>
                             {showColumnMenu && (
                                <div className="absolute right-0 top-full mt-2 w-56 bg-white border border-gray-200 rounded-xl shadow-lg z-50 py-2">
                                    <div className="px-3 pb-2 mb-2 border-b border-gray-100 text-xs font-bold text-gray-400 uppercase tracking-wider">
                                        Tùy chỉnh hiển thị
                                    </div>
                                    {[
                                        { key: 'time', label: t('thTime') },
                                        { key: 'task', label: t('thTask') },
                                        { key: 'mode', label: t('thMode') },
                                        { key: 'docs', label: t('thDocs') },
                                        { key: 'result', label: t('thResult') },
                                        { key: 'model', label: t('thModel') },
                                        { key: 'cost', label: t('thCost') },
                                        { key: 'action', label: t('thAction') }
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
                        <div className="flex items-center bg-white border border-gray-200 rounded-xl p-1 shadow-sm">
                            <button onClick={() => setCurrency('USD')} className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1 ${currency === 'USD' ? 'bg-[#0144DB] text-white' : 'text-gray-500 hover:bg-gray-50'}`}>
                                <DollarSign className="w-3 h-3" /> USD
                            </button>
                            <button onClick={() => setCurrency('VND')} className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1 ${currency === 'VND' ? 'bg-[#0144DB] text-white' : 'text-gray-500 hover:bg-gray-50'}`}>
                                VNĐ
                            </button>
                        </div>
                        <button onClick={clearHistory} className="flex items-center justify-center gap-2 px-4 py-2 border border-red-200 text-red-600 hover:bg-red-50 rounded-xl font-medium transition-colors text-sm bg-white shadow-sm">
                            <Trash2 className="w-4 h-4" /> {t('clearHistory')}
                        </button>
                    </div>
                )}
            </div>

            {/* Table area — fills remaining height, tbody scrolls internally */}
            <div className="flex-1 min-h-0 px-6 pb-6 flex flex-col">
                <div className="flex-1 min-h-0 bg-white rounded-2xl border border-gray-200 shadow-sm flex flex-col overflow-hidden">

                    {(!Array.isArray(history) || history.length === 0) ? (
                        <div className="mx-4 my-16 py-16 flex flex-col items-center justify-center text-center border-2 border-dashed border-gray-300 rounded-2xl">
                            <Clock className="w-12 h-12 text-gray-300 mb-4" />
                            <h3 className="text-lg font-medium text-gray-900 mb-1">{t('emptyHistoryTitle')}</h3>
                            <p className="text-sm text-gray-500 max-w-sm mb-6">{t('emptyHistoryDesc')}</p>
                            <Link href="/knowledge-base" className="px-5 py-2.5 bg-[#0144DB] text-white rounded-xl font-medium shadow-sm transition-all hover:opacity-90 text-sm">
                                {t('btnNewTask')}
                            </Link>
                        </div>
                    ) : filteredHistory.length === 0 ? (
                        <div className="mx-4 my-8 p-16 flex flex-col items-center justify-center text-center border-2 border-dashed border-gray-300 rounded-2xl">
                            <Search className="w-12 h-12 text-gray-300 mb-4" />
                            <h3 className="text-lg font-medium text-gray-900 mb-1">{t('noSearchResults')} &quot;{searchTerm}&quot;</h3>
                        </div>
                    ) : (
                        <>
                            {/* Table header — always visible, never scrolls */}
                            <div className="shrink-0 relative z-10">
                                <table ref={tableRef} className="w-full text-xs text-gray-500 uppercase" style={{ tableLayout: 'fixed' }}>
                                    <colgroup>
                                        {columns.time && <col style={{ width: getColWidth('time') }} />}
                                        {columns.task && <col style={{ width: getColWidth('task') }} />}
                                        {columns.mode && <col style={{ width: getColWidth('mode') }} />}
                                        {columns.docs && <col style={{ width: getColWidth('docs') }} />}
                                        {columns.result && <col style={{ width: getColWidth('result') }} />}
                                        {columns.model && <col style={{ width: getColWidth('model') }} />}
                                        {columns.cost && <col style={{ width: getColWidth('cost') }} />}
                                        {columns.action && <col style={{ width: getColWidth('action') }} />}
                                    </colgroup>
                                    <thead className="bg-gray-50 border-b border-gray-200">
                                        <tr>
                                            {renderTh('time', t('thTime'), 'left')}
                                            {renderTh('task', t('thTask'), 'left')}
                                            {renderTh('mode', t('thMode'), 'center')}
                                            {renderTh('docs', t('thDocs'), 'center')}
                                            {renderTh('result', t('thResult'), 'center')}
                                            {renderTh('model', t('thModel'), 'left')}
                                            {renderTh('cost', t('thCost'), 'right')}
                                            {renderTh('action', t('thAction'), 'right')}
                                        </tr>
                                        {/* Inline Filter Row */}
                                        <tr className="border-t border-gray-100 bg-white">
                                            {columns.time && <td className="px-4 py-2">
                                                <div className="relative">
                                                    <button
                                                        onClick={() => setShowDatePicker(p => !p)}
                                                        className={`flex items-center gap-1 h-7 px-2 rounded-lg border text-[10px] font-bold transition-colors w-full truncate ${(dateRange?.from) ? 'border-[#0144DB] bg-blue-50 text-[#0144DB]' : 'border-gray-200 bg-gray-50 text-gray-500 hover:border-[#0144DB] hover:text-[#0144DB]'}`}
                                                    >
                                                        <Calendar className="w-3 h-3 shrink-0" />
                                                        <span className="truncate">{dateRange?.from ? `${format(dateRange.from, 'dd/MM/yy')} → ${dateRange.to ? format(dateRange.to, 'dd/MM/yy') : '...'}` : 'Khoảng ngày'}</span>
                                                    </button>
                                                    {showDatePicker && (
                                                        <div className="absolute top-8 left-0 z-50 bg-white border border-gray-200 rounded-xl shadow-xl p-3 flex flex-col gap-2" style={{ width: 'max-content' }}>
                                                            <style>{`.rdp-root{--rdp-accent-color:#0144DB;--rdp-accent-background-color:#EFF6FF;--rdp-day-height:32px;--rdp-day-width:32px;font-size:12px;margin:0}.rdp-month_caption{padding:0;margin-bottom:8px}.rdp-nav{height:28px}.rdp-button_previous,.rdp-button_next{width:28px;height:28px;border-radius:6px}.rdp-day{font-weight:500;font-size:12px}.rdp-day_selected{font-weight:bold}`}</style>
                                                            <DayPicker mode="range" selected={dateRange} onSelect={setDateRange} locale={vi} showOutsideDays />
                                                            <div className="flex justify-between items-center mt-2 border-t border-gray-100 pt-2">
                                                                <button onClick={() => { setDateRange(undefined); setShowDatePicker(false); }} className="text-[10px] text-red-400 hover:text-red-600 font-bold transition-colors px-2 py-1">✕ Xóa lọc</button>
                                                                <button onClick={() => setShowDatePicker(false)} className="text-[10px] text-white bg-[#0144DB] hover:bg-blue-700 font-bold px-3 py-1.5 rounded-md transition-colors">Xác nhận</button>
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            </td>}
                                            {columns.task && <td className="px-4 py-2">
                                                <div className="relative group flex items-center h-7 bg-gray-50 rounded-lg border border-gray-200 px-2 focus-within:border-[#0144DB] transition-colors">
                                                    <Search className="h-3 w-3 text-gray-300 shrink-0 group-focus-within:text-[#0144DB] transition-colors" />
                                                    <input type="text" placeholder="Lọc tên..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="w-full bg-transparent border-none p-0 pl-1.5 text-xs font-medium text-gray-600 focus:ring-0 placeholder:text-gray-300 placeholder:font-normal" />
                                                </div>
                                            </td>}
                                            {columns.mode && <td className="px-4 py-2 text-center">
                                                <select value={filterType} onChange={e => setFilterType(e.target.value)} className="bg-transparent border-none p-0 text-[10px] font-bold text-gray-500 focus:ring-0 cursor-pointer hover:text-[#0144DB] transition-colors">
                                                    <option value="all">Tất cả</option>
                                                    <option value="manual">Manual</option>
                                                    <option value="auto">Auto</option>
                                                </select>
                                            </td>}
                                            {columns.docs && <td className="px-4 py-2"></td>}
                                            {columns.result && <td className="px-4 py-2 text-center">
                                                <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="bg-transparent border-none p-0 text-[10px] font-bold text-gray-500 focus:ring-0 cursor-pointer hover:text-[#0144DB] transition-colors">
                                                    <option value="all">Tất cả</option>
                                                    <option value="success">Hoàn tất</option>
                                                    <option value="error">Lỗi</option>
                                                </select>
                                            </td>}
                                            {columns.model && <td className="px-4 py-2"></td>}
                                            {columns.cost && <td className="px-4 py-2"></td>}
                                            {columns.action && <td className="px-4 py-2">
                                                <div className="flex items-center justify-end">
                                                    {hasActiveFilter && (
                                                        <button onClick={() => { setSearchTerm(''); setFilterType('all'); setFilterStatus('all'); setFilterPlatform('all'); setDateRange(undefined); }} title="Xoá bộ lọc" className="p-1 text-red-400 hover:text-red-600 transition-colors">
                                                            <X className="w-3.5 h-3.5" />
                                                        </button>
                                                    )}
                                                </div>
                                            </td>}
                                        </tr>
                                    </thead>
                                </table>
                            </div>

                            {/* Scrollable tbody area */}
                            <div className="flex-1 min-h-0 overflow-y-auto overflow-x-auto">
                                <table className="w-full text-sm text-left" style={{ tableLayout: 'fixed' }}>
                                    <colgroup>
                                        {columns.time && <col style={{ width: getColWidth('time') }} />}
                                        {columns.task && <col style={{ width: getColWidth('task') }} />}
                                        {columns.mode && <col style={{ width: getColWidth('mode') }} />}
                                        {columns.docs && <col style={{ width: getColWidth('docs') }} />}
                                        {columns.result && <col style={{ width: getColWidth('result') }} />}
                                        {columns.model && <col style={{ width: getColWidth('model') }} />}
                                        {columns.cost && <col style={{ width: getColWidth('cost') }} />}
                                        {columns.action && <col style={{ width: getColWidth('action') }} />}
                                    </colgroup>
                                    <tbody className="divide-y divide-gray-100">
                                        {filteredHistory.map((item) => (
                                            <tr key={item.id} className="hover:bg-blue-50/30 transition-colors group">
                                                {columns.time && <td className="px-6 py-4 whitespace-nowrap">
                                                    <span className="text-xs text-gray-500">{new Date(item.date).toLocaleString('vi-VN')}</span>
                                                </td>}
                                                {columns.task && <td className="px-6 py-4">
                                                    <div className="font-semibold text-gray-900 truncate">{item.taskName}</div>
                                                </td>}
                                                {columns.mode && <td className="px-6 py-4 text-center">
                                                    {item.type === 'auto'
                                                        ? <span className="px-2 py-0.5 rounded-md bg-blue-50 text-blue-600 text-[10px] font-bold uppercase border border-blue-100">Auto</span>
                                                        : <span className="px-2 py-0.5 rounded-md bg-gray-50 text-gray-400 text-[10px] font-bold uppercase border border-gray-100">Manual</span>
                                                    }
                                                </td>}
                                                {columns.docs && <td className="px-6 py-4 text-center">
                                                    <span className="inline-flex items-center font-medium text-gray-700 bg-gray-50 border border-gray-100 px-2.5 py-1 rounded-md text-xs">
                                                        {item.processedFiles || 0} {t('statusFiles')}
                                                    </span>
                                                </td>}
                                                {columns.result && <td className="px-6 py-4 text-center">
                                                    {item.status === 'success'
                                                        ? <span className="flex items-center justify-center gap-1 text-zalopay-green font-medium bg-green-50 px-2.5 py-1 rounded-md"><CheckCircle2 className="w-4 h-4" /> {t('statusDone')}</span>
                                                        : <button onClick={() => setSelectedEntry(item)} className="inline-flex items-center gap-1 text-red-500 font-medium bg-red-50 px-2.5 py-1 rounded-md hover:bg-red-100 transition-colors cursor-pointer" title="Xem chi tiết lỗi"><AlertCircle className="w-4 h-4" /> {t('statusError')}</button>
                                                    }
                                                </td>}
                                                {columns.model && <td className="px-6 py-4">
                                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-purple-50 text-purple-700 border border-purple-100">
                                                        <Cpu className="w-3.5 h-3.5 shrink-0" />
                                                        <span className="truncate">{item.modelName || 'gemini-1.5-flash'}</span>
                                                    </span>
                                                </td>}
                                                {columns.cost && <td className="px-6 py-4 text-right">
                                                    {item.inputTokens > 0 ? (
                                                        <div className="flex flex-col items-end cursor-pointer group/cost" onClick={() => setShowPricingModal(true)}>
                                                            <span className="font-semibold text-[#0144DB] group-hover/cost:underline decoration-dashed underline-offset-4">{formatCost(item.inputTokens, 0.075)}</span>
                                                            <span className="text-xs text-gray-400 mt-0.5">{item.inputTokens.toLocaleString()} tokens</span>
                                                        </div>
                                                    ) : <span className="text-gray-400">-</span>}
                                                </td>}
                                                {columns.action && <td className="px-6 py-4 text-right">
                                                    <div className="flex items-center justify-end gap-2">
                                                        <button onClick={() => setSelectedEntry(item)} className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors opacity-0 group-hover:opacity-100" title="Xem chi tiết"><Eye className="w-4 h-4" /></button>
                                                        <button onClick={() => deleteEntry(item.id)} className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors opacity-0 group-hover:opacity-100" title="Xoá"><Trash2 className="w-4 h-4" /></button>
                                                    </div>
                                                </td>}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </>
                    )}
                </div>
            </div>

            {/* Pricing Modal */}
            {showPricingModal && (
                <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex flex-col items-center justify-center p-4">
                    <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg border border-gray-100 overflow-hidden animate-[fade-in-up_0.2s_ease-out_forwards]">
                        <div className="flex items-center justify-between p-6 border-b border-gray-100 bg-gray-50/50">
                            <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2"><Calculator className="w-5 h-5 text-[#0144DB]" /> Bảng giá API (Tham khảo)</h3>
                            <button onClick={() => setShowPricingModal(false)} className="text-gray-400 hover:text-gray-600 hover:bg-gray-100 p-1.5 rounded-lg transition-colors"><X className="w-5 h-5" /></button>
                        </div>
                        <div className="p-6">
                            <p className="text-sm text-gray-600 mb-6 leading-relaxed">Chi phí được tính toán tự động dựa trên mức giá của mô hình <strong className="text-gray-900">Google Gemini 2.5 Flash</strong>. Chi tiết xem tại <a href="https://ai.google.dev/pricing" target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">Google AI Pricing</a>.</p>
                            <div className="rounded-xl border border-gray-200 overflow-hidden mb-6">
                                <table className="w-full text-sm text-left">
                                    <thead className="bg-gray-50 text-gray-600 border-b border-gray-200"><tr><th className="px-4 py-3 font-semibold">Loại Token</th><th className="px-4 py-3 font-semibold text-right">Đơn giá (1 Triệu Tokens)</th></tr></thead>
                                    <tbody className="divide-y divide-gray-100">
                                        <tr><td className="px-4 py-3 text-gray-900 font-medium">Input Tokens (Dưới 128k)</td><td className="px-4 py-3 text-right text-gray-900">$0.075 <span className="text-gray-400 whitespace-nowrap">{(0.075 * EXCHANGE_RATE).toLocaleString('vi-VN')} ₫</span></td></tr>
                                        <tr><td className="px-4 py-3 text-gray-900 font-medium">Input Tokens (Trên 128k)</td><td className="px-4 py-3 text-right text-gray-900">$0.300 <span className="text-gray-400 whitespace-nowrap">{(0.3 * EXCHANGE_RATE).toLocaleString('vi-VN')} ₫</span></td></tr>
                                        <tr><td className="px-4 py-3 text-gray-900 font-medium">Output Tokens</td><td className="px-4 py-3 text-right text-gray-900">$0.300 <span className="text-gray-400 whitespace-nowrap">{(0.3 * EXCHANGE_RATE).toLocaleString('vi-VN')} ₫</span></td></tr>
                                    </tbody>
                                </table>
                            </div>
                            <div className="bg-blue-50/50 border border-blue-100 rounded-xl p-4 flex gap-3 text-sm text-blue-800">
                                <AlertCircle className="w-5 h-5 shrink-0 text-[#0144DB]" />
                                <p><strong>Công thức:</strong> <code>(Tổng Tokens / 1,000,000) × Đơn giá tương ứng</code>. Tỷ giá: <code>1 USD = {EXCHANGE_RATE.toLocaleString('vi-VN')} ₫</code></p>
                            </div>
                        </div>
                        <div className="p-4 border-t border-gray-100 bg-gray-50/80 flex justify-end">
                            <button onClick={() => setShowPricingModal(false)} className="px-6 py-2 bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 rounded-xl font-medium transition-colors text-sm">Đóng</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Details Modal */}
            {selectedEntry && (
                <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex flex-col items-center justify-center p-4">
                    <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg border border-gray-100 overflow-hidden animate-[fade-in-up_0.2s_ease-out_forwards]">
                        <div className="flex items-center justify-between p-6 border-b border-gray-100 bg-gray-50/50">
                            <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2"><Search className="w-5 h-5 text-[#0144DB]" /> Chi tiết xử lý</h3>
                            <button onClick={() => setSelectedEntry(null)} className="text-gray-400 hover:text-gray-600 hover:bg-gray-100 p-1.5 rounded-lg transition-colors"><X className="w-5 h-5" /></button>
                        </div>
                        <div className="p-6 space-y-4">
                            <div>
                                <h4 className="text-sm font-semibold text-gray-500 mb-1">{t('thTarget')} (URL Nguồn)</h4>
                                <a href={selectedEntry.url.split('?')[0]} target="_blank" rel="noreferrer" className="flex items-start gap-1.5 text-blue-600 hover:underline text-sm break-all font-mono bg-blue-50/50 p-3 rounded-xl border border-blue-100">
                                    <ExternalLink className="w-4 h-4 shrink-0 mt-0.5" /><span className="break-all">{selectedEntry.url}</span>
                                </a>
                            </div>
                            <div>
                                <h4 className="text-sm font-semibold text-gray-500 mb-1">{t('thKeywords')}</h4>
                                <div className="bg-gray-50 border border-gray-200 p-3 rounded-xl text-sm text-gray-900 break-words">
                                    {selectedEntry.keywords || <span className="text-gray-400 italic">{t('noFilter')}</span>}
                                </div>
                            </div>
                            <div className="flex items-center gap-12 pt-2 border-t border-gray-100">
                                <div>
                                    <h4 className="text-sm font-semibold text-gray-500 mb-1">Mô hình AI</h4>
                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-sm font-medium bg-purple-50 text-purple-700 border border-purple-100">
                                        <Cpu className="w-3.5 h-3.5" />{selectedEntry.modelName || 'gemini-1.5-flash'}
                                    </span>
                                </div>
                                <div>
                                    <h4 className="text-sm font-semibold text-gray-500 mb-1">Tài liệu thu thập</h4>
                                    <p className="text-sm font-medium text-gray-900">{selectedEntry.processedFiles} {t('statusFiles')}</p>
                                </div>
                            </div>
                            {selectedEntry.status === 'error' && selectedEntry.errorLog && (
                                <div className="pt-2 border-t border-gray-100">
                                    <div className="flex items-center justify-between mb-2">
                                        <h4 className="text-sm font-semibold text-red-600 flex items-center gap-1.5"><AlertCircle className="w-4 h-4" /> Chi tiết lỗi</h4>
                                        <button 
                                            onClick={(e) => {
                                                const btn = e.currentTarget;
                                                navigator.clipboard.writeText(selectedEntry.errorLog!);
                                                const originalHtml = btn.innerHTML;
                                                btn.innerHTML = `<span class="flex items-center gap-1"><Check className="w-3 h-3" /> Copied!</span>`;
                                                setTimeout(() => btn.innerHTML = originalHtml, 2000);
                                            }}
                                            className="text-xs text-blue-600 hover:text-blue-800 bg-blue-50 px-2 py-1 rounded flex items-center gap-1 transition-colors"
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                                            Copy Log
                                        </button>
                                    </div>
                                    <div className="bg-red-50/80 border border-red-100 p-3 rounded-xl text-xs text-red-900 font-mono overflow-y-auto max-h-48 whitespace-pre-wrap">
                                        {selectedEntry.errorLog}
                                    </div>
                                </div>
                            )}
                        </div>
                        <div className="p-4 border-t border-gray-100 bg-gray-50/80 flex justify-end">
                            <button onClick={() => setSelectedEntry(null)} className="px-6 py-2 bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 rounded-xl font-medium transition-colors text-sm">Đóng</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

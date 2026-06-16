"use client";

import { Plus, FileText, Settings, Play, Trash2, Route, LayoutGrid, List, Search, X, GripVertical } from "lucide-react";
import Link from "next/link";
import { useRegistryStore, WorkflowMetadata } from "@/lib/store/registry-store";
import { useEffect, useState, useMemo } from "react";
import { useTranslation, useI18nStore, TRANSLATIONS } from "@/lib/store/i18n-store";
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

function SortableWorkflowItem({
  workflow,
  layout,
  sortBy,
  t,
  deleteWorkflow,
}: {
  workflow: WorkflowMetadata;
  layout: 'gallery' | 'list';
  sortBy: string;
  t: (key: keyof typeof TRANSLATIONS.vi) => string;
  deleteWorkflow: (id: string) => void;
}) {
  const isManualSort = sortBy === 'manual';
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: workflow.id,
    disabled: !isManualSort,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : 1,
    opacity: isDragging ? 0.8 : 1,
  };

  if (layout === 'list') {
    return (
      <div
        ref={setNodeRef}
        style={style}
        className="hover:bg-blue-50/30 transition-colors flex flex-col sm:flex-row sm:items-center px-6 py-4 gap-4 group"
      >
        {/* Icon / Drag Handle Column */}
        <div className="w-10 shrink-0 flex items-center justify-center">
          {isManualSort ? (
            <div
              {...attributes}
              {...listeners}
              className="text-gray-300 hover:text-gray-500 cursor-grab active:cursor-grabbing p-1 touch-none"
            >
              <GripVertical className="w-5 h-5" />
            </div>
          ) : (
            <div className="p-2 w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center text-[#0144DB]">
              <FileText className="h-4.5 w-4.5 animate-pulse-slow" />
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0 flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6">
          {/* Name Column */}
          <div className="flex-1 min-w-[200px]">
            <Link
              href={`/workflows/edit/${workflow.id}`}
              className="font-semibold text-gray-900 hover:text-[#0144DB] transition-colors block truncate"
              title={workflow.name}
            >
              {workflow.name}
            </Link>
          </div>

          {/* Nodes Count Column */}
          <div className="w-full sm:w-[150px] shrink-0 flex sm:justify-center items-center gap-2 text-sm text-gray-600">
            <span className="sm:hidden font-semibold text-gray-400 mr-1 text-[10px] uppercase tracking-wider">
              {t('wfThNodes')}:
            </span>
            <span className="font-bold text-[#0144DB] bg-blue-50/50 border border-blue-100/50 px-2.5 py-0.5 rounded-md text-[11px]">
              {workflow.nodes.length}
            </span>
          </div>

          {/* Last Updated Column */}
          <div className="w-full sm:w-[200px] shrink-0 flex items-center gap-2 text-sm text-gray-500">
            <span className="sm:hidden font-semibold text-gray-400 mr-1 text-[10px] uppercase tracking-wider">
              {t('wfThUpdated')}:
            </span>
            <span className="text-gray-600 font-medium">
              {new Date(workflow.updatedAt).toLocaleDateString()}
            </span>
          </div>

          {/* Actions Column */}
          <div className="w-full sm:w-[100px] shrink-0 flex items-center justify-end gap-1.5 z-10">
            <button
              className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all opacity-60 hover:opacity-100 cursor-pointer"
              onClick={(e) => {
                e.preventDefault();
                if (confirm("Are you sure you want to delete this workflow?")) {
                  deleteWorkflow(workflow.id);
                }
              }}
              title={t('deleteTask')}
            >
              <Trash2 className="w-4 h-4" />
            </button>
            <Link
              href={`/workflows/edit/${workflow.id}`}
              className="p-1.5 bg-blue-50 hover:bg-blue-100 text-[#0144DB] rounded-lg transition-all"
              title={t('openCanvas')}
            >
              <Play className="w-4 h-4 fill-current" />
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Gallery Card layout
  return (
    <div
      ref={setNodeRef}
      style={style}
      className="bg-white rounded-2xl border border-gray-200 shadow-sm flex flex-col relative group transition-all hover:shadow-md overflow-hidden"
    >
      <button
        className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-red-500 hover:bg-red-50 p-2 rounded-lg w-8 h-8 flex items-center justify-center cursor-pointer z-10"
        onClick={(e) => {
          e.preventDefault();
          if (confirm("Are you sure you want to delete this workflow?")) {
            deleteWorkflow(workflow.id);
          }
        }}
      >
        <Trash2 className="w-4 h-4" />
      </button>

      <div className="p-6">
        <div className="flex items-center justify-between mb-4">
          {isManualSort ? (
            <div
              {...attributes}
              {...listeners}
              className="p-2.5 w-11 h-11 rounded-xl bg-blue-50 flex items-center justify-center text-[#0144DB] cursor-grab active:cursor-grabbing touch-none hover:bg-blue-100 transition-colors"
            >
              <GripVertical className="h-5 w-5 pointer-events-none" />
            </div>
          ) : (
            <div className="p-2.5 w-11 h-11 rounded-xl bg-blue-50 flex items-center justify-center text-[#0144DB]">
              <FileText className="h-5 w-5" />
            </div>
          )}
        </div>
        <h3 className="pr-6 font-semibold text-lg text-gray-900 mb-1 line-clamp-1" title={workflow.name}>
          {workflow.name}
        </h3>
        <p className="text-sm text-gray-500 mb-6">
          {t('lastUpdated')} {new Date(workflow.updatedAt).toLocaleDateString()}
        </p>
        <div className="space-y-3 text-sm text-gray-600 bg-gray-50 rounded-xl p-4 border border-gray-100">
          <div className="flex items-center gap-2">
            <Settings className="h-4 w-4 text-gray-400" />
            <span>
              {t('nodesCount')} <span className="font-medium text-gray-900">{workflow.nodes.length}</span>
            </span>
          </div>
        </div>
      </div>
      <div className="mt-auto p-4 border-t border-gray-100 bg-gray-50/50">
        <Link href={`/workflows/edit/${workflow.id}`} className="block w-full">
          <button className="w-full flex items-center justify-center py-2.5 px-4 bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 rounded-xl font-medium transition-colors text-sm cursor-pointer">
            <Play className="mr-2 h-4 w-4 text-[#0144DB]" /> {t('openCanvas')}
          </button>
        </Link>
      </div>
    </div>
  );
}

export default function WorkflowsPage() {
  const { workflows, deleteWorkflow, loadWorkflows, isLoading, loadError, setWorkflows } = useRegistryStore();
  const [mounted, setMounted] = useState(false);
  const [layout, setLayout] = useState<'gallery' | 'list'>('list');
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'name-asc' | 'name-desc' | 'manual'>('manual');
  const t = useTranslation();
  const language = useI18nStore((state) => state.language);

  // dnd-kit sensors
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  useEffect(() => {
    void loadWorkflows();

    const savedLayout = localStorage.getItem("workflows-layout");
    const frameId = window.requestAnimationFrame(() => {
      if (savedLayout === "list" || savedLayout === "gallery") {
        setLayout(savedLayout);
      }
      setMounted(true);
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [loadWorkflows]);

  const handleSetLayout = (newLayout: 'gallery' | 'list') => {
    setLayout(newLayout);
    localStorage.setItem("workflows-layout", newLayout);
  };

  const filteredWorkflows = useMemo(() => {
    return workflows.filter((w) =>
      (w.name || "").toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [workflows, searchTerm]);

  const sortedWorkflows = useMemo(() => {
    return [...filteredWorkflows].sort((a, b) => {
      if (sortBy === 'newest') {
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      }
      if (sortBy === 'oldest') {
        return new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
      }
      if (sortBy === 'name-asc') {
        return (a.name || "").localeCompare(b.name || "");
      }
      if (sortBy === 'name-desc') {
        return (b.name || "").localeCompare(a.name || "");
      }
      return 0;
    });
  }, [filteredWorkflows, sortBy]);

  const itemIds = useMemo(() => sortedWorkflows.map((w) => w.id), [sortedWorkflows]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (active.id !== over?.id && over) {
      const oldIndex = workflows.findIndex((w) => w.id === active.id);
      const newIndex = workflows.findIndex((w) => w.id === over.id);
      const newWorkflows = arrayMove(workflows, oldIndex, newIndex);
      setWorkflows(newWorkflows);
    }
  };

  if (!mounted) return null; // Prevent hydration errors with local storage

  return (
    <div className="flex flex-1 flex-col p-6 min-h-full w-full bg-zalopay-bg text-gray-900">
      <div className="mb-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-[2.5rem] font-bold tracking-tight text-gray-900 animate-slide-in-left pb-1.5 opacity-0 inline-block">
            <span className="inline-block animate-heartbeat">{t('wfTitle')}</span>
          </h1>
          <p className="mt-2 text-gray-500 text-lg">{t('wfDesc')}</p>
        </div>
        <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
          <div className="bg-gray-100 p-0.5 rounded-xl flex items-center border border-gray-200/80 shadow-inner">
            <button
              onClick={() => handleSetLayout('gallery')}
              className={`p-2 rounded-lg transition-all cursor-pointer ${layout === 'gallery' ? 'bg-white text-[#0144DB] shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
              title={t('wfLayoutGrid')}
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
            <button
              onClick={() => handleSetLayout('list')}
              className={`p-2 rounded-lg transition-all cursor-pointer ${layout === 'list' ? 'bg-white text-[#0144DB] shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
              title={t('wfLayoutList')}
            >
              <List className="w-4 h-4" />
            </button>
          </div>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'newest' | 'oldest' | 'name-asc' | 'name-desc' | 'manual')}
            className="h-10 bg-white border border-gray-200 text-gray-700 text-sm font-bold rounded-xl px-3 shadow-sm focus:outline-none focus:border-[#0144DB] transition-all cursor-pointer hover:bg-gray-50"
          >
            <option value="manual">{language === 'en' ? 'Sort: Manual' : 'Sắp xếp: Thủ công'}</option>
            <option value="newest">{language === 'en' ? 'Sort: Newest' : 'Sắp xếp: Mới nhất'}</option>
            <option value="oldest">{language === 'en' ? 'Sort: Oldest' : 'Sắp xếp: Cũ nhất'}</option>
            <option value="name-asc">{language === 'en' ? 'Name: A - Z' : 'Tên: A - Z'}</option>
            <option value="name-desc">{language === 'en' ? 'Name: Z - A' : 'Tên: Z - A'}</option>
          </select>

          <Link href="/workflows/new">
            <button className="flex items-center gap-2 bg-[#0144DB] hover:opacity-90 text-white px-5 py-2.5 rounded-xl font-medium transition-all shadow-sm text-sm h-10 whitespace-nowrap cursor-pointer">
              <Plus className="w-5 h-5" />
              {t('wfCreateBtn')}
            </button>
          </Link>
        </div>
      </div>

      {loadError && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {loadError}
        </div>
      )}

      {isLoading && workflows.length === 0 && (
        <div className="rounded-xl border border-gray-200 bg-white px-5 py-4 text-sm text-gray-500 shadow-sm mb-6">
          Đang tải workflows...
        </div>
      )}

      {/* Search Filter for Gallery view */}
      {layout === 'gallery' && workflows.length > 0 && (
        <div className="mb-6 flex gap-4 items-center bg-white p-4 rounded-2xl border border-gray-200/85 shadow-sm max-w-md">
          <div className="relative flex-1">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search className="h-4 w-4 text-gray-400" />
            </div>
            <input
              type="text"
              placeholder={t('searchPlaceholder') || "Tìm kiếm quy trình..."}
              className="w-full pl-10 pr-10 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-[#0144DB] transition-all bg-gray-50/50 hover:bg-gray-50 focus:bg-white text-gray-900"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      )}

      {sortedWorkflows.length === 0 && workflows.length > 0 ? (
        /* Search Empty State */
        <div className="bg-white rounded-2xl border border-gray-200/80 flex flex-col justify-center items-center text-center py-16 shadow-sm">
          <Search className="w-12 h-12 text-gray-300 mb-4 animate-pulse" />
          <h3 className="text-lg font-medium text-gray-900 mb-1">
            {t('noSearchResults')} &quot;{searchTerm}&quot;
          </h3>
          <button
            onClick={() => setSearchTerm('')}
            className="mt-4 text-[#0144DB] font-semibold text-sm hover:underline cursor-pointer"
          >
            {t('clearFilters') || "Xoá bộ lọc"}
          </button>
        </div>
      ) : layout === 'gallery' ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={itemIds}
            strategy={rectSortingStrategy}
          >
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {sortedWorkflows.map((workflow) => (
                <SortableWorkflowItem
                  key={workflow.id}
                  workflow={workflow}
                  layout={layout}
                  sortBy={sortBy}
                  t={t}
                  deleteWorkflow={deleteWorkflow}
                />
              ))}

              {/* Empty State Card */}
              {!searchTerm && (
                <div className="bg-white rounded-2xl border border-gray-200 shadow-sm flex flex-col justify-center items-center text-center py-16 px-4 hover:shadow-md hover:border-blue-400 transition-all border-2 border-dashed border-gray-350 cursor-pointer col-span-full sm:col-span-1 min-h-[300px]">
                  <Route className="w-12 h-12 text-gray-300 mb-4 animate-heartbeat-slow" />
                  <h3 className="text-lg font-medium text-gray-900 mb-1">{t('wfEmptyTitle')}</h3>
                  <p className="text-sm text-gray-500 mb-6 max-w-[250px]">{t('wfEmptyDesc')}</p>
                  <Link href="/workflows/new">
                    <button className="flex items-center gap-2 bg-[#0144DB] hover:opacity-90 text-white px-5 py-2.5 rounded-xl font-medium transition-all text-sm shadow-sm cursor-pointer">
                      <Plus className="w-4 h-4" />
                      {t('wfEmptyBtn')}
                    </button>
                  </Link>
                </div>
              )}
            </div>
          </SortableContext>
        </DndContext>
      ) : (
        /* LIST VIEW */
        workflows.length === 0 ? (
          <div className="bg-white rounded-2xl border-2 border-dashed border-gray-300 flex flex-col justify-center items-center text-center py-16 shadow-sm">
            <Route className="w-12 h-12 text-gray-300 mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-1">{t('wfEmptyTitle')}</h3>
            <p className="text-sm text-gray-500 mb-6 max-w-[250px]">{t('wfEmptyDesc')}</p>
            <Link href="/workflows/new">
              <button className="flex items-center gap-2 bg-[#0144DB] hover:opacity-90 text-white px-5 py-2.5 rounded-xl font-medium transition-all text-sm shadow-sm cursor-pointer">
                <Plus className="w-4 h-4" />
                {t('wfEmptyBtn')}
              </button>
            </Link>
          </div>
        ) : (
          <div className="flex flex-col bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden divide-y divide-gray-100">
            {/* Table Header */}
            <div className="hidden sm:flex flex-col bg-gray-50/70 border-b border-gray-200/80 rounded-t-2xl">
              {/* Table Labels Row */}
              <div className="flex items-center px-6 py-3.5 gap-4 border-b border-gray-200/60 font-bold text-gray-400 text-[10px] uppercase tracking-widest">
                <div className="w-10 shrink-0"></div>
                <div className="flex-1 min-w-0 flex items-center gap-6">
                  <div className="flex-1 min-w-[200px] text-left">{t('wfThName')}</div>
                  <div className="w-[150px] shrink-0 text-center">{t('wfThNodes')}</div>
                  <div className="w-[200px] shrink-0 text-left">{t('wfThUpdated')}</div>
                  <div className="w-[100px] shrink-0 text-right pr-2">{t('wfThActions')}</div>
                </div>
              </div>

              {/* Excel-style Filter Row */}
              <div className="flex items-center px-6 py-2 gap-4 bg-white/50 backdrop-blur-sm">
                <div className="w-10 shrink-0 flex justify-center">
                  <Search className="w-3.5 h-3.5 text-gray-300" />
                </div>
                <div className="flex-1 min-w-0 flex items-center gap-6">
                  <div className="flex-1 min-w-[200px] relative group">
                    <input
                      type="text"
                      placeholder="Lọc tên..."
                      className="w-full bg-transparent border-none p-0 text-xs font-bold text-gray-600 focus:ring-0 placeholder:text-gray-300 placeholder:font-normal focus:outline-none"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                    />
                  </div>
                  <div className="w-[150px] shrink-0"></div>
                  <div className="w-[200px] shrink-0"></div>
                  <div className="w-[100px] shrink-0 flex justify-end pr-2">
                    {searchTerm && (
                      <button
                        onClick={() => setSearchTerm('')}
                        className="p-1 text-red-400 hover:text-red-650 transition-colors cursor-pointer"
                        title="Xoá lọc"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Table Rows */}
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={itemIds}
                strategy={verticalListSortingStrategy}
              >
                <div className="flex flex-col divide-y divide-gray-100">
                  {sortedWorkflows.map((workflow) => (
                    <SortableWorkflowItem
                      key={workflow.id}
                      workflow={workflow}
                      layout={layout}
                      sortBy={sortBy}
                      t={t}
                      deleteWorkflow={deleteWorkflow}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          </div>
        )
      )}
    </div>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Workflow, Route, Search, Clock, Settings } from "lucide-react";
import { useTranslation } from "@/lib/store/i18n-store";

export function Header() {
    const pathname = usePathname();
    const t = useTranslation();

    const isActive = (path: string) => {
        if (path === '/' && pathname === '/') return true;
        if (path !== '/' && pathname?.startsWith(path)) return true;
        return false;
    };

    return (
        <header className="flex h-16 items-center border-b border-zinc-200 shadow-sm px-4 md:px-6 bg-white sticky top-0 z-50">
            <Link href="/" className="flex items-center gap-2.5 font-semibold text-lg group">
                <div className="relative flex items-center justify-center bg-blue-50 text-[#0144DB] p-2 rounded-xl group-hover:scale-110 transition-transform duration-300">
                    <Workflow className="h-5 w-5" />
                </div>
                <span className="bg-gradient-to-r from-[#0144DB] to-indigo-600 bg-clip-text text-transparent group-hover:opacity-80 transition-opacity">
                    Didi AI Tool
                </span>
            </Link>
            <nav className="ml-auto hidden gap-1 sm:flex h-full items-center">
                <Link
                    href="/workflows"
                    className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200 ${isActive('/workflows')
                        ? 'bg-[#0144DB]/10 text-[#0144DB]'
                        : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900'
                        }`}
                >
                    <Route className="w-4 h-4" /> {t('navWorkflows')}
                </Link>
                <Link
                    href="/knowledge-base"
                    className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200 ${isActive('/knowledge-base')
                        ? 'bg-[#0144DB]/10 text-[#0144DB]'
                        : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900'
                        }`}
                >
                    <Search className="w-4 h-4" /> {t('navLookup')}
                </Link>
                <Link
                    href="/history"
                    className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200 ${isActive('/history')
                        ? 'bg-[#0144DB]/10 text-[#0144DB]'
                        : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900'
                        }`}
                >
                    <Clock className="w-4 h-4" /> {t('navHistory')}
                </Link>
                <Link
                    href="/settings"
                    className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200 ${isActive('/settings')
                        ? 'bg-[#0144DB]/10 text-[#0144DB]'
                        : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900'
                        }`}
                >
                    <Settings className="w-4 h-4" /> {t('navSettings')}
                </Link>
            </nav>
        </header>
    );
}


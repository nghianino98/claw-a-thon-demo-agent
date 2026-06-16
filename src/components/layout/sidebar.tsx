"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
    Workflow,
    Search,
    Clock,
    Route,
    Link2,
    Cpu,
    Activity,
    FileText,
    Puzzle,
    Database,
    Network,
    Users,
    Settings,
    ChevronLeft,
    Menu,
    LogOut,
    User,
} from "lucide-react";
import { useTranslation } from "@/lib/store/i18n-store";
import { useAuth } from "@/lib/store/auth-store";
import { Badge } from "@/components/ui/badge";

export function Sidebar() {
    const pathname = usePathname();
    const router = useRouter();
    const t = useTranslation();
    const { authMode, user, clearAuth } = useAuth();

    const [isCollapsed, setIsCollapsed] = useState(() => {
        if (typeof window === "undefined") return false;
        return localStorage.getItem("sidebar_collapsed") === "true";
    });
    const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);

    const toggleSidebar = () => {
        const newState = !isCollapsed;
        setIsCollapsed(newState);
        localStorage.setItem('sidebar_collapsed', String(newState));
    };

    const handleLogout = async () => {
        try {
            await fetch("/api/auth/logout", { method: "POST" });
            clearAuth();
            router.push("/login");
        } catch (err) {
            console.error("Logout failed:", err);
        }
    };

    const isActive = (path: string) => {
        if (path === '/' && pathname === '/') return true;
        if (path !== '/' && pathname?.startsWith(path)) return true;
        return false;
    };

    const localCollectorSection = [
        { href: "/knowledge-base", label: t('navLookup'), icon: Search, active: isActive('/knowledge-base') },
        { href: "/history", label: t('navHistory'), icon: Clock, active: isActive('/history') },
    ];

    const workflowSection = [
        { href: "/workflows", label: t('navWorkflowConfigure'), icon: Route, active: isActive('/workflows') },
    ];

    const localSystemSection = [
        { href: "/agent-admin/agent-connects", label: t('navAgentConnects'), icon: Link2, active: isActive('/agent-admin/agent-connects') },
        { href: "/settings/mcp", label: t('navConnectMcp'), icon: Network, active: isActive('/settings/mcp') },
        { href: "/settings", label: t('navSettings'), icon: Settings, active: pathname === '/settings' },
    ];

    // 2. Navigation items for Server Mode (AUTH_MODE=required)
    const isSuperAdmin = user?.role === "superadmin";
    const hasPermission = (href: string) => {
        if (isSuperAdmin) return true;
        return user?.menuPermissions?.includes(href) ?? false;
    };

    const collectorSection = [
        { href: "/knowledge-base", label: t('navLookup'), icon: Search, active: isActive('/knowledge-base') },
        { href: "/history", label: t('navHistory'), icon: Clock, active: isActive('/history') },
    ].filter(item => hasPermission(item.href));

    const workflowSectionFiltered = workflowSection.filter(item => hasPermission(item.href));

    const agentAdminSection = [
        { href: "/agent-admin/dashboard", label: t('navDashboard'), icon: Activity, active: isActive('/agent-admin/dashboard') },
        { href: "/agent-admin/agent-connects", label: t('navAgentConnects'), icon: Link2, active: isActive('/agent-admin/agent-connects') },
        { href: "/agent-admin/bot-management", label: t('navBotManagement'), icon: Cpu, active: isActive('/agent-admin/bot-management') },
        { href: "/agent-admin/instructions", label: t('navInstructions'), icon: FileText, active: isActive('/agent-admin/instructions') },
        { href: "/agent-admin/skills", label: t('navSkills'), icon: Puzzle, active: isActive('/agent-admin/skills') },
        { href: "/agent-admin/knowledge", label: t('navKnowledge'), icon: Database, active: isActive('/agent-admin/knowledge') },
    ].filter(item => hasPermission(item.href));

    const systemSection = [
        ...(isSuperAdmin ? [{ href: "/accounts", label: t('navAccounts'), icon: Users, active: isActive('/accounts') }] : []),
        { href: "/settings/mcp", label: t('navConnectMcp'), icon: Network, active: isActive('/settings/mcp') },
        { href: "/settings", label: t('navSettings'), icon: Settings, active: pathname === '/settings' },
    ].filter(item => hasPermission(item.href));

    return (
        <aside
            className={`sticky top-0 h-screen transition-all duration-300 border-r border-zinc-200 bg-white shadow-sm flex flex-col z-50 shrink-0 ${isCollapsed ? 'w-20' : 'w-64'}`}
        >
            {/* Header / Logo */}
            <div className={`flex items-center h-16 px-4 border-b border-zinc-100 ${isCollapsed ? 'justify-center' : 'justify-between'}`}>
                {!isCollapsed && (
                    <Link href="/" className="flex items-center gap-2 font-bold text-[#0144DB] truncate">
                        <div className="bg-blue-50 p-1.5 rounded-lg shrink-0">
                            <Workflow className="h-5 w-5" />
                        </div>
                        <span className="truncate">Didi AI Tool</span>
                    </Link>
                )}
                <button
                    onClick={toggleSidebar}
                    className="p-2 hover:bg-gray-100 rounded-xl transition-colors text-gray-500 cursor-pointer"
                    title={isCollapsed ? "Expand" : "Collapse"}
                >
                    {isCollapsed ? <Menu className="w-5 h-5" /> : <ChevronLeft className="w-5 h-5" />}
                </button>
            </div>

            {/* Navigation */}
            <div className="flex-1 px-3 py-6 space-y-6 overflow-y-auto min-h-0">
                {authMode === "off" ? (
                    /* Local Mode Navigation List */
                    <div className="space-y-6">
                        {[
                            { label: t('secCollector'), items: localCollectorSection },
                            { label: t('secWorkflow'), items: workflowSection },
                            { label: t('secSystem'), items: localSystemSection },
                        ].map((section) => (
                            <div key={section.label} className="space-y-1.5">
                                {!isCollapsed && (
                                    <span className="px-3 text-[10px] font-bold text-zinc-400 uppercase tracking-widest block">
                                        {section.label}
                                    </span>
                                )}
                                <nav className="space-y-1">
                                    {section.items.map((item) => (
                                        <Link
                                            key={item.href}
                                            href={item.href}
                                            className={`flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-semibold transition-all group ${
                                                item.active
                                                    ? 'bg-blue-50 text-[#0144DB]'
                                                    : 'text-zinc-500 hover:bg-zinc-50 hover:text-zinc-900'
                                            }`}
                                            title={item.label}
                                        >
                                            <item.icon className={`w-4 h-4 shrink-0 ${item.active ? 'text-[#0144DB]' : 'text-zinc-400 group-hover:text-zinc-600'}`} />
                                            {!isCollapsed && <span className="truncate">{item.label}</span>}
                                        </Link>
                                    ))}
                                </nav>
                            </div>
                        ))}
                    </div>
                ) : (
                    /* Server Mode (AUTH_MODE=required) Grouped List */
                    <div className="space-y-6">
                        {/* 1. Collector Section */}
                        {collectorSection.length > 0 && (
                            <div className="space-y-1.5">
                                {!isCollapsed && (
                                    <span className="px-3 text-[10px] font-bold text-zinc-400 uppercase tracking-widest block">
                                        {t('secCollector')}
                                    </span>
                                )}
                                <nav className="space-y-1">
                                    {collectorSection.map((item) => (
                                        <Link
                                            key={item.href}
                                            href={item.href}
                                            className={`flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-semibold transition-all group ${
                                                item.active
                                                    ? 'bg-blue-50 text-[#0144DB]'
                                                    : 'text-zinc-500 hover:bg-zinc-50 hover:text-zinc-900'
                                            }`}
                                            title={item.label}
                                        >
                                            <item.icon className={`w-4 h-4 shrink-0 ${item.active ? 'text-[#0144DB]' : 'text-zinc-400 group-hover:text-zinc-600'}`} />
                                            {!isCollapsed && <span className="truncate">{item.label}</span>}
                                        </Link>
                                    ))}
                                </nav>
                            </div>
                        )}

                        {/* 2. Workflow Section */}
                        {workflowSectionFiltered.length > 0 && (
                            <div className="space-y-1.5">
                                {!isCollapsed && (
                                    <span className="px-3 text-[10px] font-bold text-zinc-400 uppercase tracking-widest block">
                                        {t('secWorkflow')}
                                    </span>
                                )}
                                <nav className="space-y-1">
                                    {workflowSectionFiltered.map((item) => (
                                        <Link
                                            key={item.href}
                                            href={item.href}
                                            className={`flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-semibold transition-all group ${
                                                item.active
                                                    ? 'bg-blue-50 text-[#0144DB]'
                                                    : 'text-zinc-500 hover:bg-zinc-50 hover:text-zinc-900'
                                            }`}
                                            title={item.label}
                                        >
                                            <item.icon className={`w-4 h-4 shrink-0 ${item.active ? 'text-[#0144DB]' : 'text-zinc-400 group-hover:text-zinc-600'}`} />
                                            {!isCollapsed && <span className="truncate">{item.label}</span>}
                                        </Link>
                                    ))}
                                </nav>
                            </div>
                        )}

                        {/* 3. Agent Admin Section */}
                        {agentAdminSection.length > 0 && (
                            <div className="space-y-1.5">
                                {!isCollapsed && (
                                    <span className="px-3 text-[10px] font-bold text-zinc-400 uppercase tracking-widest block">
                                        {t('secAgentAdmin')}
                                    </span>
                                )}
                                <nav className="space-y-1">
                                    {agentAdminSection.map((item) => (
                                        <Link
                                            key={item.href}
                                            href={item.href}
                                            className={`flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-semibold transition-all group ${
                                                item.active
                                                    ? 'bg-blue-50 text-[#0144DB]'
                                                    : 'text-zinc-500 hover:bg-zinc-50 hover:text-zinc-900'
                                            }`}
                                            title={item.label}
                                        >
                                            <item.icon className={`w-4 h-4 shrink-0 ${item.active ? 'text-[#0144DB]' : 'text-zinc-400 group-hover:text-zinc-600'}`} />
                                            {!isCollapsed && <span className="truncate">{item.label}</span>}
                                        </Link>
                                    ))}
                                </nav>
                            </div>
                        )}

                        {/* 4. System Section */}
                        {systemSection.length > 0 && (
                            <div className="space-y-1.5">
                                {!isCollapsed && (
                                    <span className="px-3 text-[10px] font-bold text-zinc-400 uppercase tracking-widest block">
                                        {t('secSystem')}
                                    </span>
                                )}
                                <nav className="space-y-1">
                                    {systemSection.map((item) => (
                                        <Link
                                            key={item.href}
                                            href={item.href}
                                            className={`flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-semibold transition-all group ${
                                                item.active
                                                    ? 'bg-blue-50 text-[#0144DB]'
                                                    : 'text-zinc-500 hover:bg-zinc-50 hover:text-zinc-900'
                                            }`}
                                            title={item.label}
                                        >
                                            <item.icon className={`w-4 h-4 shrink-0 ${item.active ? 'text-[#0144DB]' : 'text-zinc-400 group-hover:text-zinc-600'}`} />
                                            {!isCollapsed && <span className="truncate">{item.label}</span>}
                                        </Link>
                                    ))}
                                </nav>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Footer / User Info Menu */}
            {authMode === "off" ? (
                /* Static Default Footer in Local Mode */
                <div className={`p-4 border-t border-zinc-100 mt-auto min-h-[80px] flex items-center ${isCollapsed ? 'justify-center' : 'px-6'}`}>
                    <div className={`flex items-center gap-3 ${isCollapsed ? 'flex-col' : ''}`}>
                        <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-blue-500 to-indigo-600 flex items-center justify-center text-white font-bold shrink-0 shadow-sm border border-white">
                            D
                        </div>
                        {!isCollapsed && (
                            <div className="flex flex-col min-w-0">
                                <span className="text-sm font-bold text-gray-900 truncate">Didi</span>
                                <span className="text-[10px] text-gray-400 uppercase tracking-widest font-bold">ZaloPay AI</span>
                            </div>
                        )}
                    </div>
                </div>
            ) : (
                /* Interactive User Menu in Server Mode */
                <div className="p-4 border-t border-zinc-100 mt-auto relative shrink-0">
                    {/* User profile card toggle */}
                    <div
                        onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
                        className={`flex items-center gap-3 p-2 rounded-xl hover:bg-zinc-50 transition-all cursor-pointer select-none ${isCollapsed ? 'justify-center' : ''}`}
                    >
                        <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-blue-600 to-indigo-700 flex items-center justify-center text-white font-bold shrink-0 shadow-sm border border-white uppercase">
                            {user?.username?.substring(0, 1) || "U"}
                        </div>
                        {!isCollapsed && (
                            <div className="flex flex-col min-w-0 flex-1">
                                <span className="text-xs font-extrabold text-zinc-900 truncate">{user?.username}</span>
                                <div className="mt-0.5">
                                    <Badge variant={user?.role === "superadmin" ? "success" : "secondary"} className="!px-1.5 !py-0 text-[8px]">
                                        {user?.role}
                                    </Badge>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Popover User Menu Options */}
                    {isUserMenuOpen && (
                        <div className={`absolute bottom-16 bg-white border border-zinc-200 rounded-xl shadow-xl py-2 w-48 flex flex-col z-[100] ${isCollapsed ? 'left-4' : 'left-4 right-4 w-auto'}`}>
                            <Link
                                href="/account"
                                onClick={() => setIsUserMenuOpen(false)}
                                className="flex items-center gap-2.5 px-4 py-2 text-xs font-bold text-zinc-700 hover:bg-zinc-50 hover:text-zinc-950 transition-all"
                            >
                                <User className="w-4 h-4 text-zinc-400" />
                                {t('profileMyProfile')}
                            </Link>
                            <button
                                onClick={() => {
                                    setIsUserMenuOpen(false);
                                    handleLogout();
                                }}
                                className="flex items-center gap-2.5 px-4 py-2 text-xs font-bold text-[--color-danger] hover:bg-red-50 transition-all text-left w-full cursor-pointer"
                            >
                                <LogOut className="w-4 h-4 text-[--color-danger]" />
                                {t('profileLogout')}
                            </button>
                        </div>
                    )}
                </div>
            )}
        </aside>
    );
}

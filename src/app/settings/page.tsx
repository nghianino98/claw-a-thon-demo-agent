"use client";

import { useState, useEffect } from "react";
import { Settings, Globe, Languages, Database, Link as LinkIcon, User, Key, GitBranch, Layout, Activity } from "lucide-react";
import { useI18nStore, useTranslation } from "@/lib/store/i18n-store";
import { useSettingsStore, CrawlerSource } from "@/lib/store/settings-store";
import { ConfluenceIcon, JiraIcon, GitLabIcon } from "@/components/ui/brand-icons";

export default function SettingsPage() {
    const { language, setLanguage } = useI18nStore();
    const { defaults, updateDefault } = useSettingsStore();
    const t = useTranslation();

    const toggleLanguage = (lang: 'vi' | 'en') => {
        setLanguage(lang);
    };

    const TestConnectionButton = ({ source, data }: { source: CrawlerSource, data: any }) => {
        const [status, setStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
        const [message, setMessage] = useState('');

        const handleTest = async () => {
            if (!data.url || !data.apiKey) {
                setStatus('error');
                setMessage(t('testError') + ': ' + (language === 'vi' ? 'Thiếu URL/API Key' : 'Missing URL/API Key'));
                return;
            }

            setStatus('testing');
            try {
                const res = await fetch('/api/knowledge-base/test-connection', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ source, ...data })
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
            <div className="flex flex-col items-center gap-2">
                <button
                    onClick={handleTest}
                    disabled={status === 'testing'}
                    className={`w-full flex items-center justify-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold transition-all shadow-sm ${
                        status === 'testing' 
                            ? 'bg-gray-100 text-gray-400 cursor-not-allowed' 
                            : status === 'success'
                            ? 'bg-green-50 text-green-700 border border-green-100'
                            : status === 'error'
                            ? 'bg-red-50 text-red-700 border border-red-100'
                            : 'bg-white text-[#0144DB] border border-[#0144DB]/20 hover:bg-blue-50 active:scale-[0.98]'
                    }`}
                >
                    {status === 'testing' ? (
                        <div className="w-4 h-4 border-2 border-gray-300 border-t-gray-500 rounded-full animate-spin" />
                    ) : (
                        <Activity className={`w-4 h-4 ${status === 'success' ? 'text-green-600' : status === 'error' ? 'text-red-500' : 'text-[#0144DB]'}`} />
                    )}
                    {status === 'testing' ? t('testing') : t('testConnection')}
                </button>
                {message && (
                    <p className={`text-[10px] px-1 font-medium leading-tight text-center ${status === 'success' ? 'text-green-600' : 'text-red-500'}`}>
                        {message}
                    </p>
                )}
            </div>
        );
    };

    return (
        <div className="flex flex-1 flex-col p-6 min-h-full w-full bg-zalopay-bg">
            <div className="mb-8">
                <h1 className="text-[2.5rem] font-bold tracking-tight text-gray-900 animate-slide-in-left pb-1.5 opacity-0 inline-block">
                    <span className="inline-block animate-heartbeat">{t('settingsTitle')}</span>
                </h1>
                <p className="mt-2 text-gray-500">
                    {t('settingsDesc')}
                </p>
            </div>

            <div className="space-y-8 max-w-4xl">
                {/* Language Settings */}
                <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8">
                    <h2 className="text-xl font-semibold text-gray-900 mb-6 flex items-center gap-2">
                        <Globe className="w-6 h-6 text-[#0144DB]" /> {t('langTitle')}
                    </h2>

                    <div className="space-y-4">
                        <label
                            className={`flex items-center justify-between p-4 border rounded-xl cursor-pointer transition-all ${language === 'vi' ? 'border-[#0144DB] bg-blue-50/50' : 'border-gray-200 hover:bg-gray-50'}`}
                            onClick={() => toggleLanguage('vi')}
                        >
                            <div className="flex items-center gap-3">
                                <Languages className={`w-5 h-5 ${language === 'vi' ? 'text-[#0144DB]' : 'text-gray-400'}`} />
                                <div>
                                    <h3 className={`font-medium ${language === 'vi' ? 'text-[#0144DB]' : 'text-gray-700'}`}>{t('langViTitle')}</h3>
                                    <p className="text-sm text-gray-500 mt-1">{t('langViDesc')}</p>
                                </div>
                            </div>
                            <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center ${language === 'vi' ? 'border-[#0144DB]' : 'border-gray-300'}`}>
                                {language === 'vi' && <div className="w-3 h-3 rounded-full bg-[#0144DB]" />}
                            </div>
                        </label>

                        <label
                            className={`flex items-center justify-between p-4 border rounded-xl cursor-pointer transition-all ${language === 'en' ? 'border-[#0144DB] bg-blue-50/50' : 'border-gray-200 hover:bg-gray-50'}`}
                            onClick={() => toggleLanguage('en')}
                        >
                            <div className="flex items-center gap-3">
                                <Globe className={`w-5 h-5 ${language === 'en' ? 'text-[#0144DB]' : 'text-gray-400'}`} />
                                <div>
                                    <h3 className={`font-medium ${language === 'en' ? 'text-[#0144DB]' : 'text-gray-700'}`}>{t('langEnTitle')}</h3>
                                    <p className="text-sm text-gray-500 mt-1">{t('langEnDesc')}</p>
                                </div>
                            </div>
                            <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center ${language === 'en' ? 'border-[#0144DB]' : 'border-gray-300'}`}>
                                {language === 'en' && <div className="w-3 h-3 rounded-full bg-[#0144DB]" />}
                            </div>
                        </label>
                    </div>
                </div>

                {/* Crawler Defaults */}
                <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                    <div className="p-8 border-b border-gray-100">
                        <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
                            {t('crawlerDefaultTitle')}
                        </h2>
                        <p className="mt-1 text-sm text-gray-500">
                            {t('crawlerDefaultDesc')}
                        </p>
                    </div>

                    <div className="p-8 space-y-12">
                        {/* Confluence Section */}
                        <section className="space-y-6">
                            <h3 className="text-xl font-bold text-gray-900 flex items-center gap-3">
                                <ConfluenceIcon className="w-8 h-8 text-[#0144DB]" />
                                {t('sectionConfluence')}
                            </h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-5">
                                <div className="col-span-full">
                                    <label className="block text-sm font-semibold text-gray-700 mb-1.5 flex items-center gap-2">
                                        <LinkIcon className="w-4 h-4 text-[#0144DB]" /> {t('labelDefaultUrl')}
                                    </label>
                                    <input
                                        type="text"
                                        className="w-full rounded-xl border border-gray-200 bg-gray-50/30 px-4 py-2.5 text-sm focus:border-[#0144DB] focus:ring-[#0144DB] focus:bg-white shadow-sm transition-all"
                                        value={defaults.confluence.url}
                                        placeholder="https://confluence.example.com"
                                        onChange={(e) => updateDefault('confluence', { url: e.target.value })}
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-semibold text-gray-700 mb-1.5 flex items-center gap-2">
                                        <User className="w-4 h-4 text-[#0144DB]" /> {t('labelDefaultUsername')}
                                    </label>
                                    <input
                                        type="text"
                                        className="w-full rounded-xl border border-gray-200 bg-gray-50/30 px-4 py-2.5 text-sm focus:border-[#0144DB] focus:ring-[#0144DB] focus:bg-white shadow-sm transition-all"
                                        value={defaults.confluence.username}
                                        placeholder="username"
                                        onChange={(e) => updateDefault('confluence', { username: e.target.value })}
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-semibold text-gray-700 mb-1.5 flex items-center gap-2">
                                        <Key className="w-4 h-4 text-[#0144DB]" /> {t('labelDefaultApiKey')}
                                    </label>
                                    <input
                                        type="password"
                                        className="w-full rounded-xl border border-gray-200 bg-gray-50/30 px-4 py-2.5 text-sm focus:border-[#0144DB] focus:ring-[#0144DB] focus:bg-white shadow-sm transition-all"
                                        value={defaults.confluence.apiKey}
                                        placeholder="••••••••••••••••"
                                        onChange={(e) => updateDefault('confluence', { apiKey: e.target.value })}
                                    />
                                </div>
                                <div className="col-span-full pt-4">
                                    <div className="w-full">
                                        <TestConnectionButton source="confluence" data={defaults.confluence} />
                                    </div>
                                </div>
                            </div>
                        </section>

                        <div className="border-t border-gray-100" />

                        {/* Jira Section */}
                        <section className="space-y-6">
                            <h3 className="text-xl font-bold text-gray-900 flex items-center gap-3">
                                <JiraIcon className="w-8 h-8 text-[#0052CC]" />
                                {t('sectionJira')}
                            </h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-5">
                                <div className="col-span-full">
                                    <label className="block text-sm font-semibold text-gray-700 mb-1.5 flex items-center gap-2">
                                        <LinkIcon className="w-4 h-4 text-[#0144DB]" /> {t('labelDefaultUrl')}
                                    </label>
                                    <input
                                        type="text"
                                        className="w-full rounded-xl border border-gray-200 bg-gray-50/30 px-4 py-2.5 text-sm focus:border-[#0144DB] focus:ring-[#0144DB] focus:bg-white shadow-sm transition-all"
                                        value={defaults.jira.url}
                                        placeholder="https://your-domain.atlassian.net"
                                        onChange={(e) => updateDefault('jira', { url: e.target.value })}
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-semibold text-gray-700 mb-1.5 flex items-center gap-2">
                                        <User className="w-4 h-4 text-[#0144DB]" /> {t('labelDefaultUsername')}
                                    </label>
                                    <input
                                        type="text"
                                        className="w-full rounded-xl border border-gray-200 bg-gray-50/30 px-4 py-2.5 text-sm focus:border-[#0144DB] focus:ring-[#0144DB] focus:bg-white shadow-sm transition-all"
                                        value={defaults.jira.username}
                                        placeholder="user@company.com"
                                        onChange={(e) => updateDefault('jira', { username: e.target.value })}
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-semibold text-gray-700 mb-1.5 flex items-center gap-2">
                                        <Key className="w-4 h-4 text-[#0144DB]" /> {t('labelDefaultApiKey')}
                                    </label>
                                    <input
                                        type="password"
                                        className="w-full rounded-xl border border-gray-200 bg-gray-50/30 px-4 py-2.5 text-sm focus:border-[#0144DB] focus:ring-[#0144DB] focus:bg-white shadow-sm transition-all"
                                        value={defaults.jira.apiKey}
                                        placeholder="Jira API Token"
                                        onChange={(e) => updateDefault('jira', { apiKey: e.target.value })}
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-semibold text-gray-700 mb-1.5 flex items-center gap-2">
                                        <Layout className="w-4 h-4 text-[#0144DB]" /> {t('labelDefaultProject')}
                                    </label>
                                    <input
                                        type="text"
                                        className="w-full rounded-xl border border-gray-200 bg-gray-50/30 px-4 py-2.5 text-sm focus:border-[#0144DB] focus:ring-[#0144DB] focus:bg-white shadow-sm transition-all"
                                        value={defaults.jira.projectKey}
                                        placeholder="PROJ"
                                        onChange={(e) => updateDefault('jira', { projectKey: e.target.value })}
                                    />
                                </div>
                                <div className="col-span-full pt-4">
                                    <div className="w-full">
                                        <TestConnectionButton source="jira" data={defaults.jira} />
                                    </div>
                                </div>
                            </div>
                        </section>

                        <div className="border-t border-gray-100" />

                        {/* GitLab Section */}
                        <section className="space-y-6">
                            <h3 className="text-xl font-bold text-gray-900 flex items-center gap-3">
                                <GitLabIcon className="w-8 h-8 text-[#FC6D26]" />
                                {t('sectionGitLab')}
                            </h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-5">
                                <div className="col-span-full">
                                    <label className="block text-sm font-semibold text-gray-700 mb-1.5 flex items-center gap-2">
                                        <LinkIcon className="w-4 h-4 text-[#0144DB]" /> {t('labelDefaultUrl')}
                                    </label>
                                    <input
                                        type="text"
                                        className="w-full rounded-xl border border-gray-200 bg-gray-50/30 px-4 py-2.5 text-sm focus:border-[#0144DB] focus:ring-[#0144DB] focus:bg-white shadow-sm transition-all"
                                        value={defaults.gitlab.url}
                                        placeholder="https://gitlab.com"
                                        onChange={(e) => updateDefault('gitlab', { url: e.target.value })}
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-semibold text-gray-700 mb-1.5 flex items-center gap-2">
                                        <User className="w-4 h-4 text-[#0144DB]" /> {t('labelDefaultUsername')}
                                    </label>
                                    <input
                                        type="text"
                                        className="w-full rounded-xl border border-gray-200 bg-gray-50/30 px-4 py-2.5 text-sm focus:border-[#0144DB] focus:ring-[#0144DB] focus:bg-white shadow-sm transition-all"
                                        value={defaults.gitlab.username}
                                        placeholder="duynq5"
                                        onChange={(e) => updateDefault('gitlab', { username: e.target.value })}
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-semibold text-gray-700 mb-1.5 flex items-center gap-2">
                                        <Key className="w-4 h-4 text-[#0144DB]" /> {t('labelDefaultApiKey')}
                                    </label>
                                    <input
                                        type="password"
                                        className="w-full rounded-xl border border-gray-200 bg-gray-50/30 px-4 py-2.5 text-sm focus:border-[#0144DB] focus:ring-[#0144DB] focus:bg-white shadow-sm transition-all"
                                        value={defaults.gitlab.apiKey}
                                        placeholder="glpat-xxxxxxxx"
                                        onChange={(e) => updateDefault('gitlab', { apiKey: e.target.value })}
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-semibold text-gray-700 mb-1.5 flex items-center gap-2">
                                        <Layout className="w-4 h-4 text-[#0144DB]" /> {t('labelDefaultProject')}
                                    </label>
                                    <input
                                        type="text"
                                        className="w-full rounded-xl border border-gray-200 bg-gray-50/30 px-4 py-2.5 text-sm focus:border-[#0144DB] focus:ring-[#0144DB] focus:bg-white shadow-sm transition-all"
                                        value={defaults.gitlab.projectId}
                                        placeholder="group/project"
                                        onChange={(e) => updateDefault('gitlab', { projectId: e.target.value })}
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-semibold text-gray-700 mb-1.5 flex items-center gap-2">
                                        <GitBranch className="w-4 h-4 text-[#0144DB]" /> {t('labelDefaultBranch')}
                                    </label>
                                    <input
                                        type="text"
                                        className="w-full rounded-xl border border-gray-200 bg-gray-50/30 px-4 py-2.5 text-sm focus:border-[#0144DB] focus:ring-[#0144DB] focus:bg-white shadow-sm transition-all"
                                        value={defaults.gitlab.branch}
                                        placeholder="main"
                                        onChange={(e) => updateDefault('gitlab', { branch: e.target.value })}
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-semibold text-gray-700 mb-1.5 flex items-center gap-2">
                                        <Layout className="w-4 h-4 text-[#0144DB]" /> {t('labelDefaultGroupId')}
                                    </label>
                                    <input
                                        type="text"
                                        className="w-full rounded-xl border border-gray-200 bg-gray-50/30 px-4 py-2.5 text-sm focus:border-[#0144DB] focus:ring-[#0144DB] focus:bg-white shadow-sm transition-all"
                                        value={defaults.gitlab.groupId}
                                        placeholder="wealth/mmf"
                                        onChange={(e) => updateDefault('gitlab', { groupId: e.target.value })}
                                    />
                                </div>
                                <div className="col-span-full pt-4">
                                    <div className="w-full">
                                        <TestConnectionButton source="gitlab" data={defaults.gitlab} />
                                    </div>
                                </div>
                            </div>
                        </section>
                    </div>
                </div>
            </div>
        </div>
    );
}

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type CrawlerSource = 'confluence' | 'gitlab' | 'jira';

export interface SourceSettings {
    url: string;
    username: string;
    apiKey: string;
    projectId?: string; // GitLab specific
    groupId?: string;   // GitLab specific
    branch?: string;    // GitLab specific
    projectKey?: string; // Jira specific
}

interface SettingsState {
    userDefaults: Record<string, Record<CrawlerSource, SourceSettings>>; // username -> defaults
    getDefaults: (username: string) => Record<CrawlerSource, SourceSettings>;
    updateDefault: (username: string, source: CrawlerSource, settings: Partial<SourceSettings>) => void;
}

const initialDefaults: Record<CrawlerSource, SourceSettings> = {
    confluence: {
        url: 'https://confluence.example.com',
        username: '',
        apiKey: '',
    },
    gitlab: {
        url: 'https://gitlab.com',
        username: '',
        apiKey: '',
        projectId: '',
        groupId: '',
        branch: 'main',
    },
    jira: {
        url: 'https://your-domain.atlassian.net',
        username: '',
        apiKey: '',
        projectKey: '',
    },
};

export const useSettingsStore = create<SettingsState>()(
    persist(
        (set, get) => ({
            userDefaults: {},
            getDefaults: (username) => {
                const key = username || 'local';
                return get().userDefaults[key] || initialDefaults;
            },
            updateDefault: (username, source, settings) => {
                const key = username || 'local';
                set((state) => {
                    const currentDefaults = state.userDefaults[key] || { ...initialDefaults };
                    return {
                        userDefaults: {
                            ...state.userDefaults,
                            [key]: {
                                ...currentDefaults,
                                [source]: {
                                    ...currentDefaults[source],
                                    ...settings
                                }
                            }
                        }
                    };
                });
            }
        }),
        {
            name: 'crawler_settings_store',
            partialize: (state) => ({ userDefaults: state.userDefaults }),
        }
    )
);

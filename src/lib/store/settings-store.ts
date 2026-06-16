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
    defaults: Record<CrawlerSource, SourceSettings>;
    updateDefault: (source: CrawlerSource, settings: Partial<SourceSettings>) => void;
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
        (set) => ({
            defaults: initialDefaults,
            updateDefault: (source, settings) => set((state) => ({
                defaults: {
                    ...state.defaults,
                    [source]: {
                        ...state.defaults[source],
                        ...settings,
                    },
                },
            })),
        }),
        {
            name: 'crawler_settings_store',
        }
    )
);

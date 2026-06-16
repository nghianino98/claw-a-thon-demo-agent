import { create } from 'zustand';

type FileState = {
    files: Record<string, File>;
    setFile: (nodeId: string, file: File) => void;
    removeFile: (nodeId: string) => void;
};

export const useFileStore = create<FileState>((set) => ({
    files: {},
    setFile: (nodeId, file) => set((state) => ({ files: { ...state.files, [nodeId]: file } })),
    removeFile: (nodeId) => set((state) => {
        const newFiles = { ...state.files };
        delete newFiles[nodeId];
        return { files: newFiles };
    }),
}));

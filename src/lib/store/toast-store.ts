import { create } from "zustand";

export interface ToastItem {
  id: string;
  type: "success" | "error" | "warning" | "info";
  message: string;
  duration?: number;
}

interface ToastState {
  toasts: ToastItem[];
  addToast: (
    message: string,
    type?: "success" | "error" | "warning" | "info",
    duration?: number
  ) => void;
  removeToast: (id: string) => void;
}

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],

  addToast: (message, type = "success", duration = 3000) => {
    const id = Date.now().toString() + Math.random().toString(36).substring(2, 7);
    const newToast: ToastItem = { id, type, message, duration };

    set((state) => ({
      toasts: [...state.toasts, newToast],
    }));

    if (duration > 0) {
      setTimeout(() => {
        set((state) => ({
          toasts: state.toasts.filter((t) => t.id !== id),
        }));
      }, duration);
    }
  },

  removeToast: (id) => {
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    }));
  },
}));

export const toast = {
  success: (msg: string, dur?: number) =>
    useToastStore.getState().addToast(msg, "success", dur),
  error: (msg: string, dur?: number) =>
    useToastStore.getState().addToast(msg, "error", dur),
  warning: (msg: string, dur?: number) =>
    useToastStore.getState().addToast(msg, "warning", dur),
  info: (msg: string, dur?: number) =>
    useToastStore.getState().addToast(msg, "info", dur),
};

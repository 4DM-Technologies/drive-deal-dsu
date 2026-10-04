import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { BROWSER_STORAGE_KEYS } from '@/config/browser';
import type { Session } from '@/types/domain';

interface DemoState {
  session: Session | null;
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  setSession: (session: Session | null) => void;
  logout: () => void;
}

export const useDemoStore = create<DemoState>()(
  persist(
    (set) => ({
      session: null,
      sidebarOpen: false,
      setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
      setSession: (session) => set({ session }),
      logout: () => set({ session: null }),
    }),
    { name: BROWSER_STORAGE_KEYS.session, partialize: (state) => ({ session: state.session }) },
  ),
);

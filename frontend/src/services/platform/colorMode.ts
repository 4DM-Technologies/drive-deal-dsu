import { useSyncExternalStore } from 'react';
import { BROWSER_STORAGE_KEYS } from '@/config/browser';

export type ColorMode = 'light' | 'dark';

/** Dark mode belongs to the support workspace; buyers and dealers always get the light interface. */
export const COLOR_MODE_ROLES: readonly string[] = ['support', 'support-admin', 'admin'];

const KEY = BROWSER_STORAGE_KEYS.colorMode;
const listeners = new Set<() => void>();

function read(): ColorMode {
  try {
    return window.localStorage.getItem(KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

let current: ColorMode = read();

export function setColorMode(next: ColorMode): void {
  current = next;
  try { window.localStorage.setItem(KEY, next); } catch { /* Storage can be disabled by browser policy; the choice then lasts for this tab only. */ }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // Another tab switching mode updates this one too.
  const onStorage = (event: StorageEvent) => { if (event.key === KEY) { current = read(); listener(); } };
  window.addEventListener('storage', onStorage);
  return () => { listeners.delete(listener); window.removeEventListener('storage', onStorage); };
}

export function useColorMode(): { mode: ColorMode; toggle: () => void } {
  const mode = useSyncExternalStore(subscribe, () => current, () => 'light' as ColorMode);
  return { mode, toggle: () => setColorMode(mode === 'dark' ? 'light' : 'dark') };
}

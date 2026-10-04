import { client } from '@/services/platform/client';
import { BROWSER_STORAGE_KEYS } from '@/config/browser';
import type { ActiveTheme, ThemeDefinition } from '@/types/domain';

const clamp = (value: number) => Math.max(0, Math.min(255, Math.round(value)));
const rgb = (values: number[]) => `rgb(${values.map(clamp).join(' ')})`;
const mix = (values: number[], target: number, amount: number) => values.map((value) => value + (target - value) * amount);

export function themeHex(values: number[]): string {
  return `#${values.map((value) => clamp(value).toString(16).padStart(2, '0')).join('')}`;
}

export function applyTheme(theme: ThemeDefinition): void {
  const values = theme.primary_rgb.map(clamp);
  const background = (theme.background_rgb ?? [250, 249, 246]).map(clamp);
  const surface = (theme.surface_rgb ?? [255, 255, 255]).map(clamp);
  const text = (theme.text_rgb ?? [31, 30, 27]).map(clamp);
  const navigation = (theme.navigation_rgb ?? surface).map(clamp);
  const root = document.documentElement;
  root.style.setProperty('--accent-rgb', values.join(', '));
  root.style.setProperty('--accent', rgb(values));
  root.style.setProperty('--accent-deep', rgb(mix(values, 0, 0.28)));
  root.style.setProperty('--accent-soft', rgb(mix(values, 255, 0.9)));
  root.style.setProperty('--navy', rgb(mix(values, 0, 0.68)));
  root.style.setProperty('--focus-ring', `rgba(${values.join(', ')}, .28)`);
  root.style.setProperty('--bg', rgb(background));
  root.style.setProperty('--raised', rgb(surface));
  root.style.setProperty('--surface', rgb(mix(surface, background.reduce((sum, value) => sum + value, 0) / 3, 0.32)));
  root.style.setProperty('--ink', rgb(text));
  root.style.setProperty('--navigation-bg', rgb(navigation));
  root.style.setProperty('--border', `rgba(${text.join(', ')}, .13)`);
  root.style.setProperty('--border-strong', `rgba(${text.join(', ')}, .22)`);
}

export function applyCachedTheme(): void {
  try {
    const cached = window.localStorage.getItem(BROWSER_STORAGE_KEYS.activeTheme);
    if (cached) applyTheme(JSON.parse(cached) as ActiveTheme);
  } catch {
    window.localStorage.removeItem(BROWSER_STORAGE_KEYS.activeTheme);
  }
}

export async function refreshActiveTheme(): Promise<ActiveTheme | null> {
  try {
    const theme = await client.theme.active();
    window.localStorage.setItem(BROWSER_STORAGE_KEYS.activeTheme, JSON.stringify(theme));
    applyTheme(theme);
    return theme;
  } catch {
    return null;
  }
}

import { client } from '@/services/platform/client';
import { BROWSER_STORAGE_KEYS } from '@/config/browser';
import type { ActiveTheme, ThemeDefinition } from '@/types/domain';
import type { ColorMode } from './colorMode';

const clamp = (value: number) => Math.max(0, Math.min(255, Math.round(value)));
const rgb = (values: number[]) => `rgb(${values.map(clamp).join(' ')})`;
const mix = (values: number[], target: number, amount: number) => values.map((value) => value + (target - value) * amount);
const ACTIVE_THEME_REFRESH_MS = 5 * 60_000;
let lastThemeRefreshAt = 0;
let activeThemeRefresh: Promise<ActiveTheme | null> | null = null;
let workspaceMode: ColorMode | null = null;
let lastAppliedTheme: ThemeDefinition | null = null;

const defaultTheme: ThemeDefinition = {
  name: 'Deal&Drive', primary_rgb: [255, 130, 65], background_rgb: [16, 17, 19],
  surface_rgb: [29, 30, 33], text_rgb: [244, 244, 245], navigation_rgb: [16, 17, 19],
};

const luminance = (values: number[]) => values.reduce((sum, value, index) => {
  const channel = clamp(value) / 255;
  return sum + (channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4) * [ .2126, .7152, .0722 ][index]!;
}, 0);

function readableAccent(values: number[], background: number[], mode: ColorMode): number[] {
  const backdrop = luminance(background);
  // Keep the published hue while making small labels and links legible in either mode.
  for (let amount = 0; amount <= 1; amount += .05) {
    const candidate = mix(values, mode === 'light' ? 0 : 255, amount);
    const foreground = luminance(candidate);
    if ((Math.max(foreground, backdrop) + .05) / (Math.min(foreground, backdrop) + .05) >= 4.5) return candidate.map(clamp);
  }
  return mode === 'light' ? [0, 0, 0] : [255, 255, 255];
}

/** Personal mode affects presentation only; publishing and preview definitions stay intact. */
export function setWorkspaceColorMode(mode: ColorMode | null): void {
  workspaceMode = mode;
  applyTheme(lastAppliedTheme ?? defaultTheme);
}

export function themeHex(values: number[]): string {
  return `#${values.map((value) => clamp(value).toString(16).padStart(2, '0')).join('')}`;
}

export function applyTheme(theme: ThemeDefinition, preview = false): void {
  lastAppliedTheme = theme;
  // Migrate the former stock blue/cream presentation. Custom theme definitions
  // and the administration preview continue to use their existing contracts.
  const legacy = theme.primary_rgb.join(',') === '20,86,184'
    && (!theme.background_rgb || theme.background_rgb.join(',') === '250,249,246');
  const mode = preview ? null : workspaceMode;
  const brand = (legacy ? [255, 130, 65] : theme.primary_rgb).map(clamp);
  const background = (mode === 'light' ? [245, 246, 248] : mode === 'dark' || legacy ? [16, 17, 19] : theme.background_rgb ?? [16, 17, 19]).map(clamp);
  const surface = (mode === 'light' ? [255, 255, 255] : mode === 'dark' || legacy ? [29, 30, 33] : theme.surface_rgb ?? [29, 30, 33]).map(clamp);
  const text = (mode === 'light' ? [24, 25, 28] : mode === 'dark' || legacy ? [244, 244, 245] : theme.text_rgb ?? [244, 244, 245]).map(clamp);
  const navigation = (mode === 'light' ? [255, 255, 255] : mode === 'dark' || legacy ? [16, 17, 19] : theme.navigation_rgb ?? surface).map(clamp);
  const values = mode ? readableAccent(brand, background, mode) : brand;
  const root = document.documentElement;
  root.style.setProperty('--action', rgb(brand));
  root.style.setProperty('--on-action', luminance(brand) > .179 ? 'rgb(16 17 19)' : 'rgb(255 255 255)');
  root.style.setProperty('--accent-rgb', values.join(', '));
  root.style.setProperty('--accent', rgb(values));
  root.style.setProperty('--accent-deep', rgb(mix(values, 0, 0.28)));
  root.style.setProperty('--accent-soft', `color-mix(in srgb, ${rgb(values)} 12%, ${rgb(background)})`);
  root.style.setProperty('--navy', rgb(text));
  root.style.setProperty('--focus-ring', rgb(values));
  root.style.setProperty('--bg', rgb(background));
  root.style.setProperty('--raised', rgb(surface));
  root.style.setProperty('--surface', mode === 'light' ? 'rgb(235 237 241)' : rgb(mix(surface, background.reduce((sum, value) => sum + value, 0) / 3, 0.32)));
  root.style.setProperty('--ink', rgb(text));
  root.style.setProperty('--muted', rgb(text.map((value, index) => value + (background[index]! - value) * .35)));
  root.style.setProperty('--subtle', rgb(text.map((value, index) => value + (background[index]! - value) * .45)));
  root.style.setProperty('--navigation-bg', rgb(navigation));
  root.style.setProperty('--border', `rgba(${text.join(', ')}, .13)`);
  root.style.setProperty('--border-strong', `rgba(${text.join(', ')}, .22)`);
  root.style.colorScheme = background.reduce((sum, value) => sum + value, 0) < 384 ? 'dark' : 'light';
  root.dataset.colorMode = root.style.colorScheme;
}

export function applyCachedTheme(): void {
  try {
    const cached = window.localStorage.getItem(BROWSER_STORAGE_KEYS.activeTheme);
    if (cached) applyTheme(JSON.parse(cached) as ActiveTheme);
  } catch {
    window.localStorage.removeItem(BROWSER_STORAGE_KEYS.activeTheme);
  }
}

export async function refreshActiveTheme(force = false): Promise<ActiveTheme | null> {
  if (activeThemeRefresh) return activeThemeRefresh;
  if (!force && Date.now() - lastThemeRefreshAt < ACTIVE_THEME_REFRESH_MS) return null;
  lastThemeRefreshAt = Date.now();
  activeThemeRefresh = (async () => {
    try {
      const theme = await client.theme.active();
      window.localStorage.setItem(BROWSER_STORAGE_KEYS.activeTheme, JSON.stringify(theme));
      applyTheme(theme);
      return theme;
    } catch {
      return null;
    } finally {
      activeThemeRefresh = null;
    }
  })();
  return activeThemeRefresh;
}

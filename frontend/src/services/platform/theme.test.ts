// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyTheme } from './theme';

vi.mock('@/services/platform/client', () => ({ client: { theme: { active: vi.fn() } } }));

const stockTheme = {
  name: 'Stock', primary_rgb: [20, 86, 184], background_rgb: [250, 249, 246],
  surface_rgb: [255, 255, 255], text_rgb: [31, 30, 27], navigation_rgb: [255, 255, 255],
};

describe('redesigned brand theme', () => {
  beforeEach(() => document.documentElement.removeAttribute('style'));
  it('migrates the former default without changing the saved definition', () => {
    const original = structuredClone(stockTheme);
    applyTheme(stockTheme);
    expect(document.documentElement.style.getPropertyValue('--accent')).toBe('rgb(255 130 65)');
    expect(document.documentElement.style.getPropertyValue('--bg')).toBe('rgb(16 17 19)');
    expect(document.documentElement.style.getPropertyValue('--ink')).toBe('rgb(244 244 245)');
    expect(document.documentElement.style.colorScheme).toBe('dark');
    expect(stockTheme).toEqual(original);
  });
  it('preserves custom administration colors and navigation surfaces', () => {
    applyTheme({ ...stockTheme, primary_rgb: [200, 100, 50], background_rgb: [30, 31, 32], navigation_rgb: [40, 41, 42] });
    expect(document.documentElement.style.getPropertyValue('--accent')).toBe('rgb(200 100 50)');
    expect(document.documentElement.style.getPropertyValue('--bg')).toBe('rgb(30 31 32)');
    expect(document.documentElement.style.getPropertyValue('--navigation-bg')).toBe('rgb(40 41 42)');
  });
  it('keeps an intentionally customized light theme available to the studio', () => {
    applyTheme({ ...stockTheme, background_rgb: [240, 240, 240], primary_rgb: [100, 60, 30] });
    expect(document.documentElement.style.getPropertyValue('--bg')).toBe('rgb(240 240 240)');
    expect(document.documentElement.style.colorScheme).toBe('light');
    expect(document.documentElement.style.getPropertyValue('--muted')).toBe('rgb(104 104 102)');
  });
});

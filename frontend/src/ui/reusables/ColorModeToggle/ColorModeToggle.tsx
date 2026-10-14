import { Moon, Sun } from 'lucide-react';
import type { ColorMode } from '@/services/platform/colorMode';

export function ColorModeToggle({ mode, onToggle }: { mode: ColorMode; onToggle: () => void }) {
  const dark = mode === 'dark';
  const Icon = dark ? Moon : Sun;
  return (
    <button type="button" className="theme-toggle" role="switch" aria-label="Dark theme" aria-checked={dark}
      title={`Switch to ${dark ? 'light' : 'dark'} theme`} onClick={onToggle}>
      <Icon size={17} aria-hidden="true" />
      <span className="theme-toggle-label">{dark ? 'Dark' : 'Light'}</span>
      <span className="theme-toggle-track" aria-hidden="true"><span /></span>
    </button>
  );
}

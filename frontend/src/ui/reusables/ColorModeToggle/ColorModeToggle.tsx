import { Moon, Sun } from 'lucide-react';
import { useColorMode } from '@/services/platform/colorMode';

/** Switches the support workspace between light and dark. `drawer` is the full-width row in the mobile menu. */
export function ColorModeToggle({ variant = 'header' }: { variant?: 'header' | 'drawer' }) {
  const { mode, toggle } = useColorMode();
  const dark = mode === 'dark';
  return (
    <button type="button" className={`support-help-trigger color-mode-toggle ${variant === 'header' ? 'desktop-header-action' : 'color-mode-toggle-drawer'}`} aria-pressed={dark} aria-label={`Switch to ${dark ? 'light' : 'dark'} mode`} onClick={toggle}>
      {dark ? <Sun size={17} /> : <Moon size={17} />}
      <span>{dark ? 'Light mode' : 'Dark mode'}</span>
    </button>
  );
}

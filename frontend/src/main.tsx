import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import { queryClient } from '@/services/platform/queryClient';
import { router } from '@/ui/navigations/router';
import { applyCachedTheme, applyTheme, refreshActiveTheme } from '@/services/platform/theme';
import type { ThemeDefinition } from '@/types/domain';
import '@/index.css';
import '@/loaders.css';

applyCachedTheme();
const isThemePreview = new URLSearchParams(window.location.search).get('themePreview') === '1';
if (!isThemePreview) {
  void refreshActiveTheme();
  window.addEventListener('focus', () => { void refreshActiveTheme(); });
} else {
  window.addEventListener('message', (event: MessageEvent<{ type?: string; theme?: ThemeDefinition }>) => {
    if (event.origin === window.location.origin && event.data?.type === 'drivedeal-theme-preview' && event.data.theme) {
      applyTheme(event.data.theme);
    }
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);

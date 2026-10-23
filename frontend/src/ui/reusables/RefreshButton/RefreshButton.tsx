import { RotateCw } from 'lucide-react';
import { useState } from 'react';

interface RefreshButtonProps {
  /** Reloads the page's data. The data on screen should only be replaced when this succeeds. */
  onRefresh: () => Promise<unknown>;
  /** What is being refreshed, for screen readers, e.g. "your requests". */
  subject?: string;
  className?: string;
}

type RefreshState = 'idle' | 'refreshing' | 'done' | 'failed';
const ANNOUNCEMENTS: Record<RefreshState, string> = { idle: '', refreshing: 'Refreshing…', done: 'Updated', failed: 'Couldn’t refresh. Try again.' };

/**
 * Reloads a page's live data without a browser reload. The page passes the same loader it runs on mount; the button
 * handles the spinner, double clicks, and failures (keeping what is already shown and outlining itself in red).
 */
export function RefreshButton({ onRefresh, subject = 'this page', className = '' }: RefreshButtonProps) {
  const [state, setState] = useState<RefreshState>('idle');
  const refreshing = state === 'refreshing';
  const failed = state === 'failed';

  async function refresh() {
    if (refreshing) return;
    setState('refreshing');
    try {
      await onRefresh();
      setState('done');
    } catch {
      setState('failed');
    }
  }

  return <>
    <button type="button" className={`button button-secondary refresh-button${failed ? ' is-failed' : ''} ${className}`.trim()} onClick={() => void refresh()} disabled={refreshing} aria-label={`Refresh ${subject}`} title={failed ? 'Couldn’t refresh. Try again.' : `Refresh ${subject}`}>
      <RotateCw size={16} className={refreshing ? 'is-spinning' : undefined} aria-hidden="true" /><span>Refresh</span>
    </button>
    {/* Announced to screen readers only; sighted users see the spinner and, on failure, the red outline. */}
    <span className="sr-only" role="status" aria-live="polite">{ANNOUNCEMENTS[state]}</span>
  </>;
}

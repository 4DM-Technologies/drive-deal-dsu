import { useEffect } from 'react';

/** Keep keyboard focus in the uppermost existing dialog and restore its opener. */
export function DialogFocus() {
  useEffect(() => {
    const openers = new Map<HTMLElement, HTMLElement | null>();
    const selector = '[role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]';
    let lastOutside: HTMLElement | null = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const rememberFocus = (event: FocusEvent) => {
      if (event.target instanceof HTMLElement && !event.target.closest(selector)) lastOutside = event.target;
    };
    const sync = () => {
      for (const [dialog, opener] of openers) {
        if (!dialog.isConnected) {
          openers.delete(dialog);
          if (opener?.isConnected) opener.focus({ preventScroll: true });
        }
      }
      document.querySelectorAll<HTMLElement>(selector).forEach((dialog) => {
        if (openers.has(dialog)) return;
        openers.set(dialog, lastOutside);
        if (!dialog.contains(document.activeElement)) {
          const first = dialog.querySelector<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]');
          first?.focus({ preventScroll: true });
        }
      });
    };
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const dialogs = [...document.querySelectorAll<HTMLElement>(selector)];
      const dialog = dialogs.at(-1);
      if (!dialog) return;
      const controls = [...dialog.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]')].filter((element) => element.getClientRects().length > 0);
      const first = controls[0];
      const last = controls.at(-1);
      if (!first || !last) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
    };
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener('keydown', trap);
    document.addEventListener('focusin', rememberFocus);
    sync();
    return () => { observer.disconnect(); document.removeEventListener('keydown', trap); document.removeEventListener('focusin', rememberFocus); };
  }, []);
  return null;
}

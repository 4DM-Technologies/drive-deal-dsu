/** The closest ancestor that scrolls on its own, or `null` when only the page itself would scroll. */
function scrollParent(element: HTMLElement): HTMLElement | null {
  for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
    const { overflowY } = window.getComputedStyle(parent);
    if ((overflowY === 'auto' || overflowY === 'scroll') && parent.scrollHeight > parent.clientHeight) return parent;
  }
  return null;
}

/**
 * Brings `target` into view by scrolling only its own scroll area, like `scrollIntoView({ block: 'nearest' })`
 * without also scrolling the page. On phones the page-level scroll pushed the header off-screen after sending.
 */
export function revealWithinScrollArea(target: HTMLElement | null | undefined, behavior: ScrollBehavior = 'smooth') {
  if (!target) return;
  const container = scrollParent(target);
  if (!container) return;
  const area = container.getBoundingClientRect();
  const box = target.getBoundingClientRect();
  if (box.top < area.top) container.scrollBy({ top: box.top - area.top, behavior });
  else if (box.bottom > area.bottom) container.scrollBy({ top: box.bottom - area.bottom, behavior });
}

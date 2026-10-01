import { useEffect } from 'react';
import { useNavigationType } from 'react-router-dom';

/** Public pages are sibling routes, so a PUSH navigation would otherwise keep the previous page's scroll offset. */
export function useScrollTopOnPush() {
  const navigationType = useNavigationType();
  useEffect(() => {
    if (navigationType === 'PUSH') window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [navigationType]);
}

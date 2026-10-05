import { ArrowDown, ArrowUp } from 'lucide-react';
import { useEffect, useState } from 'react';

export function ScrollControls() {
  const [state, setState] = useState({ show: false, atTop: true, atBottom: false });

  useEffect(() => {
    const update = () => setState({
      show: document.documentElement.scrollHeight > window.innerHeight * 1.35,
      atTop: window.scrollY < 180,
      atBottom: window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 120,
    });
    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => { window.removeEventListener('scroll', update); window.removeEventListener('resize', update); };
  }, []);

  if (!state.show) return null;
  return (
    <div className="scroll-controls" aria-label="Page scroll controls">
      {!state.atTop && <button onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} aria-label="Scroll to top"><ArrowUp size={17} /></button>}
      {!state.atBottom && <button onClick={() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' })} aria-label="Scroll to bottom"><ArrowDown size={17} /></button>}
    </div>
  );
}

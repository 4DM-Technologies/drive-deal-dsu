import { Ellipsis, Pencil, Undo2 } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';

interface ChatMessageMenuProps {
  onEdit: () => void;
  onUnsend: () => void;
}

/** Height the open menu needs. Below this much room in the thread, it opens above the dots instead. */
const MENU_HEIGHT = 100;
const menuItems = (root: HTMLElement | null) => Array.from(root?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);

/** The "⋯" that appears on hover over one of your own messages, and the Edit / Unsend menu it opens. */
export function ChatMessageMenu({ onEdit, onUnsend }: ChatMessageMenuProps) {
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<'down' | 'up'>('down');
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    menuItems(wrapRef.current)[0]?.focus();
    const close = (event: PointerEvent) => { if (!wrapRef.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  function toggle() {
    if (!open) {
      // The thread scrolls and clips what overflows it, so a menu that would run past the bottom opens upward.
      const trigger = triggerRef.current?.getBoundingClientRect();
      const thread = triggerRef.current?.closest('.chat-scroll')?.getBoundingClientRect();
      if (trigger && thread) {
        const below = thread.bottom - trigger.bottom;
        setPlacement(below < MENU_HEIGHT && trigger.top - thread.top > below ? 'up' : 'down');
      }
    }
    setOpen((value) => !value);
  }

  function choose(action: () => void) {
    setOpen(false);
    action();
  }

  function onKeyDown(event: KeyboardEvent) {
    if (!open) return;
    if (event.key === 'Escape') { event.preventDefault(); setOpen(false); triggerRef.current?.focus(); return; }
    if (event.key === 'Tab') { setOpen(false); return; }
    const list = menuItems(wrapRef.current);
    const at = list.indexOf(document.activeElement as HTMLElement);
    const move = event.key === 'ArrowDown' ? at + 1 : event.key === 'ArrowUp' ? at - 1 : event.key === 'Home' ? 0 : event.key === 'End' ? list.length - 1 : null;
    if (move === null) return;
    event.preventDefault();
    list[(move + list.length) % list.length]?.focus();
  }

  return <div className={`chat-message-menu ${open ? 'open' : ''}`} ref={wrapRef} onKeyDown={onKeyDown}>
    <button type="button" ref={triggerRef} className="chat-message-trigger" onClick={toggle} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined} aria-label="Message actions">
      <Ellipsis size={16} aria-hidden="true" />
    </button>
    {open && <div className={`chat-message-popover ${placement === 'up' ? 'place-up' : ''}`} id={menuId} role="menu" aria-label="Message actions">
      <button type="button" className="menu-item" role="menuitem" onClick={() => choose(onEdit)}><Pencil size={16} /><span>Edit</span></button>
      <button type="button" className="menu-item menu-item-danger" role="menuitem" onClick={() => choose(onUnsend)}><Undo2 size={16} /><span>Unsend</span></button>
    </div>}
  </div>;
}

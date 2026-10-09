import { Check, ChevronDown } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';

/** `hint` is a short note shown on the right of the option in the open menu only, such as a result count. */
interface DropdownOption { value: string; label: string; hint?: string }
/** `placement="up"` opens the menu above the trigger, for fields near the bottom of a panel; `"auto"` does so only when the menu would not fit below. `id` lets a `<label htmlFor>` point at the trigger. */
interface DropdownProps { value: string; options: DropdownOption[]; onChange: (value: string) => void; ariaLabel: string; align?: 'left' | 'right'; placement?: 'down' | 'up' | 'auto'; id?: string }

export function Dropdown({ value, options, onChange, ariaLabel, align = 'right', placement = 'down', id: triggerId }: DropdownProps) {
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [autoUp, setAutoUp] = useState(false);
  const openUp = placement === 'up' || (placement === 'auto' && autoUp);
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const [active, setActive] = useState(selectedIndex);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  // With a long list (brands, states) the highlighted row follows the keyboard instead of leaving the visible part.
  useEffect(() => {
    if (open) document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active, id]);

  // The menu is at most 320px (or 45% of the window) tall; below that much room it flips above the trigger, if there is more room there.
  function resolvePlacement() {
    if (placement !== 'auto') return;
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    const below = window.innerHeight - rect.bottom;
    setAutoUp(below < Math.min(320, window.innerHeight * .45) + 12 && rect.top > below);
  }

  function toggle() {
    if (!open) resolvePlacement();
    setActive(selectedIndex);
    setOpen((current) => !current);
  }

  function choose(index: number) {
    const option = options[index];
    if (option) onChange(option.value);
    setOpen(false);
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'Escape' || event.key === 'Tab') { setOpen(false); return; }
    // Typing a letter jumps to the next option starting with it, like a native select.
    if (event.key.length === 1 && event.key !== ' ' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const letter = event.key.toLowerCase();
      const from = open ? active : selectedIndex;
      const next = [...options.keys()].map((offset) => (from + 1 + offset) % options.length).find((index) => options[index]?.label.toLowerCase().startsWith(letter));
      if (next !== undefined) { if (!open) resolvePlacement(); setOpen(true); setActive(next); }
      return;
    }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(event.key)) event.preventDefault();
    if (!open) { if (event.key !== 'Home' && event.key !== 'End') toggle(); return; }
    if (event.key === 'ArrowDown') setActive((index) => Math.min(options.length - 1, index + 1));
    if (event.key === 'ArrowUp') setActive((index) => Math.max(0, index - 1));
    if (event.key === 'Home') setActive(0);
    if (event.key === 'End') setActive(options.length - 1);
    if (event.key === 'Enter' || event.key === ' ') choose(active);
  }

  return <div className="dropdown" ref={rootRef}>
    <button type="button" id={triggerId} className={`dropdown-trigger ${open ? 'open' : ''}`} role="combobox" aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open} aria-controls={`${id}-list`} aria-activedescendant={open ? `${id}-${active}` : undefined} onClick={toggle} onKeyDown={onKeyDown}>
      <span>{options[selectedIndex]?.label}</span><ChevronDown size={16} />
    </button>
    {open && <ul className={`dropdown-menu align-${align} ${openUp ? 'place-up' : ''}`} id={`${id}-list`} role="listbox" aria-label={ariaLabel}>
      {options.map((option, index) => <li key={option.value} id={`${id}-${index}`} role="option" aria-selected={option.value === value} className={`${option.value === value ? 'selected' : ''} ${index === active ? 'active' : ''}`} onMouseEnter={() => setActive(index)} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(index)}><span>{option.label}</span>{option.hint && <small className="dropdown-hint">{option.hint}</small>}{option.value === value && <Check size={15} />}</li>)}
    </ul>}
  </div>;
}

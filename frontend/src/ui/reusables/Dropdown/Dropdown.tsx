import { Check, ChevronDown } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';

interface DropdownOption { value: string; label: string }
interface DropdownProps { value: string; options: DropdownOption[]; onChange: (value: string) => void; ariaLabel: string; align?: 'left' | 'right' }

export function Dropdown({ value, options, onChange, ariaLabel, align = 'right' }: DropdownProps) {
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const [active, setActive] = useState(selectedIndex);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  function toggle() {
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
    if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(event.key)) event.preventDefault();
    if (!open) { if (event.key !== 'Home' && event.key !== 'End') toggle(); return; }
    if (event.key === 'ArrowDown') setActive((index) => Math.min(options.length - 1, index + 1));
    if (event.key === 'ArrowUp') setActive((index) => Math.max(0, index - 1));
    if (event.key === 'Home') setActive(0);
    if (event.key === 'End') setActive(options.length - 1);
    if (event.key === 'Enter' || event.key === ' ') choose(active);
  }

  return <div className="dropdown" ref={rootRef}>
    <button type="button" className={`dropdown-trigger ${open ? 'open' : ''}`} role="combobox" aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open} aria-controls={`${id}-list`} aria-activedescendant={open ? `${id}-${active}` : undefined} onClick={toggle} onKeyDown={onKeyDown}>
      <span>{options[selectedIndex]?.label}</span><ChevronDown size={16} />
    </button>
    {open && <ul className={`dropdown-menu align-${align}`} id={`${id}-list`} role="listbox" aria-label={ariaLabel}>
      {options.map((option, index) => <li key={option.value} id={`${id}-${index}`} role="option" aria-selected={option.value === value} className={`${option.value === value ? 'selected' : ''} ${index === active ? 'active' : ''}`} onMouseEnter={() => setActive(index)} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(index)}><span>{option.label}</span>{option.value === value && <Check size={15} />}</li>)}
    </ul>}
  </div>;
}

import { Check, ChevronDown } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';

/** `hint` is a short note on the right of the option, such as a result count; `dividerAfter` draws a line under it. */
export interface MultiSelectOption { value: string; label: string; hint?: string; dividerAfter?: boolean }

interface MultiSelectDropdownProps {
  values: string[];
  options: MultiSelectOption[];
  onChange: (values: string[]) => void;
  /** The first row, ticked when nothing is chosen; picking it clears the choice. Also the trigger text then. */
  allLabel: string;
  ariaLabel: string;
  align?: 'left' | 'right';
}

/**
 * The multi-select twin of `Dropdown`: each option has a checkbox on its left, the menu stays open while options are
 * ticked, and the first row ("All …") clears the choice. Keyboard: arrows move, Space or Enter ticks, Escape closes.
 */
export function MultiSelectDropdown({ values, options, onChange, allLabel, ariaLabel, align = 'left' }: MultiSelectDropdownProps) {
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  // Row 0 is "All …"; rows 1..n are the options.
  const [active, setActive] = useState(0);
  const rows = options.length + 1;

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  useEffect(() => {
    if (open) document.getElementById(`${id}-${active}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [open, active, id]);

  const labelOf = (value: string) => options.find((option) => option.value === value)?.label ?? value;
  const summary = values.length === 0 ? allLabel : values.length === 1 ? labelOf(values[0]!) : `${labelOf(values[0]!)} +${values.length - 1}`;

  function pick(row: number) {
    if (row === 0) { onChange([]); return; }
    const option = options[row - 1];
    if (!option) return;
    onChange(values.includes(option.value) ? values.filter((value) => value !== option.value) : [...values, option.value]);
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'Escape' || event.key === 'Tab') { setOpen(false); return; }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(event.key)) event.preventDefault();
    if (!open) { if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) { setActive(0); setOpen(true); } return; }
    if (event.key === 'ArrowDown') setActive((row) => Math.min(rows - 1, row + 1));
    if (event.key === 'ArrowUp') setActive((row) => Math.max(0, row - 1));
    if (event.key === 'Home') setActive(0);
    if (event.key === 'End') setActive(rows - 1);
    if (event.key === 'Enter' || event.key === ' ') pick(active);
  }

  const row = (index: number, label: string, checked: boolean, hint?: string, dividerAfter?: boolean) => <li key={index} id={`${id}-${index}`} role="option" aria-selected={checked} className={`multi-option${checked ? ' selected' : ''}${index === active ? ' active' : ''}${dividerAfter ? ' divider-after' : ''}`} onMouseEnter={() => setActive(index)} onMouseDown={(event) => event.preventDefault()} onClick={() => pick(index)}>
    <span className="multi-check" aria-hidden="true">{checked && <Check size={12} strokeWidth={3} />}</span><span className="multi-label">{label}</span>{hint && <small className="dropdown-hint">{hint}</small>}
  </li>;

  return <div className="dropdown" ref={rootRef}>
    <button type="button" className={`dropdown-trigger ${open ? 'open' : ''}`} role="combobox" aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open} aria-controls={`${id}-list`} aria-activedescendant={open ? `${id}-${active}` : undefined} onClick={() => { setActive(0); setOpen((current) => !current); }} onKeyDown={onKeyDown}>
      <span>{summary}</span><ChevronDown size={16} />
    </button>
    {open && <ul className={`dropdown-menu multi-menu align-${align}`} id={`${id}-list`} role="listbox" aria-label={ariaLabel} aria-multiselectable="true">
      {row(0, allLabel, values.length === 0, undefined, true)}
      {options.map((option, index) => row(index + 1, option.label, values.includes(option.value), option.hint, option.dividerAfter))}
    </ul>}
  </div>;
}

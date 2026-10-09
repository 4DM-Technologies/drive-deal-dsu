import { Check, ChevronLeft, ChevronRight, Pencil, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type { GuidedQuestion } from '@/types/domain';
import './QuestionCard.css';

export interface QuestionCardProps {
  question: GuidedQuestion;
  busy?: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  /** Chosen option values, with their labels for the chat transcript. */
  onAnswer: (values: string[], labels: string[]) => void;
  onOther: (text: string) => void;
  onSkip: () => void;
  onBack: () => void;
  onForward: () => void;
  onClose: () => void;
}

/**
 * Sera's guided question card: one question at a time with numbered options, a free-text "Something else" row,
 * Skip, a pager and a close button. Keys 1-9 pick an option, arrows move, Enter chooses and Escape closes.
 */
export function QuestionCard({ question, busy = false, canGoBack, canGoForward, onAnswer, onOther, onSkip, onBack, onForward, onClose }: QuestionCardProps) {
  const titleId = useId();
  const cardRef = useRef<HTMLElement>(null);
  const [highlight, setHighlight] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [other, setOther] = useState('');

  // The parent remounts the card for each question (key), so state starts fresh; focus it so number keys work.
  useEffect(() => {
    cardRef.current?.focus({ preventScroll: true });
  }, []);

  const options = question.options;

  function choose(index: number) {
    const option = options[index];
    if (!option || busy) return;
    if (question.multiSelect) {
      setSelected((items) => items.includes(option.value) ? items.filter((item) => item !== option.value) : [...items, option.value]);
      return;
    }
    onAnswer([option.value], [option.label]);
  }

  function submitMulti() {
    if (busy) return;
    const extra = other.trim();
    if (!selected.length && !extra) return;
    if (extra) {
      // Typed extras travel as text; the planner merges them with any ticked options.
      onOther([...options.filter((option) => selected.includes(option.value)).map((option) => option.label), extra].join(', '));
      return;
    }
    onAnswer(selected, options.filter((option) => selected.includes(option.value)).map((option) => option.label));
  }

  function submitOther() {
    const text = other.trim();
    if (!text || busy) return;
    if (question.multiSelect) { submitMulti(); return; }
    onOther(text);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (event.target instanceof HTMLInputElement) {
      if (event.key === 'Escape') { (event.target as HTMLInputElement).blur(); cardRef.current?.focus(); }
      return;
    }
    if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
    if (/^[1-9]$/.test(event.key)) { event.preventDefault(); const index = Number(event.key) - 1; setHighlight(index); choose(index); return; }
    if (event.key === 'ArrowDown') { event.preventDefault(); setHighlight((value) => Math.min(value + 1, Math.max(options.length - 1, 0))); return; }
    if (event.key === 'ArrowUp') { event.preventDefault(); setHighlight((value) => Math.max(value - 1, 0)); return; }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (question.multiSelect && selected.length) submitMulti();
      else choose(highlight);
    }
  }

  return <section ref={cardRef} className={`question-card${busy ? ' is-busy' : ''}`} tabIndex={-1} aria-labelledby={titleId} aria-busy={busy} onKeyDown={onKeyDown}>
    <header className="question-card-head">
      <h3 id={titleId}>{question.title}</h3>
      <div className="question-card-nav">
        <button type="button" onClick={onBack} disabled={!canGoBack || busy} aria-label="Previous question"><ChevronLeft size={16} /></button>
        <span aria-live="polite">{question.index} of {question.total}</span>
        <button type="button" onClick={onForward} disabled={!canGoForward || busy} aria-label="Next question"><ChevronRight size={16} /></button>
        <button type="button" className="question-card-close" onClick={onClose} aria-label="Close questions"><X size={16} /></button>
      </div>
    </header>
    {options.length > 0 && <ul className="question-card-options" role={question.multiSelect ? 'group' : 'list'} aria-label={question.title}>
      {options.map((option, index) => {
        const isSelected = selected.includes(option.value);
        return <li key={option.value}>
          <button
            type="button"
            className={`question-option${index === highlight ? ' is-highlighted' : ''}${isSelected ? ' is-selected' : ''}`}
            onClick={() => { setHighlight(index); choose(index); }}
            onMouseEnter={() => setHighlight(index)}
            disabled={busy}
            aria-pressed={question.multiSelect ? isSelected : undefined}
          >
            <span className="question-option-key" aria-hidden="true">{question.multiSelect && isSelected ? <Check size={14} /> : index < 9 ? index + 1 : '•'}</span>
            <span className="question-option-text"><strong>{option.label}</strong>{option.description && <small>{option.description}</small>}</span>
          </button>
        </li>;
      })}
    </ul>}
    <footer className="question-card-foot">
      {question.allowOther && <form className="question-other" onSubmit={(event) => { event.preventDefault(); submitOther(); }}>
        <span className="question-option-key" aria-hidden="true"><Pencil size={14} /></span>
        <input value={other} onChange={(event) => setOther(event.target.value)} placeholder={options.length ? 'Something else' : question.otherPlaceholder} aria-label={question.otherPlaceholder} disabled={busy} />
      </form>}
      {question.multiSelect && <button type="button" className="button button-primary button-sm" onClick={submitMulti} disabled={busy || (!selected.length && !other.trim())}>Continue</button>}
      {question.skippable && <button type="button" className="question-skip" onClick={onSkip} disabled={busy}>Skip</button>}
      {!question.skippable && question.allowOther && !options.length && <button type="button" className="button button-primary button-sm" onClick={submitOther} disabled={busy || !other.trim()}>Continue</button>}
    </footer>
  </section>;
}

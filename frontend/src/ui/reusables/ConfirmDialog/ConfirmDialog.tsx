import { AlertTriangle, CheckCircle2, X } from 'lucide-react';
import { useEffect, useId } from 'react';
import type { ReactNode } from 'react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  details?: ReactNode;
  confirmLabel: string;
  tone?: 'primary' | 'danger';
  busy?: boolean;
  error?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ open, title, description, details, confirmLabel, tone = 'primary', busy = false, error, onConfirm, onCancel }: ConfirmDialogProps) {
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onCancel(); };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, busy, onCancel]);

  if (!open) return null;
  const Icon = tone === 'danger' ? AlertTriangle : CheckCircle2;
  return <div className="modal-backdrop" role="presentation" onMouseDown={() => { if (!busy) onCancel(); }}>
    <section className="modal-card confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby={titleId} onMouseDown={(event) => event.stopPropagation()}>
      <button className="modal-close" onClick={onCancel} disabled={busy} aria-label="Close"><X size={18} /></button>
      <span className={`confirm-icon ${tone}`}><Icon size={24} /></span>
      <h2 id={titleId}>{title}</h2>
      <p className="muted">{description}</p>
      {details && <div className="confirm-details">{details}</div>}
      {error && <p className="confirm-error" role="alert">{error}</p>}
      <div className="confirm-actions">
        <button className="button button-secondary" onClick={onCancel} disabled={busy}>Cancel</button>
        <button className={`button ${tone === 'danger' ? 'button-danger' : 'button-primary'}`} onClick={onConfirm} disabled={busy} autoFocus>{busy ? 'Please wait…' : confirmLabel}</button>
      </div>
    </section>
  </div>;
}

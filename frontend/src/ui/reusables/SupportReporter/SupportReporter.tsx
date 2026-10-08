import { Bug, CheckCircle2, DatabaseZap, KeyRound, MessageSquareText, X } from 'lucide-react';
import { useState } from 'react';
import { client } from '@/services/platform/client';
import { Dropdown } from '@/ui/reusables/Dropdown/Dropdown';
import type { Role, SupportTicketCreate, Ticket } from '@/types/domain';

const issueTypes: Array<{ value: SupportTicketCreate['issueType']; label: string; description: string; icon: typeof Bug }> = [
  { value: 'bug', label: "Something isn't working", description: 'A button, page, or workflow failed', icon: Bug },
  { value: 'incorrect_data', label: 'Data looks wrong', description: 'Missing, stale, or unexpected information', icon: DatabaseZap },
  { value: 'account_access', label: 'Account or access', description: 'Sign-in, permissions, or profile trouble', icon: KeyRound },
  { value: 'other', label: 'Something else', description: 'Questions or another kind of issue', icon: MessageSquareText },
];

const impactOptions: Array<{ value: SupportTicketCreate['priority']; label: string }> = [
  { value: 'low', label: 'Minor inconvenience' },
  { value: 'medium', label: 'Blocking part of my work' },
  { value: 'high', label: 'Blocking a key action' },
  { value: 'urgent', label: 'Account or deal is at risk' },
];

export function SupportReporter({ open, onClose, role, pageContext }: { open: boolean; onClose: () => void; role: Role; pageContext: string }) {
  const [issueType, setIssueType] = useState<SupportTicketCreate['issueType']>('bug');
  const [summary, setSummary] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<SupportTicketCreate['priority']>('medium');
  const [created, setCreated] = useState<Ticket | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  if (!open) return null;

  function close() {
    if (saving) return;
    setCreated(null);
    setError('');
    setSummary('');
    setDescription('');
    setIssueType('bug');
    setPriority('medium');
    onClose();
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      setCreated(await client.support.createTicket({ issueSummary: summary.trim(), issueDescription: description.trim(), issueType, pageContext, priority }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Your report could not be sent. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return <div className="modal-backdrop support-reporter-backdrop" onMouseDown={close}>
    <section className="support-reporter" role="dialog" aria-modal="true" aria-labelledby="support-reporter-title" onMouseDown={(event) => event.stopPropagation()}>
      <button className="modal-close support-reporter-close" onClick={close} aria-label="Close help and support"><X /></button>
      {created ? <div className="support-report-success">
        <span className="support-success-icon"><CheckCircle2 /></span>
        <span className="eyebrow">Report received</span>
        <h2 id="support-reporter-title">We’ve got it.</h2>
        <p>Your support team can now review the issue with the page context attached.</p>
        <div className="support-ticket-reference"><span>Ticket reference</span><strong>{created.publicId}</strong><small>{created.priority} priority · status {created.status}</small></div>
        <button className="button button-primary button-wide" onClick={close}>Done</button>
      </div> : <>
        <header className="support-reporter-header"><span className="eyebrow">Help &amp; support</span><h2 id="support-reporter-title">Tell us what went wrong</h2><p>Send the support team a clear report without leaving your {role === 'dealer' ? 'dealer' : 'buyer'} workspace.</p></header>
        <form className="support-report-form" onSubmit={(event) => void submit(event)}>
          <fieldset><legend>What can we help with?</legend><div className="support-issue-options">{issueTypes.map(({ value, label, description: helper, icon: Icon }) => <label key={value} className={issueType === value ? 'selected' : ''}><input type="radio" name="issue-type" value={value} checked={issueType === value} onChange={() => setIssueType(value)} /><Icon size={19} /><span><strong>{label}</strong><small>{helper}</small></span></label>)}</div></fieldset>
          <div className="field"><label htmlFor="support-summary">Short title</label><input id="support-summary" className="input" value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="Example: Quote totals are not updating" minLength={5} maxLength={200} required /></div>
          <div className="field support-description-field"><label htmlFor="support-description">What happened?</label><textarea id="support-description" className="input support-description" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Tell us what you expected, what you saw, and anything you already tried." maxLength={10000} required /></div>
          <div className="field"><label htmlFor="support-priority">Impact</label><Dropdown id="support-priority" ariaLabel="Impact" align="left" placement="up" value={priority} onChange={(value) => setPriority(value as SupportTicketCreate['priority'])} options={impactOptions} /></div>
          {error && <div className="inline-warning" role="alert">{error}</div>}
          <div className="support-report-actions"><button type="button" className="button button-ghost" onClick={close}>Cancel</button><button className="button button-primary" disabled={saving}>{saving ? 'Sending report…' : 'Send report'}</button></div>
        </form>
      </>}
    </section>
  </div>;
}

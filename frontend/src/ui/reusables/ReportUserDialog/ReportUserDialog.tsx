import { CheckCircle2, MessageSquareText, Paperclip, ShieldAlert, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { formatFileSize } from '@/helpers/drivingLicense';
import {
  REPORT_ACCEPT, REPORT_DETAILS_MAX, REPORT_DETAILS_MIN, REPORT_MAX_FILES, reportFilesProblem, reportReasons,
} from '@/helpers/reports';
import { client } from '@/services/platform/client';
import type { ReportReason, ReportReceipt, Role } from '@/types/domain';

interface ReportUserDialogProps {
  quoteId: string;
  /** Who is being reported: the other person in the conversation. */
  reportedName: string;
  reportedRole: Extract<Role, 'buyer' | 'dealer'>;
  vehicle: string;
  onClose: () => void;
}

/** Reports the other person in a conversation to the Trust & Safety team. Rendered only while open. */
export function ReportUserDialog({ quoteId, reportedName, reportedRole, vehicle, onClose }: ReportUserDialogProps) {
  const reasons = reportReasons(reportedRole);
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState('');
  const [includeConversation, setIncludeConversation] = useState(true);
  const [confirmAccurate, setConfirmAccurate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState<ReportReceipt | null>(null);

  // Thumbnails for the picked screenshots, released when the list changes or the dialog closes.
  const previews = useMemo(() => files.map((file) => URL.createObjectURL(file)), [files]);
  useEffect(() => () => previews.forEach((url) => URL.revokeObjectURL(url)), [previews]);

  const close = () => { if (!saving) onClose(); };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !saving) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [saving, onClose]);

  const trimmed = details.trim();
  const canSubmit = reason !== null && trimmed.length >= REPORT_DETAILS_MIN && confirmAccurate && !saving;

  function addFiles(picked: File[]) {
    const problem = reportFilesProblem(files, picked);
    setFileError(problem);
    if (!problem) setFiles((current) => [...current, ...picked]);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!reason || !canSubmit) return;
    setSaving(true);
    setError('');
    try {
      setReceipt(await client.reports.create({ quoteId, reason, details: trimmed, includeConversation, confirmAccurate, files }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Your report could not be sent. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return <div className="modal-backdrop support-reporter-backdrop" onMouseDown={close}>
    <section className="support-reporter report-user-dialog" role="dialog" aria-modal="true" aria-labelledby="report-user-title" onMouseDown={(event) => event.stopPropagation()}>
      <button type="button" className="modal-close support-reporter-close" onClick={close} aria-label="Close report"><X /></button>
      {receipt ? <div className="support-report-success">
        <span className="support-success-icon"><CheckCircle2 /></span>
        <span className="eyebrow">Report received</span>
        <h2 id="report-user-title">Thanks for letting us know.</h2>
        <p>Our Trust &amp; Safety team will review your report{receipt.evidenceCount ? ` and ${receipt.evidenceCount === 1 ? 'your screenshot' : `your ${receipt.evidenceCount} screenshots`}` : ''}{receipt.conversationAttached ? ', together with a saved copy of this conversation' : ''}. {reportedName} won’t be told who reported them.</p>
        <div className="support-ticket-reference"><span>Report reference</span><strong>{receipt.reportId}</strong><small>Keep this if you contact support about it.</small></div>
        <button type="button" className="button button-primary button-wide" onClick={onClose}>Done</button>
      </div> : <>
        <header className="support-reporter-header"><h2 id="report-user-title">Report {reportedName}</h2><p>About your conversation on the {vehicle}. Reports are confidential and reviewed by our Trust &amp; Safety team.</p></header>
        <form className="support-report-form" onSubmit={(event) => void submit(event)}>
          <fieldset><legend>What’s the problem? <span className="required">required</span></legend><div className="support-issue-options report-reason-options">{reasons.map((option) => <label key={option.value} className={reason === option.value ? 'selected' : ''} title={option.description}><input type="radio" name="report-reason" value={option.value} checked={reason === option.value} onChange={() => setReason(option.value)} /><span>{option.label}</span></label>)}</div></fieldset>
          <div className="field support-description-field"><label htmlFor="report-details">What happened? <span className="required">required</span></label><textarea id="report-details" className="input support-description" value={details} onChange={(event) => setDetails(event.target.value)} placeholder="Include dates, amounts, and what was said or asked of you." maxLength={REPORT_DETAILS_MAX} aria-describedby="report-details-count" required /><small id="report-details-count" className={`report-count${trimmed.length > 0 && trimmed.length < REPORT_DETAILS_MIN ? ' is-short' : ''}`}>{trimmed.length < REPORT_DETAILS_MIN ? `At least ${REPORT_DETAILS_MIN} characters · ` : ''}{details.length}/{REPORT_DETAILS_MAX}</small></div>
          <div className="field"><span className="support-field-label">Screenshots <span className="muted">(optional · up to {REPORT_MAX_FILES})</span></span><label className={`support-attach${files.length >= REPORT_MAX_FILES ? ' is-full' : ''}`} htmlFor="report-files"><Paperclip size={16} /><span>{files.length >= REPORT_MAX_FILES ? `${REPORT_MAX_FILES} screenshots added` : files.length ? 'Add another screenshot' : 'Attach screenshots'}</span><small>JPG, PNG, WebP · 5 MB</small><input id="report-files" type="file" multiple accept={REPORT_ACCEPT} disabled={files.length >= REPORT_MAX_FILES} onChange={(event) => { addFiles([...(event.target.files ?? [])]); event.target.value = ''; }} /></label></div>
          {(files.length > 0 || fileError) && <div className="support-attachments">{files.map((file, index) => <span className="support-file-chip report-file-chip" key={`${file.name}-${index}`}><img src={previews[index]} alt="" /><span><strong>{file.name}</strong><small>{formatFileSize(file.size)}</small></span><button type="button" onClick={() => { setFileError(''); setFiles((current) => current.filter((_, position) => position !== index)); }} aria-label={`Remove ${file.name}`}><X size={14} /></button></span>)}{fileError && <span className="field-error" role="alert">{fileError}</span>}</div>}
          <label className="report-check"><input type="checkbox" checked={includeConversation} onChange={(event) => setIncludeConversation(event.target.checked)} /><span><strong><MessageSquareText size={14} /> Include this conversation</strong><small>We save a copy of the messages as they are now, so they can still be reviewed if they’re edited or deleted later.</small></span></label>
          <label className="report-check"><input type="checkbox" checked={confirmAccurate} onChange={(event) => setConfirmAccurate(event.target.checked)} required /><span><strong>The information I’ve provided is accurate</strong><small>False reports may lead to action on your own account.</small></span></label>
          {error && <div className="inline-warning" role="alert"><ShieldAlert size={16} /> <span>{error}</span></div>}
          <div className="support-report-actions"><button type="button" className="button button-ghost" onClick={close}>Cancel</button><button className="button button-primary report-submit" disabled={!canSubmit}>{saving ? 'Sending report…' : 'Submit report'}</button></div>
        </form>
      </>}
    </section>
  </div>;
}

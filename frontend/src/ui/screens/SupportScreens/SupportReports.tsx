import { ArrowLeft, ArrowRight, Check, ChevronRight, ExternalLink, Flag, ImageIcon, Mail, MessageSquarePlus, MessageSquareText, Phone, Search, ShieldAlert, UserRound, UserRoundX, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { relativeTime } from '@/helpers/dateTime';
import { formatFileSize } from '@/helpers/drivingLicense';
import { REPORT_OUTCOME_LABELS, REPORT_STATUS_LABELS, isClosedReport, reportReasonLabel, reportReasons } from '@/helpers/reports';
import { client } from '@/services/platform/client';
import { Dropdown } from '@/ui/reusables/Dropdown/Dropdown';
import { EmptyState } from '@/ui/reusables/EmptyState/EmptyState';
import { PageLoading } from '@/ui/reusables/PageLoading/PageLoading';
import { StatusBadge } from '@/ui/reusables/StatusBadge/StatusBadge';
import type { ReportOutcome, ReportPerson, ReportStatus, UserReport } from '@/types/domain';

type StatusFilter = 'active' | 'all' | ReportStatus;
type RoleFilter = 'all' | 'buyer' | 'dealer';

const STATUS_OPTIONS = [{ value: 'active', label: 'Active' }, { value: 'all', label: 'All statuses' }, ...(Object.entries(REPORT_STATUS_LABELS).map(([value, label]) => ({ value, label })))];
const ROLE_OPTIONS = [{ value: 'all', label: 'Buyer & dealer' }, { value: 'dealer', label: 'Dealer' }, { value: 'buyer', label: 'Buyer' }];
// Every reason either side can be reported for, without repeating the shared ones.
const REASON_OPTIONS = [{ value: 'all', label: 'All reasons' }, ...[...reportReasons('dealer'), ...reportReasons('buyer')]
  .filter((option, index, all) => all.findIndex((other) => other.value === option.value) === index)
  .map((option) => ({ value: option.value, label: option.label }))];
const ACTION_OUTCOMES: ReportOutcome[] = ['warning_issued', 'account_suspended', 'other'];

const personName = (person: ReportPerson) => person.dealershipName || person.name || 'Account unavailable';
const roleLabel = (role: ReportPerson['role']) => (role === 'dealer' ? 'Dealer' : 'Buyer');
const isActive = (report: UserReport) => !isClosedReport(report.status);

/** Support's misconduct queue at /reports, and one report's case page at /reports/:reportId. */
export default function SupportReports() {
  const { reportId } = useParams();
  return reportId ? <ReportDetail key={reportId} id={reportId} /> : <ReportQueue />;
}

function ReportQueue() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [reports, setReports] = useState<UserReport[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>(() => (searchParams.get('status') as StatusFilter | null) ?? 'active');
  const [role, setRole] = useState<RoleFilter>('all');
  const [reason, setReason] = useState('all');

  useEffect(() => { void client.reports.list().then(setReports).catch(() => { setReports([]); setFailed(true); }); }, []);

  const rows = useMemo(() => (reports ?? [])
    .filter((report) => status === 'all' || (status === 'active' ? isActive(report) : report.status === status))
    .filter((report) => role === 'all' || report.reported.role === role)
    .filter((report) => reason === 'all' || report.reason === reason)
    .filter((report) => `${report.reportId} ${personName(report.reported)} ${personName(report.reporter)} ${report.reported.email ?? ''} ${report.reporter.email ?? ''} ${report.vehicle ?? ''} ${report.details}`.toLowerCase().includes(query.trim().toLowerCase())),
  [query, reason, reports, role, status]);

  if (!reports) return <PageLoading label="Loading reports" />;
  const open = (id: string) => navigate(`/reports/${id}`);
  return <section className="shell page-content support-list-page">
    <div className="page-heading"><div><span className="eyebrow">Trust &amp; safety</span><h1>Reports about buyers and dealers</h1><p>Review misconduct reported from conversations, check the evidence, and record the action taken.</p></div><span className="results-count">{rows.length} results</span></div>
    <div className="card card-pad support-filter-grid"><label className="search-field"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search reference, name, email, or vehicle" /></label><div className="select-inline"><label htmlFor="report-role">Reported</label><Dropdown id="report-role" ariaLabel="Filter reports by who was reported" align="left" value={role} onChange={(value) => setRole(value as RoleFilter)} options={ROLE_OPTIONS} /></div><div className="select-inline"><label htmlFor="report-reason">Reason</label><Dropdown id="report-reason" ariaLabel="Filter reports by reason" align="left" value={reason} onChange={setReason} options={REASON_OPTIONS} /></div><div className="select-inline"><label htmlFor="report-status">Status</label><Dropdown id="report-status" ariaLabel="Filter reports by status" align="right" value={status} onChange={(value) => setStatus(value as StatusFilter)} options={STATUS_OPTIONS} /></div></div>
    {failed && <div className="inline-warning" role="alert"><ShieldAlert size={16} /> Reports could not be loaded. Refresh to try again.</div>}
    <div className="card support-data-card"><div className="table-wrap"><table className="data-table operations-table report-table clickable-table"><thead><tr><th>Report &amp; reporter</th><th>Reported</th><th>Reason</th><th>Status</th><th>Age</th><th><span className="sr-only">Action</span></th></tr></thead><tbody>{rows.map((report) => <tr key={report.id} tabIndex={0} onClick={() => open(report.id)} onKeyDown={(event) => { if (event.key === 'Enter') open(report.id); }}>
      <td><strong>{report.reportId}</strong><small>by {personName(report.reporter)} · {roleLabel(report.reporter.role)}</small></td>
      <td><strong className="report-person">{personName(report.reported)}{!report.reported.isActive && <span className="report-suspended">Suspended</span>}</strong><small>{roleLabel(report.reported.role)}{report.vehicle ? ` · ${report.vehicle}` : ''}</small></td>
      <td><span className="issue-cell">{reportReasonLabel(report.reason)}</span><small>{report.attachments.length ? `${report.attachments.length} screenshot${report.attachments.length === 1 ? '' : 's'}` : 'No screenshots'}{report.conversationAttached ? ' · conversation saved' : ''}</small></td>
      <td><StatusBadge status={report.status} /></td><td>{relativeTime(report.createdAt)}</td><td><span className="button button-secondary button-sm">Open</span></td>
    </tr>)}</tbody></table></div>{rows.length === 0 && <EmptyState title={reports.length ? 'No reports match' : 'No reports yet'} description={reports.length ? 'Clear a filter or try another reference, name, or vehicle.' : 'Reports that buyers and dealers send from their conversations appear here.'} />}</div>
  </section>;
}

/** A compact list of the newest active reports for the support console. */
export function ReportsOverview({ reports }: { reports: UserReport[] }) {
  const active = reports.filter(isActive);
  return <section className="card card-pad queue-card"><div className="section-head"><div><span className="eyebrow">Trust &amp; safety</span><h2>Reports awaiting a decision{active.length > 0 && <span className="report-count-pill">{active.length}</span>}</h2></div><Link to="/reports">View reports <ChevronRight size={14} /></Link></div>
    <div className="support-compact-list">{active.slice(0, 3).map((report) => <Link to={`/reports/${report.id}`} className="support-compact-row" key={report.id}><div><span className="support-row-top"><strong>{reportReasonLabel(report.reason)}</strong><StatusBadge status={report.status} /></span><small>{personName(report.reported)} · {roleLabel(report.reported.role)} · {relativeTime(report.createdAt)}</small></div><Flag size={15} className="report-flag" /><ChevronRight size={16} /></Link>)}{active.length === 0 && <p className="compact-empty">No reports need a decision.</p>}</div>
  </section>;
}

function ReportDetail({ id }: { id: string }) {
  const [report, setReport] = useState<UserReport | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => { void client.reports.get(id).then(setReport).catch(() => setMissing(true)); }, [id]);

  if (missing) return <div className="shell page-content"><Link className="button button-ghost" to="/reports"><ArrowLeft size={17} /> Back to reports</Link><EmptyState title="Report not found" description="It may have been removed, or the link is incomplete." /></div>;
  if (!report) return <PageLoading label="Loading report" />;
  return <div className="shell page-content">
    <Link className="button button-ghost" to="/reports"><ArrowLeft size={17} /> Back to reports</Link>
    <div className="page-heading case-heading"><div><span className="eyebrow">{report.reportId} · Report about a {report.reported.role === 'dealer' ? 'dealer' : 'buyer'}</span><h1>{reportReasonLabel(report.reason)}</h1><p>Reported by {personName(report.reporter)} · {relativeTime(report.createdAt)}{report.vehicle ? ` · ${report.vehicle}` : ''}</p></div><StatusBadge status={report.status} /></div>
    <div className="case-layout"><main className="grid">
      <section className="card card-pad"><span className="eyebrow">What the reporter said</span><p className="case-description">{report.details}</p><div className="case-metadata"><span><strong>Reason</strong>{reportReasonLabel(report.reason)}</span><span><strong>Vehicle</strong>{report.vehicle ?? 'Not available'}</span><span><strong>Submitted</strong>{new Date(report.createdAt).toLocaleString()}</span>{report.outcome && <span><strong>Outcome</strong>{REPORT_OUTCOME_LABELS[report.outcome]}</span>}</div><ReportEvidence report={report} /></section>
      <ReportPeople report={report} />
      <ReportConversation report={report} />
      <section className="card card-pad"><div className="section-head"><div><span className="eyebrow">Audit trail</span><h2>Case timeline</h2></div></div><div className="timeline"><div><i /><span><strong>Report submitted by {personName(report.reporter)}</strong><small>{new Date(report.createdAt).toLocaleString()}</small></span></div>{report.events.map((event, index) => <div key={`${event.at}-${index}`}><i /><span><strong>{event.author}{event.status ? ` set the status to ${REPORT_STATUS_LABELS[event.status]}` : ' added a note'}{event.outcome ? ` · ${REPORT_OUTCOME_LABELS[event.outcome]}` : ''}</strong>{event.note && <p>{event.note}</p>}<small>{new Date(event.at).toLocaleString()}</small></span></div>)}</div></section>
    </main><ReportControls report={report} onSaved={setReport} /></div>
  </div>;
}

/** Who reported whom, read left to right: the reporter, what they reported, and the account under review. */
function ReportPeople({ report }: { report: UserReport }) {
  const reporterRole = roleLabel(report.reporter.role).toLowerCase();
  const reportedRole = roleLabel(report.reported.role).toLowerCase();
  return <section className="card card-pad"><div className="section-head"><div><span className="eyebrow">People</span><h2>Who reported whom</h2></div></div>
    <p className="report-people-summary"><strong>{personName(report.reporter)}</strong> ({reporterRole}) reported <strong>{personName(report.reported)}</strong> ({reportedRole}) for <strong>{reportReasonLabel(report.reason).toLowerCase()}</strong>{report.vehicle ? <> in their conversation about the <strong>{report.vehicle}</strong></> : null}.</p>
    <div className="report-people">
      <PersonCard tone="reporter" label="Filed the report" person={report.reporter} />
      <div className="report-people-link" aria-hidden="true"><span>Reported for</span><strong>{reportReasonLabel(report.reason)}</strong><ArrowRight size={20} /></div>
      <PersonCard tone="reported" label="Being reported" person={report.reported} suspended={!report.reported.isActive} />
    </div>
    <p className="muted report-people-hint">This case decides what happens to the reported account. {report.reported.isActive ? <>An administrator can suspend it from <Link to="/support-members">Members</Link>.</> : 'An administrator has already suspended it.'}</p>
  </section>;
}

function PersonCard({ tone, label, person, suspended = false }: { tone: 'reporter' | 'reported'; label: string; person: ReportPerson; suspended?: boolean }) {
  const contactName = person.dealershipName && person.name && person.dealershipName !== person.name ? person.name : null;
  return <div className={`report-person-card is-${tone}`}>
    <span className="report-person-label">{tone === 'reported' ? <UserRoundX size={15} /> : <Flag size={15} />} {label}</span>
    <span className="report-person-head"><span className="report-person-avatar" aria-hidden="true">{personName(person).charAt(0).toUpperCase()}</span><span><strong>{personName(person)}</strong><span className="report-person-role">{roleLabel(person.role)}{tone === 'reported' && <span className={suspended ? 'report-suspended' : 'report-active'}>{suspended ? 'Suspended' : 'Account active'}</span>}</span></span></span>
    <dl className="report-person-facts">
      {contactName && <div><dt><UserRound size={13} /> Contact</dt><dd>{contactName}</dd></div>}
      <div><dt><Mail size={13} /> Email</dt><dd>{person.email ?? 'Not supplied'}</dd></div>
      <div><dt><Phone size={13} /> Phone</dt><dd>{person.phone ?? 'Not supplied'}</dd></div>
    </dl>
  </div>;
}

/** The reporter's screenshots. Each View asks for a fresh short-lived link and opens the image in a new tab. */
function ReportEvidence({ report }: { report: UserReport }) {
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  async function view(attachmentId: string) {
    setBusyId(attachmentId); setError('');
    // Open the tab inside the click so pop-up blockers allow it, then point it at the link once it arrives.
    const tab = window.open('', '_blank');
    try {
      const { url } = await client.reports.attachmentLink(report.id, attachmentId);
      if (tab) { tab.opener = null; tab.location.href = url; } else window.location.assign(url);
    } catch {
      tab?.close();
      setError('That screenshot could not be opened. Please try again.');
    } finally {
      setBusyId('');
    }
  }
  return <div className="case-attachments">
    <strong className="case-attachments-title">Screenshots{report.attachments.length > 0 && <span>{report.attachments.length}</span>}</strong>
    {report.attachments.length === 0 ? <p className="muted">No screenshots were attached.</p> : <ul>{report.attachments.map((file) => <li key={file.id}><button type="button" className="case-attachment" onClick={() => void view(file.id)} disabled={busyId === file.id} aria-label={`View ${file.fileName}`}><ImageIcon size={18} /><span><strong>{file.fileName}</strong><small>Image · {formatFileSize(file.sizeBytes)}</small></span><ExternalLink size={16} /></button></li>)}</ul>}
    {error && <span className="field-error" role="alert">{error}</span>}
  </div>;
}

/** The conversation as it stood when the report was sent, with the reported person's messages marked. */
function ReportConversation({ report }: { report: UserReport }) {
  return <section className="card card-pad"><div className="section-head"><div><span className="eyebrow">Evidence</span><h2>Conversation at the time of the report</h2></div>{report.conversationAttached && <span className="results-count">{report.messageCount} messages</span>}</div>
    {!report.conversationAttached ? <p className="muted"><MessageSquareText size={15} /> The reporter chose not to include the conversation.</p>
      : report.conversation?.length ? <ol className="report-transcript">{report.conversation.map((message) => {
        const fromReported = message.senderId === report.reported.id;
        return <li key={message.id} className={fromReported ? 'from-reported' : ''}><span className="report-transcript-meta"><strong>{message.senderName}</strong> · {fromReported ? 'Reported' : 'Reporter'}{message.at ? ` · ${new Date(message.at).toLocaleString()}` : ''}{message.edited && <em>edited</em>}</span><p className={message.unsent ? 'is-unsent' : ''}>{message.message}</p></li>;
      })}</ol> : <p className="muted">The conversation had no messages yet.</p>}
  </section>;
}

function ReportControls({ report, onSaved }: { report: UserReport; onSaved: (report: UserReport) => void }) {
  const [status, setStatus] = useState<ReportStatus>(report.status);
  const [outcome, setOutcome] = useState<ReportOutcome>(report.outcome && report.outcome !== 'no_violation' ? report.outcome : 'warning_issued');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const closing = isClosedReport(status) && !isClosedReport(report.status);
  const noteRequired = closing && !note.trim();
  const unchanged = status === report.status && (status !== 'action_taken' || outcome === report.outcome) && !note.trim();

  async function save() {
    setSaving(true); setError(''); setSaved(false);
    try {
      const updated = await client.reports.update(report.id, { status, ...(status === 'action_taken' ? { outcome } : {}), ...(note.trim() ? { note: note.trim() } : {}) });
      onSaved(updated);
      setNote('');
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The update could not be saved. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return <aside className="card card-pad case-actions"><span className="eyebrow">Case controls</span><h2>Update report</h2>
    {saved && <div className="inline-success"><Check size={17} /> Report updated.</div>}
    <div className="field"><label htmlFor="report-status-select">Status</label><select id="report-status-select" className="select" value={status} onChange={(event) => { setStatus(event.target.value as ReportStatus); setSaved(false); }}>{(Object.keys(REPORT_STATUS_LABELS) as ReportStatus[]).map((value) => <option key={value} value={value}>{REPORT_STATUS_LABELS[value]}</option>)}</select></div>
    {status === 'action_taken' && <div className="field"><label htmlFor="report-outcome-select">Action taken <span className="required">required</span></label><select id="report-outcome-select" className="select" value={outcome} onChange={(event) => setOutcome(event.target.value as ReportOutcome)}>{ACTION_OUTCOMES.map((value) => <option key={value} value={value}>{REPORT_OUTCOME_LABELS[value]}</option>)}</select>{outcome === 'account_suspended' && <small className="muted">Suspend the account from Members first; this records the decision.</small>}</div>}
    {status === 'dismissed' && <p className="muted report-dismiss-hint"><X size={14} /> Dismissing records the outcome as no violation.</p>}
    <div className="field"><label htmlFor="report-note">{closing ? <>Decision note <span className="required">required</span></> : 'Internal note'}</label><textarea id="report-note" className="textarea" rows={4} value={note} onChange={(event) => setNote(event.target.value)} placeholder={closing ? 'What you checked and why this decision is right.' : 'What changed or what should the next agent know?'} maxLength={5000} /></div>
    {error && <div className="inline-warning" role="alert"><ShieldAlert size={16} /> <span>{error}</span></div>}
    <button type="button" className="button button-primary button-wide" disabled={saving || noteRequired || unchanged} onClick={() => void save()}><MessageSquarePlus size={17} /> {saving ? 'Saving…' : 'Save update'}</button>
  </aside>;
}

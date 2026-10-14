import {
  AlertTriangle, ArrowLeft, Building2, Check, ChevronRight, Clock3, Download, ExternalLink,
  FileCheck2, FileText, ImageIcon, Mail, MessageSquarePlus, Search, ShieldCheck,
  TicketCheck, UserRoundCheck, X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { relativeTime } from '@/helpers/dateTime';
import { formatFileSize } from '@/helpers/drivingLicense';
import {
  DEFAULT_TICKET_FILTERS, PENDING_DEALER_FILTERS, SUPPORT_CARD_LINKS, matchesTicketFilters, matchesVerificationFilters, supportStats,
  ticketFiltersFromSearch, verificationFiltersFromSearch, type TicketFilters, type VerificationFilters,
} from '@/helpers/supportQueue';
import { client } from '@/services/platform/client';
import { useEffectiveSession } from '@/ui/navigations/previewSession';
import { Dropdown } from '@/ui/reusables/Dropdown/Dropdown';
import { EmptyState } from '@/ui/reusables/EmptyState/EmptyState';
import { PageLoading } from '@/ui/reusables/PageLoading/PageLoading';
import { StatusBadge } from '@/ui/reusables/StatusBadge/StatusBadge';
import { SupportMembers } from '@/ui/screens/SupportScreens/SupportMembers';
import type { Ticket, Verification, VerificationStatus } from '@/types/domain';

const applicantLabel = (category: Verification['category']) => category === 'agent' ? 'Support' : category === 'customer' ? 'Buyer' : 'Dealer';
const ticketAudience = (ticket: Ticket) => ticket.category === 'dealer' ? 'Dealer' : 'Buyer';

/** How often the console re-reads the queues while it is open and visible. */
const CONSOLE_REFRESH_MS = 30_000;
/** Re-renders often enough that "updated 2 minutes ago" stays true between refreshes. */
const CONSOLE_CLOCK_MS = 15_000;
const TICKET_AUDIENCE_OPTIONS = [{ value: 'all', label: 'Buyer & dealer' }, { value: 'customer', label: 'Buyer' }, { value: 'dealer', label: 'Dealer' }];
const TICKET_PRIORITY_OPTIONS = [{ value: 'all', label: 'All priorities' }, { value: 'urgent', label: 'Urgent' }, { value: 'high', label: 'High' }, { value: 'medium', label: 'Medium' }, { value: 'low', label: 'Low' }];
const TICKET_STATUS_OPTIONS = [{ value: 'active', label: 'Active' }, { value: 'all', label: 'All statuses' }, { value: 'open', label: 'New' }, { value: 'in_progress', label: 'In progress' }, { value: 'on_hold', label: 'On hold' }, { value: 'resolved', label: 'Resolved' }, { value: 'closed', label: 'Closed' }];
const VERIFICATION_APPLICANT_OPTIONS = [{ value: 'all', label: 'Dealer & support' }, { value: 'dealer', label: 'Dealer' }, { value: 'agent', label: 'Support' }];
const VERIFICATION_STATUS_OPTIONS = [{ value: 'all', label: 'All statuses' }, { value: 'pending', label: 'Pending' }, { value: 'approved', label: 'Approved' }, { value: 'denied', label: 'Denied' }, { value: 'rejected', label: 'Evidence rejected' }];
const sameRows = <T,>(a: T[], b: T[]) => JSON.stringify(a) === JSON.stringify(b);

export default function SupportScreens() {
  const location = useLocation();
  const path = location.pathname;
  const navigate = useNavigate();
  const { ticketId } = useParams();
  const session = useEffectiveSession();
  const canAdminister = session?.role === 'support-admin' || session?.role === 'admin';
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [verifications, setVerifications] = useState<Verification[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [refreshedAt, setRefreshedAt] = useState(() => new Date());
  const [, setClock] = useState(0);

  const applyQueues = useCallback(({ queue, reviews }: { queue: Ticket[] | null; reviews: Verification[] | null }) => {
    // A failed refresh keeps what is already on screen instead of blanking the console.
    if (queue) setTickets((current) => sameRows(current, queue) ? current : queue);
    if (reviews) setVerifications((current) => sameRows(current, reviews) ? current : reviews);
    if (queue || reviews) setRefreshedAt(new Date());
  }, []);
  const refresh = useCallback(() => Promise.all([client.support.queue().catch(() => null), client.verifications.list().catch(() => null)])
    .then(([queue, reviews]) => applyQueues({ queue, reviews })), [applyQueues]);

  // Every visit to a support page reads the queues afresh, so a card and the list it opens agree.
  useEffect(() => { void refresh().then(() => setLoaded(true)); }, [refresh, path]);

  const onConsole = path === '/support';
  useEffect(() => {
    if (!onConsole) return undefined;
    const refreshIfVisible = () => { if (document.visibilityState === 'visible') void refresh(); };
    const poll = window.setInterval(refreshIfVisible, CONSOLE_REFRESH_MS);
    const clock = window.setInterval(() => setClock((tick) => tick + 1), CONSOLE_CLOCK_MS);
    document.addEventListener('visibilitychange', refreshIfVisible);
    return () => { window.clearInterval(poll); window.clearInterval(clock); document.removeEventListener('visibilitychange', refreshIfVisible); };
  }, [onConsole, refresh]);

  async function updateTicket(id: string, status: Ticket['status'], note?: string, rca?: string) {
    const updated = await client.support.updateTicket(id, status, note, rca);
    setTickets((items) => items.map((item) => item.id === id ? updated : item));
  }

  async function decide(id: string, decision: VerificationStatus, reason: string) {
    if (decision === 'pending') return;
    const updated = await client.verifications.decide(id, decision, reason);
    setVerifications((items) => items.map((item) => item.id === id ? updated : item));
  }

  if (!loaded) {
    if (path === '/support-members') return <PageLoading label="Loading team members" />;
    if (path === '/verifications') return <PageLoading label="Loading verification cases" />;
    if (path === '/tickets' || path === '/help-support' || ticketId) return <PageLoading label="Loading support tickets" />;
    return <PageLoading label="Preparing the decision desk" />;
  }
  if (ticketId) return <TicketDetail id={ticketId} tickets={tickets} updateTicket={updateTicket} />;
  if (path === '/support-members') return <SupportMembers />;
  // The address-bar filters seed each list, so a new query string starts the list afresh.
  if (path === '/verifications') return <Verifications key={location.search} verifications={verifications} canAdminister={canAdminister} decide={decide} />;
  if (path === '/tickets' || path === '/help-support') return <Tickets key={location.search} tickets={tickets} navigate={navigate} />;

  const stats = supportStats(tickets, verifications);
  return <div className="shell page-content support-console">
    <div className="page-heading"><div><span className="eyebrow">Support operations</span><h1>Today’s decision desk</h1><p>Prioritize approval risk, SLA pressure, and people waiting for a clear next step.</p></div><span className="live-ops"><i /> Live queue · updated {relativeTime(refreshedAt.toISOString())}</span></div>
    <div className="grid grid-4">
      <StatCard to={SUPPORT_CARD_LINKS.openTickets} label="Open tickets" icon={<TicketCheck size={17} />} value={stats.openTickets}><span className="stat-note">{stats.highPriorityOpen} high priority</span></StatCard>
      <StatCard to={SUPPORT_CARD_LINKS.pendingDealerVerifications} label="Pending dealer verifications" icon={<ShieldCheck size={17} />} value={stats.pendingDealerVerifications}><span className="muted">{stats.pendingTeamRequests > 0 ? `+${stats.pendingTeamRequests} team access ${stats.pendingTeamRequests === 1 ? 'request' : 'requests'}` : 'Awaiting a decision'}</span></StatCard>
      <StatCard to={SUPPORT_CARD_LINKS.slaRisk} label="SLA risk" icon={<AlertTriangle size={17} />} value={stats.slaRisk}>{stats.slaRisk > 0 ? <span className="sla-risk">Needs action today</span> : <span className="stat-note">All clear</span>}</StatCard>
      <StatCard to={SUPPORT_CARD_LINKS.resolvedToday} label="Resolved today" icon={<Check size={17} />} value={stats.resolvedToday}><span className="stat-note">Since midnight</span></StatCard>
    </div>
    <div className="grid grid-2 support-overview-grid"><Tickets compact tickets={tickets} navigate={navigate} /><Verifications compact verifications={verifications} canAdminister={canAdminister} decide={decide} /></div>
  </div>;
}

/** A console number that opens the list it counts. */
function StatCard({ to, label, icon, value, children }: { to: string; label: string; icon: ReactNode; value: number; children: ReactNode }) {
  return <Link to={to} className="card card-hover stat-card stat-card-link"><div className="stat-label">{label} {icon}</div><div className="stat-value">{value}</div>{children}</Link>;
}

function Tickets({ tickets, navigate, compact = false }: { tickets: Ticket[]; navigate: (to: string) => void; compact?: boolean }) {
  const [searchParams] = useSearchParams();
  const [filters, setFilters] = useState<TicketFilters>(() => compact ? DEFAULT_TICKET_FILTERS : ticketFiltersFromSearch(searchParams));
  const [query, setQuery] = useState('');
  const setFilter = <K extends keyof TicketFilters>(key: K, value: TicketFilters[K]) => setFilters((current) => ({ ...current, [key]: value }));
  const rows = useMemo(() => tickets
    .filter((ticket) => matchesTicketFilters(ticket, filters))
    .filter((ticket) => `${ticket.publicId} ${ticket.callerName} ${ticket.callerEmail ?? ''} ${ticket.summary} ${ticket.description ?? ''} ${ticket.issueType ?? ''}`.toLowerCase().includes(query.trim().toLowerCase()))
    .slice(0, compact ? 3 : undefined), [compact, filters, query, tickets]);

  return <section className={compact ? 'card card-pad queue-card' : 'shell page-content support-list-page'}>
    {!compact && <div className="page-heading"><div><span className="eyebrow">Support queue</span><h1>Tickets that need a person</h1><p>Find a buyer or dealer case, inspect its timeline, and record a verified resolution.</p></div><span className="results-count">{rows.length} results</span></div>}
    {compact && <div className="section-head"><div><span className="eyebrow">Priority queue</span><h2>Open cases</h2></div><Link to="/tickets">View queue <ChevronRight size={14} /></Link></div>}
    {!compact && <div className="card card-pad support-filter-grid"><label className="search-field"><Search size={16} /><input aria-label="Search support cases" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search case ID, name, email, or issue" /></label><div className="select-inline"><label htmlFor="ticket-applicant">Applicant</label><Dropdown id="ticket-applicant" ariaLabel="Filter tickets by applicant" align="left" value={filters.audience} onChange={(value) => setFilter('audience', value as TicketFilters['audience'])} options={TICKET_AUDIENCE_OPTIONS} /></div><div className="select-inline"><label htmlFor="ticket-priority">Priority</label><Dropdown id="ticket-priority" ariaLabel="Filter tickets by priority" align="left" value={filters.priority} onChange={(value) => setFilter('priority', value as TicketFilters['priority'])} options={TICKET_PRIORITY_OPTIONS} /></div><div className="select-inline"><label htmlFor="ticket-status">Status</label><Dropdown id="ticket-status" ariaLabel="Filter tickets by status" align="right" value={filters.status} onChange={(value) => setFilter('status', value as TicketFilters['status'])} options={TICKET_STATUS_OPTIONS} /></div></div>}
    {!compact && filters.period === 'today' && <div className="active-filter"><span>Updated today</span><button type="button" onClick={() => setFilter('period', 'any')} aria-label="Show tickets from any day"><X size={13} /></button></div>}
  {compact ? <div className="support-compact-list">{rows.map((ticket) => <Link to={`/tickets/${ticket.id}`} className="support-compact-row" key={ticket.id}><div><span className="support-row-top"><strong>{ticket.summary}</strong><StatusBadge status={ticket.status} /></span><small>{ticket.callerName} · {ticketAudience(ticket)} · {relativeTime(ticket.createdAt)}</small></div><span className={`priority priority-${ticket.priority}`}>{ticket.priority}</span><ChevronRight size={16} /></Link>)}{rows.length === 0 && <p className="compact-empty">No open cases need attention.</p>}</div> : <div className="card support-data-card"><div className="table-wrap"><table className="data-table operations-table ticket-table clickable-table"><colgroup><col className="ticket-col-caller" /><col className="ticket-col-issue" /><col className="ticket-col-priority" /><col className="ticket-col-status" /><col className="ticket-col-age" /><col className="ticket-col-action" /></colgroup><thead><tr><th>Case &amp; requester</th><th>Issue</th><th>Priority</th><th>Status</th><th>Age</th><th><span className="sr-only">Action</span></th></tr></thead><tbody>{rows.map((ticket) => <tr key={ticket.id} tabIndex={0} onClick={() => navigate(`/tickets/${ticket.id}`)} onKeyDown={(event) => { if (event.key === 'Enter') navigate(`/tickets/${ticket.id}`); }}><td><strong>{ticket.publicId}</strong><small>{ticket.callerName} · {ticketAudience(ticket)}</small>{ticket.callerEmail && <small>{ticket.callerEmail}</small>}</td><td><span className="issue-cell">{ticket.summary}</span><small>{ticket.issueType ? ticket.issueType.replaceAll('_', ' ') : 'Support request'}</small></td><td><span className={`priority priority-${ticket.priority}`}>{ticket.priority}</span></td><td><StatusBadge status={ticket.status} /></td><td>{relativeTime(ticket.createdAt)}</td><td><span className="button button-secondary button-sm">Open</span></td></tr>)}</tbody></table></div>{rows.length === 0 && <EmptyState title="No tickets match" description="Clear a filter or try another requester, case ID, or issue." />}</div>}
  </section>;
}

/** The requester's screenshots or PDFs. Each click asks for a fresh short-lived link, then saves the file. */
function TicketAttachments({ ticket }: { ticket: Ticket }) {
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const files = ticket.attachments ?? [];

  async function download(attachmentId: string) {
    setBusyId(attachmentId);
    setError('');
    try {
      const { url, fileName } = await client.support.attachmentDownload(ticket.id, attachmentId);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      link.rel = 'noopener';
      document.body.append(link);
      link.click();
      link.remove();
    } catch {
      setError('That file could not be downloaded. Please try again.');
    } finally {
      setBusyId('');
    }
  }

  return <div className="case-attachments">
    <strong className="case-attachments-title">Attachments{files.length > 0 && <span>{files.length}</span>}</strong>
    {files.length === 0 ? <p className="muted">No screenshots or files were attached.</p> : <ul>{files.map((file) => <li key={file.id}>
      <button type="button" className="case-attachment" onClick={() => void download(file.id)} disabled={busyId === file.id} aria-label={`Download ${file.fileName}`}>
        {file.contentType === 'application/pdf' ? <FileText size={18} /> : <ImageIcon size={18} />}
        <span><strong>{file.fileName}</strong><small>{file.contentType === 'application/pdf' ? 'PDF' : 'Image'} · {formatFileSize(file.sizeBytes)}</small></span>
        <Download size={16} />
      </button>
    </li>)}</ul>}
    {error && <span className="field-error" role="alert">{error}</span>}
  </div>;
}

function TicketDetail({ id, tickets, updateTicket }: { id: string; tickets: Ticket[]; updateTicket: (id: string, status: Ticket['status'], note?: string, rca?: string) => Promise<void> }) {
  const ticket = tickets.find((item) => item.id === id);
  const [nextStatus, setNextStatus] = useState<Ticket['status']>(ticket?.status ?? 'open');
  const [note, setNote] = useState('');
  const [rca, setRca] = useState(ticket?.rca ?? '');
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  if (!ticket) return <div className="shell page-content"><EmptyState title="Ticket not found" description="The case may have moved or been removed." /></div>;
  return <div className="shell page-content"><Link className="button button-ghost" to="/tickets"><ArrowLeft size={17} /> Back to queue</Link><div className="page-heading case-heading"><div><span className="eyebrow">{ticket.publicId} · {ticketAudience(ticket)} support</span><h1>{ticket.summary}</h1><p>Opened by {ticket.callerName} · {relativeTime(ticket.createdAt)}</p></div><StatusBadge status={ticket.status} /></div>{saved && <div className="inline-success"><Check size={17} /> Case update saved.</div>}<div className="case-layout"><main className="grid"><section className="card card-pad"><span className="eyebrow">Request details</span><p className="case-description">{ticket.description ?? 'The requester reported this issue through the Deal&Drive support form and is waiting for a response.'}</p><div className="case-metadata"><span><strong>Requester</strong>{ticket.callerName}</span><span><strong>Email</strong>{ticket.callerEmail ?? 'Not supplied'}</span><span><strong>Issue type</strong>{ticket.issueType?.replaceAll('_', ' ') ?? 'General support'}</span><span><strong>Reported from page</strong>{ticket.pageContext ?? 'Not captured'}</span></div><TicketAttachments ticket={ticket} /></section><section className="card card-pad"><div className="section-head"><div><span className="eyebrow">Audit trail</span><h2>Case timeline</h2></div></div><div className="timeline"><div><i /><span><strong>Ticket created</strong><small>{new Date(ticket.createdAt).toLocaleString()}</small></span></div>{(ticket.notes ?? []).map((entry) => <div key={`${entry.at}-${entry.body}`}><i /><span><strong>{entry.author} added a note</strong><p>{entry.body}</p><small>{new Date(entry.at).toLocaleString()}</small></span></div>)}</div></section></main><aside className="card card-pad case-actions"><span className="eyebrow">Case controls</span><h2>Update ticket</h2><div className="field"><label htmlFor="case-status">Status</label><select id="case-status" className="select" value={nextStatus} onChange={(event) => setNextStatus(event.target.value as Ticket['status'])}><option value="open">New</option><option value="in_progress">In progress</option><option value="on_hold">On hold</option><option value="resolved">Resolved</option><option value="closed">Closed</option></select></div><div className="field"><label htmlFor="case-note">Internal note</label><textarea id="case-note" className="textarea" rows={4} value={note} onChange={(event) => setNote(event.target.value)} placeholder="What changed or what should the next agent know?" /></div>{nextStatus === 'resolved' && <div className="field"><label htmlFor="case-root-cause">Root cause <span className="required">required</span></label><textarea id="case-root-cause" className="textarea" rows={4} value={rca} onChange={(event) => setRca(event.target.value)} placeholder="Record the verified cause and resolution." /></div>}<button className="button button-primary button-wide" disabled={saving || (nextStatus === 'resolved' && !rca.trim())} onClick={() => { setSaving(true); void updateTicket(ticket.id, nextStatus, note.trim() || undefined, rca.trim() || undefined).then(() => { setNote(''); setSaved(true); }).finally(() => setSaving(false)); }}><MessageSquarePlus size={17} /> Save case update</button></aside></div></div>;
}

function Verifications({ verifications, canAdminister, decide, compact = false }: { verifications: Verification[]; canAdminister: boolean; decide: (id: string, decision: VerificationStatus, reason: string) => Promise<void>; compact?: boolean }) {
  const [searchParams] = useSearchParams();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  // The console panel is the dealers waiting for a decision; the full queue starts from the address-bar filters.
  const [filters, setFilters] = useState<VerificationFilters>(() => compact ? PENDING_DEALER_FILTERS : verificationFiltersFromSearch(searchParams));
  const [reason, setReason] = useState('');
  const [decision, setDecision] = useState<VerificationStatus>('approved');
  const [saving, setSaving] = useState(false);
  const rows = useMemo(() => [...verifications]
    .sort((a, b) => Number(a.status !== 'pending') - Number(b.status !== 'pending'))
    .filter((item) => matchesVerificationFilters(item, filters))
    .filter((item) => `${item.ticketId} ${item.profileName} ${item.email ?? ''} ${item.businessName ?? ''} ${item.state}`.toLowerCase().includes(query.trim().toLowerCase()))
    .slice(0, compact ? 3 : undefined), [compact, filters, query, verifications]);
  const selected = verifications.find((item) => item.id === selectedId);
  const approvalBlocked = selected?.category === 'agent' && !canAdminister && decision === 'approved';
  function submit() { if (!selected || !reason.trim() || approvalBlocked) return; setSaving(true); void decide(selected.id, decision, reason.trim()).then(() => { setSelectedId(null); setReason(''); }).finally(() => setSaving(false)); }

  return <section className={compact ? 'card card-pad queue-card' : 'shell page-content support-list-page'}>
    {!compact && <div className="page-heading"><div><span className="eyebrow">Identity &amp; business review</span><h1>Verification queue</h1><p>Inspect the complete submission and evidence before recording an auditable decision.</p></div><span className="results-count">{rows.length} results</span></div>}
    {compact && <div className="section-head"><div><span className="eyebrow">Approval queue</span><h2>Pending dealer verifications</h2></div><Link to={SUPPORT_CARD_LINKS.pendingDealerVerifications}>View queue <ChevronRight size={14} /></Link></div>}
    {!compact && <div className="card card-pad support-filter-grid verification-filters"><label className="search-field"><Search size={16} /><input aria-label="Search verification cases" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, email, business, or case ID" /></label><div className="select-inline"><label htmlFor="verification-applicant">Applicant</label><Dropdown id="verification-applicant" ariaLabel="Filter verifications by applicant" align="left" value={filters.applicant} onChange={(value) => setFilters((current) => ({ ...current, applicant: value as VerificationFilters['applicant'] }))} options={VERIFICATION_APPLICANT_OPTIONS} /></div><div className="select-inline"><label htmlFor="verification-status">Status</label><Dropdown id="verification-status" ariaLabel="Filter verifications by status" align="right" value={filters.status} onChange={(value) => setFilters((current) => ({ ...current, status: value as VerificationFilters['status'] }))} options={VERIFICATION_STATUS_OPTIONS} /></div></div>}
    {compact ? <div className="support-compact-list">{rows.map((item) => <button type="button" className="support-compact-row" key={item.id} onClick={() => setSelectedId(item.id)}><div><span className="support-row-top"><strong>{item.profileName}</strong><StatusBadge status={item.status} /></span><small>{item.businessName ?? item.email ?? item.state} · {applicantLabel(item.category)} · {relativeTime(item.submittedAt)}</small></div><span className="support-review-action">Review</span><ChevronRight size={16} /></button>)}{rows.length === 0 && <p className="compact-empty">No dealer verifications are waiting.</p>}</div> : <div className="card support-data-card"><div className="table-wrap"><table className="data-table operations-table verification-table"><thead><tr><th>Case</th><th>Applicant</th><th>Contact</th><th>Type</th><th>Status</th><th><span className="sr-only">Action</span></th></tr></thead><tbody>{rows.map((item) => <tr key={item.id}><td><strong>{item.ticketId}</strong><small>{relativeTime(item.submittedAt)}</small></td><td><strong>{item.profileName}</strong><small>{item.businessName ?? item.state}</small></td><td><span>{item.email ?? 'Email unavailable'}</span><small>{item.phone ?? item.state}</small></td><td>{applicantLabel(item.category)}</td><td><StatusBadge status={item.status} /></td><td><button className="button button-secondary button-sm" onClick={() => setSelectedId(item.id)}>{item.status === 'pending' ? 'Review' : 'View decision'}</button></td></tr>)}</tbody></table></div>{rows.length === 0 && <EmptyState title="No verification cases match" description="Clear a filter or search by applicant, business, email, or case ID." />}</div>}
    {selected && <VerificationDetail selected={selected} decision={decision} setDecision={setDecision} reason={reason} setReason={setReason} saving={saving} approvalBlocked={approvalBlocked} onClose={() => setSelectedId(null)} onSubmit={submit} />}
  </section>;
}


function VerificationDetail({ selected, decision, setDecision, reason, setReason, saving, approvalBlocked, onClose, onSubmit }: { selected: Verification; decision: VerificationStatus; setDecision: (value: VerificationStatus) => void; reason: string; setReason: (value: string) => void; saving: boolean; approvalBlocked: boolean; onClose: () => void; onSubmit: () => void }) {
  return <div className="modal-backdrop" onMouseDown={onClose}><section className="modal-card verification-modal verification-detail-modal" role="dialog" aria-modal="true" aria-labelledby="verification-title" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" onClick={onClose} aria-label="Close verification details"><X /></button><header className="verification-detail-header"><div><span className="eyebrow">{selected.ticketId} · {applicantLabel(selected.category)} verification</span><h2 id="verification-title">{selected.profileName}</h2><p>Submitted {new Date(selected.submittedAt).toLocaleString()}</p></div><StatusBadge status={selected.status} /></header><div className="verification-detail-scroll"><VerificationSection title="Profile & contact" icon={<Mail size={16} />}><div className="verification-facts"><Fact label="Email" value={selected.email} /><Fact label="Phone" value={selected.phone} /><Fact label="Address" value={selected.address} /><Fact label="State" value={selected.state} /></div></VerificationSection><VerificationSection title={selected.category === 'dealer' ? 'Business details' : 'Access request'} icon={<Building2 size={16} />}>{selected.category === 'dealer' ? <div className="verification-facts"><Fact label="Dealership" value={selected.businessName} /><Fact label="Branch" value={selected.branchName} /><Fact label="Dealer license" value={selected.dealerLicense} /><div><span>Website</span><strong>{selected.website ? <a href={selected.website} target="_blank" rel="noreferrer">Open website <ExternalLink size={13} /></a> : 'Not supplied'}</strong></div><div className="fact-wide"><span>Supported brand IDs</span><strong>{selected.supportedBrands?.length ? selected.supportedBrands.join(', ') : 'Not supplied'}</strong></div></div> : <div className="verification-facts"><Fact label="Requested role" value="Support team member" /><Fact label="Account email" value={selected.email} /></div>}</VerificationSection><VerificationSection title="Evidence & consent" icon={<FileCheck2 size={16} />}><div className="evidence-list">{selected.documents?.length ? <VerificationDocuments verification={selected} /> : selected.proofDocuments?.length ? selected.proofDocuments.map((document) => <div key={document}><FileText size={16} /><span><strong>{document.split('/').at(-1)}</strong><small>Submitted evidence</small></span></div>) : <div className="evidence-empty"><AlertTriangle size={17} /><span><strong>No document files attached</strong><small>Verify the profile and submitted note before making a decision.</small></span></div>}<div><ShieldCheck size={16} /><span><strong>{selected.termsAccepted ? 'Terms accepted' : 'Terms acceptance not recorded'}</strong><small>{selected.termsVersion ? `Version ${selected.termsVersion}` : 'No version'}{selected.termsAcceptedAt ? ` · ${new Date(selected.termsAcceptedAt).toLocaleString()}` : ''}</small></span></div></div></VerificationSection><VerificationSection title="Approval history" icon={<Clock3 size={16} />}><div className="verification-history">{selected.history?.length ? selected.history.map((entry, index) => <div key={`${entry.at}-${index}`}><i /><span><strong>{entry.decision ? `${entry.decision.charAt(0).toUpperCase()}${entry.decision.slice(1)} decision` : 'Application note'}</strong><p>{entry.reason ?? entry.note ?? 'No note recorded.'}</p><small>{new Date(entry.at).toLocaleString()}{entry.actorId ? ` · Actor ${entry.actorId.slice(0, 8)}` : ''}</small></span></div>) : <p className="muted">No earlier review activity.</p>}{selected.decidedAt && <div><i /><span><strong>Decision finalized by {selected.decidedByName ?? 'support team'}</strong><p>{selected.decisionReason ?? 'No decision reason recorded.'}</p><small>{new Date(selected.decidedAt).toLocaleString()}</small></span></div>}</div></VerificationSection></div>{selected.status === 'pending' ? <footer className="verification-decision-panel"><div className="decision-tabs"><button className={decision === 'approved' ? 'active' : ''} onClick={() => setDecision('approved')}><UserRoundCheck size={16} /> Approve</button><button className={decision === 'denied' ? 'active' : ''} onClick={() => setDecision('denied')}><X size={16} /> Deny</button><button className={decision === 'rejected' ? 'active' : ''} onClick={() => setDecision('rejected')}><FileText size={16} /> Reject evidence</button></div><div className="field"><label htmlFor="verification-reason">Decision reason <span className="required">required</span></label><textarea id="verification-reason" className="textarea" rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Record the evidence checked and why this decision is appropriate." /></div>{approvalBlocked && <div className="inline-warning"><AlertTriangle size={16} /> A support administrator must approve a support account.</div>}<button className="button button-primary button-wide" disabled={saving || !reason.trim() || approvalBlocked} onClick={onSubmit}>Record {decision} decision</button></footer> : <div className="decision-record verification-final-decision"><StatusBadge status={selected.status} /><p>{selected.decisionReason ?? 'Decision recorded during the account review.'}</p></div>}</section></div>;
}

/** The applicant's signup documents. Each View asks for a fresh short-lived link and opens the file in a new tab. */
function VerificationDocuments({ verification }: { verification: Verification }) {
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');

  async function view(documentId: string) {
    // Open the tab inside the click so pop-up blockers allow it, then point it at the link once it arrives.
    const tab = window.open('', '_blank');
    setBusyId(documentId);
    setError('');
    try {
      const { url } = await client.verifications.documentLink(verification.id, documentId);
      if (tab) {
        tab.opener = null;
        tab.location.href = url;
      } else {
        window.location.assign(url);
      }
    } catch {
      tab?.close();
      setError('That document could not be opened. Please try again.');
    } finally {
      setBusyId('');
    }
  }

  return <>
    {(verification.documents ?? []).map((document) => <div key={document.id} className="evidence-document">
      <FileText size={16} />
      <span><strong>{document.label}</strong><small>{document.fileName} · {document.contentType === 'application/pdf' ? 'PDF' : 'File'} · {formatFileSize(document.sizeBytes)}</small></span>
      <button type="button" className="button button-secondary button-sm" onClick={() => void view(document.id)} disabled={busyId === document.id} aria-label={`View ${document.label}`}>{busyId === document.id ? 'Opening…' : 'View'} <ExternalLink size={13} /></button>
    </div>)}
    {error && <span className="field-error" role="alert">{error}</span>}
  </>;
}

function VerificationSection({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return <section className="verification-section"><h3>{icon}{title}</h3>{children}</section>;
}

function Fact({ label, value }: { label: string; value: string | null | undefined }) {
  return <div><span>{label}</span><strong>{value || 'Not supplied'}</strong></div>;
}


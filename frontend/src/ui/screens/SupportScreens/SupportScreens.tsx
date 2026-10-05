import {
  AlertTriangle, ArrowLeft, Building2, Check, ChevronRight, Clock3, ExternalLink,
  FileCheck2, FileText, Filter, Mail, MessageSquarePlus, Search, ShieldCheck,
  TicketCheck, UserRoundCheck, X,
} from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { relativeTime } from '@/helpers/dateTime';
import { client } from '@/services/platform/client';
import { useEffectiveSession } from '@/ui/navigations/previewSession';
import { EmptyState } from '@/ui/reusables/EmptyState/EmptyState';
import { PageLoading } from '@/ui/reusables/PageLoading/PageLoading';
import { StatusBadge } from '@/ui/reusables/StatusBadge/StatusBadge';
import { SupportMembers } from '@/ui/screens/SupportScreens/SupportMembers';
import type { Ticket, Verification, VerificationStatus } from '@/types/domain';

const applicantLabel = (category: Verification['category']) => category === 'agent' ? 'Support' : category === 'customer' ? 'Buyer' : 'Dealer';
const ticketAudience = (ticket: Ticket) => ticket.category === 'dealer' ? 'Dealer' : 'Buyer';

export default function SupportScreens() {
  const path = useLocation().pathname;
  const navigate = useNavigate();
  const { ticketId } = useParams();
  const session = useEffectiveSession();
  const canAdminister = session?.role === 'support-admin' || session?.role === 'admin';
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [verifications, setVerifications] = useState<Verification[]>([]);
  const [loaded, setLoaded] = useState(false);

  const refresh = () => Promise.all([
    client.support.queue().then(setTickets).catch(() => setTickets([])),
    client.verifications.list().then(setVerifications).catch(() => setVerifications([])),
  ]);
  useEffect(() => { void refresh().then(() => setLoaded(true)); }, []);

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
  if (ticketId) return <TicketDetail id={ticketId} />;
  if (path === '/support-members') return <SupportMembers />;
  if (path === '/verifications') return <Verifications />;
  if (path === '/tickets' || path === '/help-support') return <Tickets />;

  return <div className="shell page-content support-console">
    <div className="page-heading"><div><span className="eyebrow">Support operations</span><h1>Today’s decision desk</h1><p>Prioritize approval risk, SLA pressure, and people waiting for a clear next step.</p></div><span className="live-ops"><i /> Live queue · updated now</span></div>
    <div className="grid grid-4"><article className="card stat-card"><div className="stat-label">Open tickets <TicketCheck size={17} /></div><div className="stat-value">{tickets.filter((item) => !['resolved', 'closed'].includes(item.status)).length}</div><span className="stat-note">{tickets.filter((item) => ['high', 'urgent'].includes(item.priority)).length} high priority</span></article><article className="card stat-card"><div className="stat-label">Pending reviews <ShieldCheck size={17} /></div><div className="stat-value">{verifications.filter((item) => item.status === 'pending').length}</div><span className="muted">Review queue</span></article><article className="card stat-card"><div className="stat-label">SLA risk <AlertTriangle size={17} /></div><div className="stat-value">{tickets.filter((item) => item.priority === 'urgent' && !['resolved', 'closed'].includes(item.status)).length}</div><span className="sla-risk">Needs action today</span></article><article className="card stat-card"><div className="stat-label">Resolved today <Check size={17} /></div><div className="stat-value">{tickets.filter((item) => item.status === 'resolved').length}</div><span className="stat-note">Across the queue</span></article></div>
    <div className="grid grid-2 support-overview-grid"><Tickets compact /><Verifications compact /></div>
  </div>;

  function Tickets({ compact = false }: { compact?: boolean }) {
    const [status, setStatus] = useState('active');
    const [audience, setAudience] = useState('all');
    const [priority, setPriority] = useState('all');
    const [query, setQuery] = useState('');
    const rows = useMemo(() => tickets
      .filter((ticket) => status === 'all' || status === 'active' && !['resolved', 'closed'].includes(ticket.status) || ticket.status === status)
      .filter((ticket) => audience === 'all' || ticket.category === audience)
      .filter((ticket) => priority === 'all' || ticket.priority === priority)
      .filter((ticket) => `${ticket.publicId} ${ticket.callerName} ${ticket.callerEmail ?? ''} ${ticket.summary} ${ticket.description ?? ''} ${ticket.issueType ?? ''}`.toLowerCase().includes(query.trim().toLowerCase()))
      .slice(0, compact ? 3 : undefined), [audience, compact, priority, query, status]);

    return <section className={compact ? 'card card-pad queue-card' : 'shell page-content support-list-page'}>
      {!compact && <div className="page-heading"><div><span className="eyebrow">Support queue</span><h1>Tickets that need a person</h1><p>Find a buyer or dealer case, inspect its timeline, and record a verified resolution.</p></div><span className="results-count">{rows.length} results</span></div>}
      {compact && <div className="section-head"><div><span className="eyebrow">Priority queue</span><h2>Open cases</h2></div><Link to="/tickets">View queue <ChevronRight size={14} /></Link></div>}
      {!compact && <div className="card card-pad support-filter-grid"><label className="search-field"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search case ID, name, email, or issue" /></label><label className="select-inline"><Filter size={15} /><span>Applicant</span><select aria-label="Filter tickets by applicant" value={audience} onChange={(event) => setAudience(event.target.value)}><option value="all">Buyer &amp; dealer</option><option value="customer">Buyer</option><option value="dealer">Dealer</option></select></label><label className="select-inline"><span>Priority</span><select aria-label="Filter tickets by priority" value={priority} onChange={(event) => setPriority(event.target.value)}><option value="all">All priorities</option><option value="urgent">Urgent</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></label><label className="select-inline"><span>Status</span><select aria-label="Filter tickets by status" value={status} onChange={(event) => setStatus(event.target.value)}><option value="active">Active</option><option value="all">All statuses</option><option value="open">New</option><option value="in_progress">In progress</option><option value="on_hold">On hold</option><option value="resolved">Resolved</option><option value="closed">Closed</option></select></label></div>}
      {compact ? <div className="support-compact-list">{rows.map((ticket) => <Link to={`/tickets/${ticket.id}`} className="support-compact-row" key={ticket.id}><div><span className="support-row-top"><strong>{ticket.summary}</strong><StatusBadge status={ticket.status} /></span><small>{ticket.callerName} · {ticketAudience(ticket)} · {relativeTime(ticket.createdAt)}</small></div><span className={`priority priority-${ticket.priority}`}>{ticket.priority}</span><ChevronRight size={16} /></Link>)}{rows.length === 0 && <p className="compact-empty">No open cases need attention.</p>}</div> : <div className="card support-data-card"><div className="table-wrap"><table className="data-table operations-table ticket-table clickable-table"><colgroup><col className="ticket-col-caller" /><col className="ticket-col-issue" /><col className="ticket-col-priority" /><col className="ticket-col-status" /><col className="ticket-col-age" /><col className="ticket-col-action" /></colgroup><thead><tr><th>Case &amp; requester</th><th>Issue</th><th>Priority</th><th>Status</th><th>Age</th><th><span className="sr-only">Action</span></th></tr></thead><tbody>{rows.map((ticket) => <tr key={ticket.id} tabIndex={0} onClick={() => navigate(`/tickets/${ticket.id}`)} onKeyDown={(event) => { if (event.key === 'Enter') navigate(`/tickets/${ticket.id}`); }}><td><strong>{ticket.publicId}</strong><small>{ticket.callerName} · {ticketAudience(ticket)}</small>{ticket.callerEmail && <small>{ticket.callerEmail}</small>}</td><td><span className="issue-cell">{ticket.summary}</span><small>{ticket.issueType ? ticket.issueType.replaceAll('_', ' ') : 'Support request'}</small></td><td><span className={`priority priority-${ticket.priority}`}>{ticket.priority}</span></td><td><StatusBadge status={ticket.status} /></td><td>{relativeTime(ticket.createdAt)}</td><td><span className="button button-secondary button-sm">Open</span></td></tr>)}</tbody></table></div>{rows.length === 0 && <EmptyState title="No tickets match" description="Clear a filter or try another requester, case ID, or issue." />}</div>}
    </section>;
  }

  function TicketDetail({ id }: { id: string }) {
    const ticket = tickets.find((item) => item.id === id);
    const [nextStatus, setNextStatus] = useState<Ticket['status']>(ticket?.status ?? 'open');
    const [note, setNote] = useState('');
    const [rca, setRca] = useState(ticket?.rca ?? '');
    const [saved, setSaved] = useState(false);
    const [saving, setSaving] = useState(false);
    if (!ticket) return <div className="shell page-content"><EmptyState title="Ticket not found" description="The case may have moved or been removed." /></div>;
    return <div className="shell page-content"><Link className="button button-ghost" to="/tickets"><ArrowLeft size={17} /> Back to queue</Link><div className="page-heading case-heading"><div><span className="eyebrow">{ticket.publicId} · {ticketAudience(ticket)} support</span><h1>{ticket.summary}</h1><p>Opened by {ticket.callerName} · {relativeTime(ticket.createdAt)}</p></div><StatusBadge status={ticket.status} /></div>{saved && <div className="inline-success"><Check size={17} /> Case update saved.</div>}<div className="case-layout"><main className="grid"><section className="card card-pad"><span className="eyebrow">Request details</span><p className="case-description">{ticket.description ?? 'The requester reported this issue through the Deal&Drive support form and is waiting for a response.'}</p><div className="case-metadata"><span><strong>Requester</strong>{ticket.callerName}</span><span><strong>Email</strong>{ticket.callerEmail ?? 'Not supplied'}</span><span><strong>Issue type</strong>{ticket.issueType?.replaceAll('_', ' ') ?? 'General support'}</span><span><strong>Page context</strong>{ticket.pageContext ?? 'Not captured'}</span></div></section><section className="card card-pad"><div className="section-head"><div><span className="eyebrow">Audit trail</span><h2>Case timeline</h2></div></div><div className="timeline"><div><i /><span><strong>Ticket created</strong><small>{new Date(ticket.createdAt).toLocaleString()}</small></span></div>{(ticket.notes ?? []).map((entry) => <div key={`${entry.at}-${entry.body}`}><i /><span><strong>{entry.author} added a note</strong><p>{entry.body}</p><small>{new Date(entry.at).toLocaleString()}</small></span></div>)}</div></section></main><aside className="card card-pad case-actions"><span className="eyebrow">Case controls</span><h2>Update ticket</h2><div className="field"><label>Status</label><select className="select" value={nextStatus} onChange={(event) => setNextStatus(event.target.value as Ticket['status'])}><option value="open">New</option><option value="in_progress">In progress</option><option value="on_hold">On hold</option><option value="resolved">Resolved</option><option value="closed">Closed</option></select></div><div className="field"><label>Internal note</label><textarea className="textarea" rows={4} value={note} onChange={(event) => setNote(event.target.value)} placeholder="What changed or what should the next agent know?" /></div>{nextStatus === 'resolved' && <div className="field"><label>Root cause <span className="required">required</span></label><textarea className="textarea" rows={4} value={rca} onChange={(event) => setRca(event.target.value)} placeholder="Record the verified cause and resolution." /></div>}<button className="button button-primary button-wide" disabled={saving || (nextStatus === 'resolved' && !rca.trim())} onClick={() => { setSaving(true); void updateTicket(ticket.id, nextStatus, note.trim() || undefined, rca.trim() || undefined).then(() => { setNote(''); setSaved(true); }).finally(() => setSaving(false)); }}><MessageSquarePlus size={17} /> Save case update</button></aside></div></div>;
  }

  function Verifications({ compact = false }: { compact?: boolean }) {
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [query, setQuery] = useState('');
    const [category, setCategory] = useState('all');
    const [status, setStatus] = useState(compact ? 'pending' : 'all');
    const [reason, setReason] = useState('');
    const [decision, setDecision] = useState<VerificationStatus>('approved');
    const [saving, setSaving] = useState(false);
    const rows = useMemo(() => [...verifications]
      .sort((a, b) => Number(a.status !== 'pending') - Number(b.status !== 'pending'))
      .filter((item) => category === 'all' || item.category === category)
      .filter((item) => status === 'all' || item.status === status)
      .filter((item) => `${item.ticketId} ${item.profileName} ${item.email ?? ''} ${item.businessName ?? ''} ${item.state}`.toLowerCase().includes(query.trim().toLowerCase()))
      .slice(0, compact ? 3 : undefined), [category, compact, query, status]);
    const selected = verifications.find((item) => item.id === selectedId);
    const approvalBlocked = selected?.category === 'agent' && !canAdminister && decision === 'approved';
    function submit() { if (!selected || !reason.trim() || approvalBlocked) return; setSaving(true); void decide(selected.id, decision, reason.trim()).then(() => { setSelectedId(null); setReason(''); }).finally(() => setSaving(false)); }

    return <section className={compact ? 'card card-pad queue-card' : 'shell page-content support-list-page'}>
      {!compact && <div className="page-heading"><div><span className="eyebrow">Identity &amp; business review</span><h1>Verification queue</h1><p>Inspect the complete submission and evidence before recording an auditable decision.</p></div><span className="results-count">{rows.length} results</span></div>}
      {compact && <div className="section-head"><div><span className="eyebrow">Approval queue</span><h2>Pending reviews</h2></div><Link to="/verifications">View queue <ChevronRight size={14} /></Link></div>}
      {!compact && <div className="card card-pad support-filter-grid verification-filters"><label className="search-field"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, email, business, or case ID" /></label><label className="select-inline"><Filter size={15} /><span>Applicant</span><select value={category} onChange={(event) => setCategory(event.target.value)}><option value="all">Dealer &amp; support</option><option value="dealer">Dealer</option><option value="agent">Support</option></select></label><label className="select-inline"><span>Status</span><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All statuses</option><option value="pending">Pending</option><option value="approved">Approved</option><option value="denied">Denied</option><option value="rejected">Evidence rejected</option></select></label></div>}
      {compact ? <div className="support-compact-list">{rows.map((item) => <button type="button" className="support-compact-row" key={item.id} onClick={() => setSelectedId(item.id)}><div><span className="support-row-top"><strong>{item.profileName}</strong><StatusBadge status={item.status} /></span><small>{item.businessName ?? item.email ?? item.state} · {applicantLabel(item.category)} · {relativeTime(item.submittedAt)}</small></div><span className="support-review-action">Review</span><ChevronRight size={16} /></button>)}{rows.length === 0 && <p className="compact-empty">No verification reviews are waiting.</p>}</div> : <div className="card support-data-card"><div className="table-wrap"><table className="data-table operations-table verification-table"><thead><tr><th>Case</th><th>Applicant</th><th>Contact</th><th>Type</th><th>Status</th><th><span className="sr-only">Action</span></th></tr></thead><tbody>{rows.map((item) => <tr key={item.id}><td><strong>{item.ticketId}</strong><small>{relativeTime(item.submittedAt)}</small></td><td><strong>{item.profileName}</strong><small>{item.businessName ?? item.state}</small></td><td><span>{item.email ?? 'Email unavailable'}</span><small>{item.phone ?? item.state}</small></td><td>{applicantLabel(item.category)}</td><td><StatusBadge status={item.status} /></td><td><button className="button button-secondary button-sm" onClick={() => setSelectedId(item.id)}>{item.status === 'pending' ? 'Review' : 'View decision'}</button></td></tr>)}</tbody></table></div>{rows.length === 0 && <EmptyState title="No verification cases match" description="Clear a filter or search by applicant, business, email, or case ID." />}</div>}
      {selected && <VerificationDetail selected={selected} decision={decision} setDecision={setDecision} reason={reason} setReason={setReason} saving={saving} approvalBlocked={approvalBlocked} onClose={() => setSelectedId(null)} onSubmit={submit} />}
    </section>;
  }
}

function VerificationDetail({ selected, decision, setDecision, reason, setReason, saving, approvalBlocked, onClose, onSubmit }: { selected: Verification; decision: VerificationStatus; setDecision: (value: VerificationStatus) => void; reason: string; setReason: (value: string) => void; saving: boolean; approvalBlocked: boolean; onClose: () => void; onSubmit: () => void }) {
  return <div className="modal-backdrop" onMouseDown={onClose}><section className="modal-card verification-modal verification-detail-modal" role="dialog" aria-modal="true" aria-labelledby="verification-title" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" onClick={onClose} aria-label="Close verification details"><X /></button><header className="verification-detail-header"><div><span className="eyebrow">{selected.ticketId} · {applicantLabel(selected.category)} verification</span><h2 id="verification-title">{selected.profileName}</h2><p>Submitted {new Date(selected.submittedAt).toLocaleString()}</p></div><StatusBadge status={selected.status} /></header><div className="verification-detail-scroll"><VerificationSection title="Profile & contact" icon={<Mail size={16} />}><div className="verification-facts"><Fact label="Email" value={selected.email} /><Fact label="Phone" value={selected.phone} /><Fact label="Address" value={selected.address} /><Fact label="State" value={selected.state} /></div></VerificationSection><VerificationSection title={selected.category === 'dealer' ? 'Business details' : 'Access request'} icon={<Building2 size={16} />}>{selected.category === 'dealer' ? <div className="verification-facts"><Fact label="Dealership" value={selected.businessName} /><Fact label="Branch" value={selected.branchName} /><Fact label="Dealer license" value={selected.dealerLicense} /><div><span>Website</span><strong>{selected.website ? <a href={selected.website} target="_blank" rel="noreferrer">Open website <ExternalLink size={13} /></a> : 'Not supplied'}</strong></div><div className="fact-wide"><span>Supported brand IDs</span><strong>{selected.supportedBrands?.length ? selected.supportedBrands.join(', ') : 'Not supplied'}</strong></div></div> : <div className="verification-facts"><Fact label="Requested role" value="Support team member" /><Fact label="Account email" value={selected.email} /></div>}</VerificationSection><VerificationSection title="Evidence & consent" icon={<FileCheck2 size={16} />}><div className="evidence-list">{selected.proofDocuments?.length ? selected.proofDocuments.map((document) => <div key={document}><FileText size={16} /><span><strong>{document.split('/').at(-1)}</strong><small>Submitted evidence</small></span></div>) : <div className="evidence-empty"><AlertTriangle size={17} /><span><strong>No document files attached</strong><small>Verify the profile and submitted note before making a decision.</small></span></div>}<div><ShieldCheck size={16} /><span><strong>{selected.termsAccepted ? 'Terms accepted' : 'Terms acceptance not recorded'}</strong><small>{selected.termsVersion ? `Version ${selected.termsVersion}` : 'No version'}{selected.termsAcceptedAt ? ` · ${new Date(selected.termsAcceptedAt).toLocaleString()}` : ''}</small></span></div></div></VerificationSection><VerificationSection title="Approval history" icon={<Clock3 size={16} />}><div className="verification-history">{selected.history?.length ? selected.history.map((entry, index) => <div key={`${entry.at}-${index}`}><i /><span><strong>{entry.decision ? `${entry.decision.charAt(0).toUpperCase()}${entry.decision.slice(1)} decision` : 'Application note'}</strong><p>{entry.reason ?? entry.note ?? 'No note recorded.'}</p><small>{new Date(entry.at).toLocaleString()}{entry.actorId ? ` · Actor ${entry.actorId.slice(0, 8)}` : ''}</small></span></div>) : <p className="muted">No earlier review activity.</p>}{selected.decidedAt && <div><i /><span><strong>Decision finalized by {selected.decidedByName ?? 'support team'}</strong><p>{selected.decisionReason ?? 'No decision reason recorded.'}</p><small>{new Date(selected.decidedAt).toLocaleString()}</small></span></div>}</div></VerificationSection></div>{selected.status === 'pending' ? <footer className="verification-decision-panel"><div className="decision-tabs"><button className={decision === 'approved' ? 'active' : ''} onClick={() => setDecision('approved')}><UserRoundCheck size={16} /> Approve</button><button className={decision === 'denied' ? 'active' : ''} onClick={() => setDecision('denied')}><X size={16} /> Deny</button><button className={decision === 'rejected' ? 'active' : ''} onClick={() => setDecision('rejected')}><FileText size={16} /> Reject evidence</button></div><div className="field"><label>Decision reason <span className="required">required</span></label><textarea className="textarea" rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Record the evidence checked and why this decision is appropriate." /></div>{approvalBlocked && <div className="inline-warning"><AlertTriangle size={16} /> A support administrator must approve a support account.</div>}<button className="button button-primary button-wide" disabled={saving || !reason.trim() || approvalBlocked} onClick={onSubmit}>Record {decision} decision</button></footer> : <div className="decision-record verification-final-decision"><StatusBadge status={selected.status} /><p>{selected.decisionReason ?? 'Decision recorded during the account review.'}</p></div>}</section></div>;
}

function VerificationSection({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return <section className="verification-section"><h3>{icon}{title}</h3>{children}</section>;
}

function Fact({ label, value }: { label: string; value: string | null | undefined }) {
  return <div><span>{label}</span><strong>{value || 'Not supplied'}</strong></div>;
}

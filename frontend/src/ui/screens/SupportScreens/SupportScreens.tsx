import { AlertTriangle, ArrowLeft, Check, ChevronRight, FileText, Filter, MessageSquarePlus, Search, ShieldCheck, TicketCheck, UserRoundCheck, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { relativeTime } from '@/helpers/dateTime';
import { client } from '@/services/platform/client';
import { PageLoading } from '@/ui/reusables/PageLoading/PageLoading';
import { EmptyState } from '@/ui/reusables/EmptyState/EmptyState';
import { StatusBadge } from '@/ui/reusables/StatusBadge/StatusBadge';
import { SupportMembers } from '@/ui/screens/SupportScreens/SupportMembers';
import type { Ticket, Verification, VerificationStatus } from '@/types/domain';
import { useEffectiveSession } from '@/ui/navigations/previewSession';

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
  if (path === '/support-members') return <Members />;
  if (path === '/verifications') return <Verifications />;
  if (path === '/tickets' || path === '/help-support') return <Tickets />;
  return <div className="shell page-content support-console"><div className="page-heading"><div><span className="eyebrow">Support operations</span><h1>Today’s decision desk</h1><p>Prioritize approval risk, SLA pressure, and people waiting for a clear next step.</p></div><span className="live-ops"><i /> Live queue · updated now</span></div><div className="grid grid-4"><article className="card stat-card"><div className="stat-label">Open tickets <TicketCheck size={17} /></div><div className="stat-value">{tickets.filter((item) => !['resolved', 'closed'].includes(item.status)).length}</div><span className="stat-note">{tickets.filter((item) => ['high', 'urgent'].includes(item.priority)).length} high priority</span></article><article className="card stat-card"><div className="stat-label">Pending reviews <ShieldCheck size={17} /></div><div className="stat-value">{verifications.filter((item) => item.status === 'pending').length}</div><span className="muted">Review queue</span></article><article className="card stat-card"><div className="stat-label">SLA risk <AlertTriangle size={17} /></div><div className="stat-value">{tickets.filter((item) => item.priority === 'urgent' && !['resolved', 'closed'].includes(item.status)).length}</div><span className="sla-risk">Needs action today</span></article><article className="card stat-card"><div className="stat-label">Resolved today <Check size={17} /></div><div className="stat-value">{tickets.filter((item) => item.status === 'resolved').length}</div><span className="stat-note">Across the queue</span></article></div><div className="grid grid-2 support-overview-grid"><Tickets compact /><Verifications compact /></div></div>;

  function Tickets({ compact = false }: { compact?: boolean }) {
    const [status, setStatus] = useState('active');
    const [query, setQuery] = useState('');
    const rows = tickets.filter((ticket) => status === 'all' || status === 'active' && !['resolved', 'closed'].includes(ticket.status) || ticket.status === status).filter((ticket) => `${ticket.publicId} ${ticket.callerName} ${ticket.summary}`.toLowerCase().includes(query.toLowerCase())).slice(0, compact ? 3 : undefined);
    return <section className={compact ? 'card card-pad queue-card' : 'shell page-content'}>{!compact && <div className="page-heading"><div><span className="eyebrow">Support queue</span><h1>Tickets that need a person</h1><p>Open any case to inspect the timeline, add notes, and record a verified resolution.</p></div></div>}{compact && <div className="section-head"><div><span className="eyebrow">Priority queue</span><h2>Open cases</h2></div><Link to="/tickets">View queue <ChevronRight size={14} /></Link></div>}{!compact && <div className="card card-pad list-toolbar"><label className="search-field"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search ID, caller, or issue" /></label><label className="select-inline"><Filter size={15} /><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="active">Active tickets</option><option value="all">All statuses</option><option value="open">New</option><option value="in_progress">In progress</option><option value="on_hold">On hold</option><option value="resolved">Resolved</option></select></label></div>}{compact ? <div className="support-compact-list">{rows.map((ticket) => <Link to={`/tickets/${ticket.id}`} className="support-compact-row" key={ticket.id}><div><span className="support-row-top"><strong>{ticket.summary}</strong><StatusBadge status={ticket.status} /></span><small>{ticket.callerName} · {ticket.publicId} · {relativeTime(ticket.createdAt)}</small></div><span className={`priority priority-${ticket.priority}`}>{ticket.priority}</span><ChevronRight size={16} /></Link>)}{rows.length === 0 && <p className="compact-empty">No open cases need attention.</p>}</div> : <div className="card"><div className="table-wrap"><table className="data-table operations-table clickable-table"><thead><tr><th>ID / caller</th><th>Issue</th><th>Priority</th><th>Status</th><th>Age</th><th /></tr></thead><tbody>{rows.map((ticket) => <tr key={ticket.id} tabIndex={0} onClick={() => navigate(`/tickets/${ticket.id}`)} onKeyDown={(event) => { if (event.key === 'Enter') navigate(`/tickets/${ticket.id}`); }}><td><strong>{ticket.publicId}</strong><small>{ticket.callerName} · {ticket.category}</small></td><td><span className="issue-cell">{ticket.summary}</span></td><td><span className={`priority priority-${ticket.priority}`}>{ticket.priority}</span></td><td><StatusBadge status={ticket.status} /></td><td>{relativeTime(ticket.createdAt)}</td><td><span className="button button-secondary button-sm">Open case</span></td></tr>)}</tbody></table></div>{rows.length === 0 && <EmptyState title="No tickets match" description="Change the status or search filter." />}</div>}</section>;
  }

  function TicketDetail({ id }: { id: string }) {
    const ticket = tickets.find((item) => item.id === id);
    const [nextStatus, setNextStatus] = useState<Ticket['status']>(ticket?.status ?? 'open');
    const [note, setNote] = useState('');
    const [rca, setRca] = useState(ticket?.rca ?? '');
    const [saved, setSaved] = useState(false);
    const [saving, setSaving] = useState(false);
    if (!ticket) return <div className="shell page-content"><EmptyState title="Ticket not found" description="The case may have moved or been removed." /></div>;
    return <div className="shell page-content"><Link className="button button-ghost" to="/tickets"><ArrowLeft size={17} /> Back to queue</Link><div className="page-heading case-heading"><div><span className="eyebrow">{ticket.publicId} · {ticket.category} support</span><h1>{ticket.summary}</h1><p>Opened by {ticket.callerName} · {relativeTime(ticket.createdAt)}</p></div><StatusBadge status={ticket.status} /></div>{saved && <div className="inline-success"><Check size={17} /> Case update saved.</div>}<div className="case-layout"><main className="grid"><section className="card card-pad"><span className="eyebrow">Customer description</span><p className="case-description">{ticket.description ?? 'The customer reported this issue through the Deal&Drive support form and is waiting for a response.'}</p></section><section className="card card-pad"><div className="section-head"><div><span className="eyebrow">Audit trail</span><h2>Case timeline</h2></div></div><div className="timeline"><div><i /><span><strong>Ticket created</strong><small>{new Date(ticket.createdAt).toLocaleString()}</small></span></div>{(ticket.notes ?? []).map((entry) => <div key={`${entry.at}-${entry.body}`}><i /><span><strong>{entry.author} added a note</strong><p>{entry.body}</p><small>{new Date(entry.at).toLocaleString()}</small></span></div>)}</div></section></main><aside className="card card-pad case-actions"><span className="eyebrow">Case controls</span><h2>Update ticket</h2><div className="field"><label>Status</label><select className="select" value={nextStatus} onChange={(event) => setNextStatus(event.target.value as Ticket['status'])}><option value="open">New</option><option value="in_progress">In progress</option><option value="on_hold">On hold</option><option value="resolved">Resolved</option><option value="closed">Closed</option></select></div><div className="field"><label>Internal note</label><textarea className="textarea" rows={4} value={note} onChange={(event) => setNote(event.target.value)} placeholder="What changed or what should the next agent know?" /></div>{nextStatus === 'resolved' && <div className="field"><label>Root cause <span className="required">required</span></label><textarea className="textarea" rows={4} value={rca} onChange={(event) => setRca(event.target.value)} placeholder="Record the verified cause and resolution." /></div>}<button className="button button-primary button-wide" disabled={saving || (nextStatus === 'resolved' && !rca.trim())} onClick={() => { setSaving(true); void updateTicket(ticket.id, nextStatus, note.trim() || undefined, rca.trim() || undefined).then(() => { setNote(''); setSaved(true); }).finally(() => setSaving(false)); }}><MessageSquarePlus size={17} /> Save case update</button></aside></div></div>;
  }

  function Verifications({ compact = false }: { compact?: boolean }) {
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [reason, setReason] = useState('');
    const [decision, setDecision] = useState<VerificationStatus>('approved');
    const [saving, setSaving] = useState(false);
    const pendingFirst = [...verifications].sort((a, b) => Number(a.status !== 'pending') - Number(b.status !== 'pending'));
    const rows = compact ? pendingFirst.filter((item) => item.status === 'pending').slice(0, 3) : pendingFirst;
    const selected = verifications.find((item) => item.id === selectedId);
    const approvalBlocked = selected?.category === 'agent' && !canAdminister && decision === 'approved';
    function submit() { if (!selected || !reason.trim() || approvalBlocked) return; setSaving(true); void decide(selected.id, decision, reason.trim()).then(() => { setSelectedId(null); setReason(''); }).finally(() => setSaving(false)); }
    return <section className={compact ? 'card card-pad queue-card' : 'shell page-content'}>{!compact && <div className="page-heading"><div><span className="eyebrow">Identity &amp; business review</span><h1>Verification queue</h1><p>Inspect evidence, record a reason, and make a decision that remains auditable.</p></div></div>}{compact && <div className="section-head"><div><span className="eyebrow">Approval queue</span><h2>Pending reviews</h2></div><Link to="/verifications">View queue <ChevronRight size={14} /></Link></div>}{compact ? <div className="support-compact-list">{rows.map((item) => <button type="button" className="support-compact-row" key={item.id} onClick={() => setSelectedId(item.id)}><div><span className="support-row-top"><strong>{item.profileName}</strong><StatusBadge status={item.status} /></span><small>{item.businessName ?? item.state} · {item.category} · {relativeTime(item.submittedAt)}</small></div><span className="support-review-action">Review</span><ChevronRight size={16} /></button>)}{rows.length === 0 && <p className="compact-empty">No verification reviews are waiting.</p>}</div> : <div className="card"><div className="table-wrap"><table className="data-table operations-table"><thead><tr><th>Case</th><th>Applicant</th><th>Category</th><th>Status</th><th /></tr></thead><tbody>{rows.map((item) => <tr key={item.id}><td><strong>{item.ticketId}</strong><small>{relativeTime(item.submittedAt)}</small></td><td>{item.profileName}<small>{item.businessName ?? item.state}</small></td><td>{item.category}</td><td><StatusBadge status={item.status} /></td><td><button className="button button-secondary button-sm" onClick={() => setSelectedId(item.id)}>{item.status === 'pending' ? 'Review' : 'View decision'}</button></td></tr>)}</tbody></table></div></div>}{selected && <div className="modal-backdrop" onMouseDown={() => setSelectedId(null)}><section className="modal-card verification-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" onClick={() => setSelectedId(null)}><X /></button><span className="eyebrow">{selected.ticketId} · {selected.category} verification</span><h2>{selected.profileName}</h2><div className="verification-facts"><div><span>Business</span><strong>{selected.businessName ?? 'Internal team account'}</strong></div><div><span>State</span><strong>{selected.state}</strong></div></div>{selected.status === 'pending' ? <><div className="decision-tabs"><button className={decision === 'approved' ? 'active' : ''} onClick={() => setDecision('approved')}><UserRoundCheck size={16} /> Approve</button><button className={decision === 'denied' ? 'active' : ''} onClick={() => setDecision('denied')}><X size={16} /> Deny</button><button className={decision === 'rejected' ? 'active' : ''} onClick={() => setDecision('rejected')}><FileText size={16} /> Reject evidence</button></div><div className="field"><label>Decision reason <span className="required">required</span></label><textarea className="textarea" rows={4} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Record the evidence checked and why this decision is appropriate." /></div>{approvalBlocked && <div className="inline-warning"><AlertTriangle size={16} /> A support administrator must approve a team account.</div>}<button className="button button-primary button-wide" disabled={saving || !reason.trim() || approvalBlocked} onClick={submit}>Record {decision} decision</button></> : <div className="decision-record"><StatusBadge status={selected.status} /><p>{selected.decisionReason ?? 'Decision recorded during the initial account review.'}</p></div>}</section></div>}</section>;
  }

  function Members() {
    return <SupportMembers />;
  }
}

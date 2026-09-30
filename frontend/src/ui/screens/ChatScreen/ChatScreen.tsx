import { ArrowUp, CheckCheck, LockKeyhole, MessageCircle, Search, ShieldCheck, UserCheck, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { relativeTime } from '@/helpers/dateTime';
import { useDemoStore } from '@/services/platform/demoStore';
import { EmptyState } from '@/ui/reusables/EmptyState/EmptyState';
import { StatusBadge } from '@/ui/reusables/StatusBadge/StatusBadge';

export default function ChatScreen() {
  const { quoteId } = useParams();
  const navigate = useNavigate();
  const session = useDemoStore((state) => state.session);
  const quotes = useDemoStore((state) => state.quotes);
  const requests = useDemoStore((state) => state.requests);
  const messages = useDemoStore((state) => state.messages);
  const sendMessage = useDemoStore((state) => state.sendMessage);
  const acceptChatRequest = useDemoStore((state) => state.acceptChatRequest);
  const declineChatRequest = useDemoStore((state) => state.declineChatRequest);
  const [search, setSearch] = useState('');
  const [input, setInput] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  const available = quotes.filter((quote) => {
    if (!session || (!quote.contactAvailable && quote.chatRequestStatus !== 'pending')) return false;
    const request = requests.find((item) => item.id === quote.requestId);
    return session.role === 'buyer' ? request?.buyerId === session.id : quote.dealerId === session.id;
  });
  const [activeId, setActiveId] = useState(quoteId ?? available[0]?.id ?? '');
  useEffect(() => { if (quoteId) setActiveId(quoteId); }, [quoteId]);
  useEffect(() => { if (!activeId && available[0]) setActiveId(available[0].id); }, [activeId, available]);

  const filtered = available.filter((quote) => {
    const request = requests.find((item) => item.id === quote.requestId);
    return `${request?.brand} ${request?.model} ${quote.dealerName}`.toLowerCase().includes(search.toLowerCase());
  });
  const quote = available.find((item) => item.id === activeId);
  const request = requests.find((item) => item.id === quote?.requestId);
  const thread = useMemo(() => messages.filter((message) => message.quoteId === activeId), [activeId, messages]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, [thread]);

  function chooseConversation(id: string) {
    setActiveId(id);
    navigate(`/chat/${id}`, { replace: true });
  }

  if (!quote && available.length === 0) return <div className="shell page-content"><div className="page-heading"><div><span className="eyebrow">Messages</span><h1>Buyer–dealer conversations</h1></div></div><div className="card"><EmptyState title="No open conversations" description="A conversation appears after an offer is accepted or a dealer approves a negotiation request." /></div></div>;

  const isDealer = session?.role === 'dealer';
  return <div className="shell page-content chat-page">
    <div className="page-heading chat-page-heading"><div><span className="eyebrow">Secure deal messaging</span><h1>Conversations</h1><p>Every conversation stays attached to one quote, so price and decisions remain clear.</p></div><div className="secure-presence"><ShieldCheck size={17} /><span><strong>Private &amp; quote-scoped</strong><small>Contact gate enforced</small></span></div></div>
    <section className="card chat-layout chat-layout-modern">
      <aside className="chat-list"><div className="chat-list-head"><span><strong>Inbox</strong><small>{available.length} conversations</small></span><label className="chat-search"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search conversations" /></label></div>{filtered.map((item) => { const itemRequest = requests.find((entry) => entry.id === item.requestId); const last = messages.filter((message) => message.quoteId === item.id).at(-1); return <button className={`chat-item ${item.id === activeId ? 'active' : ''}`} key={item.id} onClick={() => chooseConversation(item.id)}><span className="chat-item-copy"><span><strong>{itemRequest?.brand} {itemRequest?.model}</strong><small>{last ? relativeTime(last.createdAt) : 'New'}</small></span><small>{isDealer ? `${itemRequest?.area} buyer` : item.dealerName}</small><p>{last?.body ?? (item.chatRequestStatus === 'pending' ? isDealer ? 'Buyer asked to negotiate' : 'Waiting for dealer response' : 'Conversation opened')}</p></span>{item.chatRequestStatus === 'pending' && <i className="unread-dot" />}</button>; })}</aside>
      <main className="chat-thread">{quote && <><header className="chat-thread-head"><span className="chat-thread-title"><strong>{request?.brand} {request?.model} · {isDealer ? 'Buyer' : quote.dealerName}</strong><small><i /> {quote.contactAvailable ? 'Conversation open' : 'Awaiting dealer approval'} · Quote attached</small></span><Link className="button button-secondary button-sm" to={`/quotes/${quote.id}`}>View offer</Link></header>
        {quote.contactAvailable ? <><div className="chat-scroll" aria-live="polite"><div className="chat-context"><MessageCircle size={18} /><span><strong>Conversation linked to {formatVehicle(request?.brand, request?.model)}.</strong><small>Offer changes remain visible in the quote history.</small></span></div>{thread.map((message) => <div key={message.id} className={`chat-message-row ${message.senderId === session?.id ? 'mine' : ''}`}><div className="chat-message"><strong>{message.senderName}</strong><p>{message.body}</p><small>{relativeTime(message.createdAt)} {message.senderId === session?.id && <CheckCheck size={13} />}</small></div></div>)}<div ref={endRef} /></div><form className="chat-composer modern-composer" onSubmit={(event) => { event.preventDefault(); if (input.trim()) { sendMessage(quote.id, input.trim()); setInput(''); } }}><input className="input" value={input} onChange={(event) => setInput(event.target.value)} placeholder="Write a message about this offer" aria-label="Message" /><button className="button button-primary" disabled={!input.trim()} aria-label="Send message"><ArrowUp size={18} /></button></form></>
          : <div className="chat-waiting"><div className="empty-icon"><LockKeyhole /></div><h3>{isDealer ? 'Buyer requested a negotiation' : 'Negotiation request sent'}</h3><p>{isDealer ? 'Review the buyer’s opening note. Contact details and messaging open only after you accept.' : 'The dealer can read your opening note. Contact and messages unlock only if they accept.'}</p><div className="opening-note"><span>{isDealer ? 'Buyer’s opening note' : 'Your opening note'}</span><p>“{quote.chatRequestMessage ?? 'I would like to discuss this offer before deciding.'}”</p></div>{isDealer ? <div className="chat-request-actions"><button className="button button-primary" onClick={() => acceptChatRequest(quote.id)}><UserCheck size={17} /> Accept &amp; open chat</button><button className="button button-secondary" onClick={() => { const reason = window.prompt('Brief reason shown to the buyer'); if (reason?.trim()) declineChatRequest(quote.id, reason.trim()); }}><X size={17} /> Decline</button></div> : <StatusBadge status="pending" />}</div>}
      </>}</main>
    </section>
  </div>;
}

function formatVehicle(brand?: string, model?: string) {
  return [brand, model].filter(Boolean).join(' ') || 'this vehicle';
}

export function ChatRequestsScreen() {
  const session = useDemoStore((state) => state.session);
  const quotes = useDemoStore((state) => state.quotes.filter((quote) => quote.chatRequestStatus === 'pending'));
  const requests = useDemoStore((state) => state.requests);
  const accept = useDemoStore((state) => state.acceptChatRequest);
  const decline = useDemoStore((state) => state.declineChatRequest);
  const [filter, setFilter] = useState('all');
  const dealerQuotes = quotes.filter((quote) => quote.dealerId === session?.id);
  const visible = dealerQuotes.filter((quote) => filter === 'all' || requests.find((item) => item.id === quote.requestId)?.brand === filter);
  const brands = [...new Set(dealerQuotes.map((quote) => requests.find((item) => item.id === quote.requestId)?.brand).filter(Boolean))];
  return <div className="shell page-content"><div className="page-heading"><div><span className="eyebrow">Dealer negotiation inbox</span><h1>Buyers waiting for a response</h1><p>Review the request and opening note. Accepting reveals contact and creates the shared conversation.</p></div><Link className="button button-secondary" to="/chat"><MessageCircle size={17} /> Open conversations</Link></div><div className="list-toolbar card card-pad"><div className="filter-pills"><button className={`filter-pill ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>All pending</button>{brands.map((brand) => <button key={brand} className={`filter-pill ${filter === brand ? 'active' : ''}`} onClick={() => setFilter(brand!)}>{brand}</button>)}</div></div><div className="grid grid-2 chat-request-grid">{visible.map((quote) => { const request = requests.find((item) => item.id === quote.requestId); return <article className="card card-pad chat-request-card" key={quote.id}><div className="chat-request-head"><span><span className="eyebrow">{request?.area} · approx. {Math.max(4, Math.round(request?.radiusMiles ?? 12) / 2)} mi away</span><h2>{request?.brand} {request?.model}</h2><small>{request?.yearMin}–{request?.yearMax} · {request?.bodyType}</small></span><StatusBadge status="pending" /></div><div className="opening-note"><span>Buyer’s opening note</span><p>“{quote.chatRequestMessage ?? 'I would like to discuss equipment and delivery timing before I decide.'}”</p></div><div className="request-tags">{request?.mustHaves.slice(0, 3).map((item) => <span className="status status-draft" key={item}>{item}</span>)}</div><div className="chat-request-actions"><button className="button button-primary" onClick={() => accept(quote.id)}><UserCheck size={17} /> Accept &amp; open chat</button><button className="button button-secondary" onClick={() => { const reason = window.prompt('Brief reason shown to the buyer'); if (reason?.trim()) decline(quote.id, reason.trim()); }}><X size={17} /> Decline</button></div></article>; })}{visible.length === 0 && <div className="card" style={{ gridColumn: '1/-1' }}><EmptyState title="No buyers are waiting" description="New negotiation requests for your dealership will appear here." /></div>}</div></div>;
}

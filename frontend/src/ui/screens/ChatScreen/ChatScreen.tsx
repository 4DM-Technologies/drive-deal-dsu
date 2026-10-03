import { ArrowUp, CheckCheck, LockKeyhole, MessageCircle, Search, ShieldCheck, UserCheck, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { relativeTime } from '@/helpers/dateTime';
import { client } from '@/services/platform/client';
import { useDemoStore } from '@/services/platform/demoStore';
import { PageLoading } from '@/ui/reusables/PageLoading/PageLoading';
import { EmptyState } from '@/ui/reusables/EmptyState/EmptyState';
import { StatusBadge } from '@/ui/reusables/StatusBadge/StatusBadge';
import type { BuyerRequest, ChatMessage, Quote } from '@/types/domain';

export default function ChatScreen() {
  const { quoteId } = useParams();
  const navigate = useNavigate();
  const session = useDemoStore((state) => state.session);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [requestMap, setRequestMap] = useState<Record<string, BuyerRequest>>({});
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [search, setSearch] = useState('');
  const [input, setInput] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void client.quotes.list().then(async (rows) => {
      const available = rows.filter((quote) => quote.contactAvailable || quote.chatRequestStatus === 'pending');
      setQuotes(available);
      const ids = [...new Set(available.map((row) => row.requestId))];
      const lookup = session?.role === 'buyer' ? client.requests.get : client.feed.get;
      const entries = await Promise.all(ids.map(async (requestId) => { try { return [requestId, await lookup(requestId)] as const; } catch { return null; } }));
      setRequestMap(Object.fromEntries(entries.filter((entry): entry is readonly [string, BuyerRequest] => entry !== null)));
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, [session?.role]);

  const available = quotes;
  const [activeId, setActiveId] = useState(quoteId ?? '');
  const effectiveId = quoteId || activeId || available[0]?.id || '';

  const quote = available.find((item) => item.id === effectiveId);
  const request = quote ? requestMap[quote.requestId] : undefined;

  useEffect(() => {
    if (!quote?.contactAvailable) return;
    void client.chats.list(quote.id).then(setMessages).catch(() => setMessages([]));
    void client.chats.markRead(quote.id).catch(() => {});
  }, [quote?.id, quote?.contactAvailable]);

  const filtered = available.filter((item) => { const itemRequest = requestMap[item.requestId]; return `${itemRequest?.brand} ${itemRequest?.model} ${item.dealerName}`.toLowerCase().includes(search.toLowerCase()); });
  const thread = useMemo(() => quote?.contactAvailable ? messages : [], [messages, quote?.contactAvailable]);
  const scrolledFor = useRef('');
  useEffect(() => {
    const switched = scrolledFor.current !== effectiveId;
    scrolledFor.current = effectiveId;
    endRef.current?.scrollIntoView({ behavior: switched ? 'auto' : 'smooth', block: 'nearest' });
  }, [effectiveId, thread]);

  function chooseConversation(id: string) {
    setActiveId(id);
    navigate(`/chat/${id}`, { replace: true });
  }

  async function send() {
    if (!quote || !input.trim()) return;
    const body = input.trim();
    setInput('');
    const message = await client.chats.send(quote.id, body);
    setMessages((items) => [...items, message]);
  }

  async function acceptRequest(id: string) {
    await client.chats.acceptRequest(id);
    setQuotes((items) => items.map((item) => item.id === id ? { ...item, chatRequestStatus: 'accepted', contactAvailable: true } : item));
  }

  async function declineRequest(id: string, reason: string) {
    await client.chats.declineRequest(id, reason);
    setQuotes((items) => items.filter((item) => item.id !== id));
  }

  if (!loaded) return <PageLoading label="Opening your conversations" />;
  if (!quote && available.length === 0) return <div className="shell page-content"><div className="page-heading"><div><span className="eyebrow">Messages</span><h1>Buyer–dealer conversations</h1></div></div><div className="card"><EmptyState title="No open conversations" description="A conversation appears after an offer is accepted or a dealer approves a negotiation request." /></div></div>;

  const isDealer = session?.role === 'dealer';
  return <div className="shell page-content chat-page">
    <section className="card chat-layout chat-layout-modern" aria-label="Conversations">
      <aside className="chat-list"><div className="chat-list-head"><span><strong>Messages</strong><small>{available.length} conversations</small></span><label className="chat-search"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search conversations" /></label></div>{filtered.map((item) => { const itemRequest = requestMap[item.requestId]; return <button className={`chat-item ${item.id === effectiveId ? 'active' : ''}`} key={item.id} onClick={() => chooseConversation(item.id)}><span className="chat-item-copy"><span><strong>{itemRequest?.brand} {itemRequest?.model}</strong></span><small>{isDealer ? `${itemRequest?.area ?? ''} buyer` : item.dealerName}</small><p>{item.chatRequestStatus === 'pending' ? isDealer ? 'Buyer asked to negotiate' : 'Waiting for dealer response' : 'Conversation opened'}</p></span>{item.chatRequestStatus === 'pending' && <i className="unread-dot" />}</button>; })}<p className="chat-list-note"><ShieldCheck size={15} /><span>Every conversation stays attached to one quote, so price and decisions remain clear.</span></p></aside>
      <main className="chat-thread">{quote && <><header className="chat-thread-head"><span className="chat-thread-title"><strong>{request?.brand} {request?.model} · {isDealer ? 'Buyer' : quote.dealerName}</strong><small><i /> {quote.contactAvailable ? 'Conversation open' : 'Awaiting dealer approval'} · Quote attached</small></span><Link className="button button-secondary button-sm" to={`/quotes/${quote.id}`}>View offer</Link></header>
        {quote.contactAvailable ? <><div className="chat-scroll" aria-live="polite"><div className="chat-context"><MessageCircle size={18} /><span><strong>Conversation linked to {formatVehicle(request?.brand, request?.model)}.</strong><small>Offer changes remain visible in the quote history.</small></span></div>{thread.map((message) => <div key={message.id} className={`chat-message-row ${message.senderId === session?.id ? 'mine' : ''}`}><div className="chat-message"><strong>{message.senderName}</strong><p>{message.body}</p><small>{relativeTime(message.createdAt)} {message.senderId === session?.id && <CheckCheck size={13} />}</small></div></div>)}<div ref={endRef} /></div><form className="chat-composer modern-composer" onSubmit={(event) => { event.preventDefault(); void send(); }}><input className="input" value={input} onChange={(event) => setInput(event.target.value)} placeholder="Write a message about this offer" aria-label="Message" /><button className="button button-primary" disabled={!input.trim()} aria-label="Send message"><ArrowUp size={18} /></button></form></>
          : <div className="chat-waiting"><div className="empty-icon"><LockKeyhole /></div><h3>{isDealer ? 'Buyer requested a negotiation' : 'Negotiation request sent'}</h3><p>{isDealer ? 'Review the buyer’s opening note. Contact details and messaging open only after you accept.' : 'The dealer can read your opening note. Contact and messages unlock only if they accept.'}</p><div className="opening-note"><span>{isDealer ? 'Buyer’s opening note' : 'Your opening note'}</span><p>“{quote.chatRequestMessage ?? 'I would like to discuss this offer before deciding.'}”</p></div>{isDealer ? <div className="chat-request-actions"><button className="button button-primary" onClick={() => void acceptRequest(quote.id)}><UserCheck size={17} /> Accept &amp; open chat</button><button className="button button-secondary" onClick={() => { const reason = window.prompt('Brief reason shown to the buyer'); if (reason?.trim()) void declineRequest(quote.id, reason.trim()); }}><X size={17} /> Decline</button></div> : <StatusBadge status="pending" />}</div>}
        {!quote.contactAvailable && <form className="chat-composer modern-composer" onSubmit={(event) => event.preventDefault()}><input className="input" disabled placeholder={isDealer ? 'Accept the request to start messaging' : 'Messaging unlocks when the dealer accepts'} aria-label="Message (locked)" /><button className="button button-primary" disabled aria-label="Send message"><ArrowUp size={18} /></button></form>}
      </>}</main>
    </section>
  </div>;
}

function formatVehicle(brand?: string, model?: string) {
  return [brand, model].filter(Boolean).join(' ') || 'this vehicle';
}

export function ChatRequestsScreen() {
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [requestMap, setRequestMap] = useState<Record<string, BuyerRequest>>({});
  const [filter, setFilter] = useState('all');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void client.chats.listRequests().then(async (rows) => {
      setQuotes(rows);
      const ids = [...new Set(rows.map((row) => row.requestId))];
      const entries = await Promise.all(ids.map(async (requestId) => { try { return [requestId, await client.feed.get(requestId)] as const; } catch { return null; } }));
      setRequestMap(Object.fromEntries(entries.filter((entry): entry is readonly [string, BuyerRequest] => entry !== null)));
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, []);

  async function accept(id: string) {
    await client.chats.acceptRequest(id);
    setQuotes((items) => items.filter((item) => item.id !== id));
  }

  async function decline(id: string, reason: string) {
    await client.chats.declineRequest(id, reason);
    setQuotes((items) => items.filter((item) => item.id !== id));
  }

  const visible = quotes.filter((quote) => filter === 'all' || requestMap[quote.requestId]?.brand === filter);
  const brands = [...new Set(quotes.map((quote) => requestMap[quote.requestId]?.brand).filter(Boolean))];
  if (!loaded) return null;
  if (!loaded) return <PageLoading label="Checking negotiation requests" />;
  return <div className="shell page-content"><div className="page-heading"><div><span className="eyebrow">Dealer negotiation inbox</span><h1>Buyers waiting for a response</h1><p>Review the request and opening note. Accepting reveals contact and creates the shared conversation.</p></div><Link className="button button-secondary" to="/chat"><MessageCircle size={17} /> Open conversations</Link></div><div className="list-toolbar card card-pad"><div className="filter-pills"><button className={`filter-pill ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>All pending</button>{brands.map((brand) => <button key={brand} className={`filter-pill ${filter === brand ? 'active' : ''}`} onClick={() => setFilter(brand!)}>{brand}</button>)}</div></div><div className="grid grid-2 chat-request-grid">{visible.map((quote) => { const request = requestMap[quote.requestId]; return <article className="card card-pad chat-request-card" key={quote.id}><div className="chat-request-head"><span><span className="eyebrow">{request?.area}</span><h2>{request?.brand} {request?.model}</h2><small>{request?.yearMin}–{request?.yearMax} · {request?.bodyType}</small></span><StatusBadge status="pending" /></div><div className="opening-note"><span>Buyer’s opening note</span><p>“{quote.chatRequestMessage ?? 'I would like to discuss equipment and delivery timing before I decide.'}”</p></div><div className="request-tags">{request?.mustHaves.slice(0, 3).map((item) => <span className="status status-draft" key={item}>{item}</span>)}</div><div className="chat-request-actions"><button className="button button-primary" onClick={() => void accept(quote.id)}><UserCheck size={17} /> Accept &amp; open chat</button><button className="button button-secondary" onClick={() => { const reason = window.prompt('Brief reason shown to the buyer'); if (reason?.trim()) void decline(quote.id, reason.trim()); }}><X size={17} /> Decline</button></div></article>; })}{visible.length === 0 && <div className="card" style={{ gridColumn: '1/-1' }}><EmptyState title="No buyers are waiting" description="New negotiation requests for your dealership will appear here." /></div>}</div></div>;
}

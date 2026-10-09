import { ArrowLeft, ArrowUp, CheckCheck, LockKeyhole, MessageCircle, Phone, Search, ShieldCheck, UserCheck, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { relativeTime } from '@/helpers/dateTime';
import { CHAT_GUIDELINES_NOTICE, violatesChatGuidelines } from '@/helpers/communityGuidelines';
import { client } from '@/services/platform/client';
import { useDemoStore } from '@/services/platform/demoStore';
import { ChatMessageMenu } from '@/ui/reusables/ChatMessageMenu/ChatMessageMenu';
import { PageLoading } from '@/ui/reusables/PageLoading/PageLoading';
import { EmptyState } from '@/ui/reusables/EmptyState/EmptyState';
import { StatusBadge } from '@/ui/reusables/StatusBadge/StatusBadge';
import type { BuyerRequest, ChatMessage, Quote } from '@/types/domain';

/** Grows the composer up to roughly 5 lines before it starts scrolling instead of pushing the thread up. */
const COMPOSER_MAX_HEIGHT = 120;

export default function ChatScreen() {
  const { quoteId } = useParams();
  const navigate = useNavigate();
  const session = useDemoStore((state) => state.session);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [requestMap, setRequestMap] = useState<Record<string, BuyerRequest>>({});
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatActivityByQuoteId, setChatActivityByQuoteId] = useState<Record<string, ChatMessage[]>>({});
  const [isNarrowViewport, setIsNarrowViewport] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 720px)').matches);
  const [loaded, setLoaded] = useState(false);
  const [search, setSearch] = useState('');
  const [input, setInput] = useState('');
  const [messageError, setMessageError] = useState('');
  const [editingMessageId, setEditingMessageId] = useState('');
  const [mobileThreadView, setMobileThreadView] = useState(() => ({ quoteId, open: Boolean(quoteId) }));
  if (mobileThreadView.quoteId !== quoteId) setMobileThreadView({ quoteId, open: Boolean(quoteId) });
  const mobileThreadOpen = mobileThreadView.open;
  const [activeMessageId, setActiveMessageId] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 720px)');
    const update = () => setIsNarrowViewport(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    void client.quotes.list().then(async (rows) => {
      const available = rows.filter((quote) => quote.contactAvailable || quote.chatRequestStatus === 'pending');
      setQuotes(available);
      const ids = [...new Set(available.map((row) => row.requestId))];
      const lookup = session?.role === 'buyer' ? client.requests.get : client.feed.get;
      const [entries, activityEntries] = await Promise.all([
        Promise.all(ids.map(async (requestId) => { try { return [requestId, await lookup(requestId)] as const; } catch { return null; } })),
        Promise.all(available.filter((row) => row.contactAvailable).map(async (row) => {
          try { return [row.id, await client.chats.list(row.id)] as const; } catch { return [row.id, []] as const; }
        })),
      ]);
      setRequestMap(Object.fromEntries(entries.filter((entry): entry is readonly [string, BuyerRequest] => entry !== null)));
      setChatActivityByQuoteId(Object.fromEntries(activityEntries));
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, [session?.role]);

  const available = quotes;
  const [activeId, setActiveId] = useState(quoteId ?? '');
  const effectiveId = quoteId || activeId || available[0]?.id || '';

  const quote = available.find((item) => item.id === effectiveId);
  const request = quote ? requestMap[quote.requestId] : undefined;

  // The dealer's phone comes from the contact endpoint, which only answers once the contact gate is open.
  const [dealerPhones, setDealerPhones] = useState<Record<string, string | null>>({});
  const dealerPhone = quote && session?.role === 'buyer' ? dealerPhones[quote.id] ?? null : null;
  useEffect(() => {
    if (session?.role !== 'buyer' || !quote?.contactAvailable) return;
    const id = quote.id;
    void client.quotes.dealerContact(id).then((contact) => setDealerPhones((current) => ({ ...current, [id]: contact.phone }))).catch(() => undefined);
  }, [session?.role, quote?.id, quote?.contactAvailable]);

  useEffect(() => {
    if (!quote?.contactAvailable) return;
    let current = true;
    const id = quote.id;
    void client.chats.list(id).then((rows) => {
      if (!current) return;
      setMessages(rows);
      setChatActivityByQuoteId((items) => ({ ...items, [id]: rows }));
      if (!isNarrowViewport || mobileThreadOpen) {
        void client.chats.markRead(id).then(() => {
          if (!current) return;
          const readRows = rows.map((message) => message.senderId === session?.id ? message : { ...message, read: true });
          setMessages(readRows);
          setChatActivityByQuoteId((items) => ({ ...items, [id]: readRows }));
        }).catch(() => {});
      }
    }).catch(() => { if (current) setMessages([]); });
    return () => { current = false; };
  }, [quote?.id, quote?.contactAvailable, isNarrowViewport, mobileThreadOpen, session?.id]);

  const filtered = available.filter((item) => { const itemRequest = requestMap[item.requestId]; return `${itemRequest?.brand} ${itemRequest?.model} ${item.dealerName}`.toLowerCase().includes(search.toLowerCase()); })
    .sort((a, b) => new Date(chatActivityByQuoteId[b.id]?.at(-1)?.createdAt ?? b.createdAt).getTime() - new Date(chatActivityByQuoteId[a.id]?.at(-1)?.createdAt ?? a.createdAt).getTime());
  const thread = useMemo(() => quote?.contactAvailable ? messages : [], [messages, quote?.contactAvailable]);
  const scrolledFor = useRef('');
  // Follows the thread to the bottom when the conversation changes or a message arrives, but not when an existing
  // message is edited or unsent in place - that would throw the buyer away from the message they just changed.
  const lastMessageId = thread[thread.length - 1]?.id;
  useEffect(() => {
    const switched = scrolledFor.current !== effectiveId;
    scrolledFor.current = effectiveId;
    endRef.current?.scrollIntoView({ behavior: switched ? 'auto' : 'smooth', block: 'nearest' });
  }, [effectiveId, thread.length, lastMessageId]);

  // Choosing Edit puts the message in the composer: focus it, and make sure the highlighted message is on screen.
  useEffect(() => {
    if (!editingMessageId) return;
    const field = inputRef.current;
    field?.focus();
    field?.setSelectionRange(field.value.length, field.value.length);
    scrollRef.current?.querySelector(`[data-message-id="${CSS.escape(editingMessageId)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [editingMessageId]);

  // The composer grows with the message (up to a few lines, then scrolls) instead of staying a fixed single-line box.
  useEffect(() => {
    const field = inputRef.current;
    if (!field) return;
    field.style.height = 'auto';
    field.style.height = `${Math.min(field.scrollHeight, COMPOSER_MAX_HEIGHT)}px`;
  }, [input]);

  function chooseConversation(id: string) {
    setActiveId(id);
    setMobileThreadView({ quoteId: id, open: true });
    navigate(`/chat/${id}`, { replace: true });
  }

  function showConversationList() {
    setMobileThreadView({ quoteId, open: false });
    navigate('/chat', { replace: true });
  }

  async function send() {
    if (!quote || !input.trim() || editingMessageId) return;
    const body = input.trim();
    if (violatesChatGuidelines(body)) { setMessageError(CHAT_GUIDELINES_NOTICE); return; }
    try {
      const message = await client.chats.send(quote.id, body);
      setInput(''); setMessageError(''); setMessages((items) => [...items, message]);
      setChatActivityByQuoteId((items) => ({ ...items, [quote.id]: mergeActivity(items[quote.id] ?? [], message) }));
    } catch (error) { setMessageError(error instanceof Error ? error.message : 'Your message could not be sent. Please try again.'); }
  }

  function beginEdit(message: ChatMessage) {
    setEditingMessageId(message.id); setInput(message.body); setMessageError('');
  }

  async function saveEdit() {
    if (!quote || !editingMessageId || !input.trim()) return;
    if (violatesChatGuidelines(input.trim())) { setMessageError(CHAT_GUIDELINES_NOTICE); return; }
    try {
      const updated = await client.chats.edit(quote.id, editingMessageId, input.trim());
      setMessages((items) => items.map((item) => item.id === updated.id ? updated : item));
      setChatActivityByQuoteId((items) => ({ ...items, [quote.id]: mergeActivity(items[quote.id] ?? [], updated) }));
      setEditingMessageId(''); setInput(''); setMessageError('');
    } catch (error) { setMessageError(error instanceof Error ? error.message : 'Your edit could not be saved. Please try again.'); }
  }

  function cancelEdit() {
    setEditingMessageId(''); setInput(''); setMessageError('');
  }

  async function unsend(message: ChatMessage) {
    if (!quote) return;
    try {
      const updated = await client.chats.unsend(quote.id, message.id);
      setMessages((items) => items.map((item) => item.id === updated.id ? updated : item));
      setChatActivityByQuoteId((items) => ({ ...items, [quote.id]: mergeActivity(items[quote.id] ?? [], updated) }));
      if (editingMessageId === message.id) { setEditingMessageId(''); setInput(''); }
      setMessageError('');
    } catch (error) { setMessageError(error instanceof Error ? error.message : 'This message could not be unsent. Please try again.'); }
  }

  /** Enter sends (or saves an edit); Shift+Enter inserts a newline, same as every chat app. Guarded against
   * IME composition so hitting Enter to confirm a kanji/hangul conversion doesn't fire the message early. */
  function onComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Escape') { if (editingMessageId) cancelEdit(); return; }
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (editingMessageId) void saveEdit(); else void send();
    }
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
    <section className={`card chat-layout chat-layout-modern${mobileThreadOpen ? ' mobile-thread-open' : ' mobile-list-open'}`} aria-label="Conversations">
      <aside className="chat-list"><div className="chat-list-head"><span><strong>Messages</strong><small>{available.length} conversations</small></span><label className="chat-search"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search conversations" /></label></div>{filtered.map((item) => {
        const itemRequest = requestMap[item.requestId];
        const activity = chatActivityByQuoteId[item.id] ?? [];
        const latest = activity.at(-1);
        const unreadCount = activity.filter((message) => message.senderId !== session?.id && !message.read).length;
        const preview = latest ? (latest.unsent ? 'Message removed' : `${latest.senderId === session?.id ? 'You: ' : ''}${latest.body}`)
          : item.chatRequestStatus === 'pending' ? isDealer ? 'Buyer asked to negotiate' : 'Waiting for dealer response' : 'Conversation started';
        const activityTime = latest?.createdAt ?? item.createdAt;
        return <button className={`chat-item ${item.id === effectiveId ? 'active' : ''} ${unreadCount ? 'has-unread' : ''}`} key={item.id} onClick={() => chooseConversation(item.id)} aria-label={`${formatVehicle(itemRequest?.brand, itemRequest?.model)}, ${isDealer ? `${itemRequest?.area ?? ''} buyer` : item.dealerName}. ${preview}${unreadCount ? `, ${unreadCount} unread` : ''}`}>
          <span className="chat-item-copy"><span className="chat-item-title-row"><strong>{formatVehicle(itemRequest?.brand, itemRequest?.model)}</strong><time dateTime={activityTime}>{relativeTime(activityTime)}</time></span><small>{isDealer ? `${itemRequest?.area ? `${itemRequest.area} · ` : ''}Buyer` : item.dealerName}</small><span className="chat-item-preview-row"><p>{preview}</p>{unreadCount > 0 && <span className="chat-unread-count" aria-label={`${unreadCount} unread messages`}>{unreadCount > 99 ? '99+' : unreadCount}</span>}</span></span>
        </button>;
      })}<p className="chat-list-note"><ShieldCheck size={15} /><span>Every conversation stays attached to one quote, so price and decisions remain clear.</span></p></aside>
      <main className="chat-thread">{quote && <><header className="chat-thread-head"><button type="button" className="chat-mobile-back" onClick={showConversationList} aria-label="Back to conversations"><ArrowLeft size={19} /></button><span className="chat-thread-title"><strong>{formatVehicle(request?.brand, request?.model)}</strong><small><span>{isDealer ? 'Buyer' : quote.dealerName}</span><span className="chat-thread-status">{quote.contactAvailable ? 'Open conversation' : 'Awaiting dealer approval'} · Quote attached</span></small></span><span className="chat-thread-actions">{dealerPhone && <a className="chat-phone" href={`tel:${dealerPhone}`} aria-label={`Call the dealer on ${dealerPhone}`}><Phone size={15} />{formatPhone(dealerPhone)}</a>}<Link className="button button-secondary button-sm" to={`/quotes/${quote.id}`}>View offer</Link></span></header>
        {quote.contactAvailable ? <><div className="chat-scroll" ref={scrollRef} aria-live="polite"><div className="chat-context"><MessageCircle size={18} /><span><strong>Conversation linked to {formatVehicle(request?.brand, request?.model)}.</strong><small>Offer changes remain visible in the quote history.</small></span></div>{thread.map((message) => {
          const mine = message.senderId === session?.id;
          const editing = message.id === editingMessageId;
          return <div key={message.id} data-message-id={message.id} className={`chat-message-row ${mine ? 'mine' : ''} ${editing ? 'editing' : ''} ${activeMessageId === message.id ? 'actions-visible' : ''}`} onClick={(event) => { if ((event.target as HTMLElement).closest('.chat-message-menu')) return; setActiveMessageId(mine && !message.unsent ? message.id : ''); }}>
            <div className={`chat-message ${message.unsent ? 'unsent' : ''}`}>
              {mine ? <span className="sr-only">You: </span> : <strong>{message.senderName}</strong>}
              <p>{message.body}</p>
              <small className="chat-message-meta">{editing && <b className="chat-editing-tag">Editing</b>}{relativeTime(message.createdAt)}{message.edited && !message.unsent && ' · Edited'}{mine && !message.unsent && <CheckCheck size={13} />}</small>
              {mine && !message.unsent && <ChatMessageMenu onEdit={() => beginEdit(message)} onUnsend={() => void unsend(message)} />}
            </div>
          </div>;
        })}<div ref={endRef} /></div><form className={`chat-composer modern-composer${editingMessageId ? ' is-editing' : ''}`} onSubmit={(event) => { event.preventDefault(); if (editingMessageId) void saveEdit(); else void send(); }}><textarea className="input" ref={inputRef} rows={1} value={input} onChange={(event) => { setInput(event.target.value); setMessageError(''); }} onKeyDown={onComposerKeyDown} placeholder={editingMessageId ? 'Edit your message' : 'Write a message about this offer'} aria-label={editingMessageId ? 'Edit message' : 'Message'} />{editingMessageId && <button type="button" className="button button-secondary composer-text-action" onClick={cancelEdit}>Cancel</button>}{editingMessageId ? <button type="submit" className="button button-secondary composer-text-action composer-save-action" disabled={!input.trim()} aria-label="Save edit">Save</button> : <button className="button button-primary" disabled={!input.trim()} aria-label="Send message"><ArrowUp size={18} /></button>}</form>{messageError && <p className="chat-guideline-notice" role="alert">{messageError}</p>}</>
          : <div className="chat-waiting"><div className="empty-icon"><LockKeyhole /></div><h3>{isDealer ? 'Buyer requested a negotiation' : 'Negotiation request sent'}</h3><p>{isDealer ? 'Review the buyer’s opening note. Contact details and messaging open only after you accept.' : 'The dealer can read your opening note. Contact and messages unlock only if they accept.'}</p><div className="opening-note"><span>{isDealer ? 'Buyer’s opening note' : 'Your opening note'}</span><p>“{quote.chatRequestMessage ?? 'I would like to discuss this offer before deciding.'}”</p></div>{isDealer ? <div className="chat-request-actions"><button className="button button-primary" onClick={() => void acceptRequest(quote.id)}><UserCheck size={17} /> Accept &amp; open chat</button><button className="button button-secondary" onClick={() => { const reason = window.prompt('Brief reason shown to the buyer'); if (reason?.trim()) void declineRequest(quote.id, reason.trim()); }}><X size={17} /> Decline</button></div> : <StatusBadge status="pending" />}</div>}
        {!quote.contactAvailable && <form className="chat-composer modern-composer" onSubmit={(event) => event.preventDefault()}><input className="input" disabled placeholder={isDealer ? 'Accept the request to start messaging' : 'Messaging unlocks when the dealer accepts'} aria-label="Message (locked)" /><button className="button button-primary" disabled aria-label="Send message"><ArrowUp size={18} /></button></form>}
      </>}</main>
    </section>
  </div>;
}

/** +1 (972) 555-0120 for ten or eleven-digit US numbers; anything else is shown as stored. */
function formatPhone(phone: string) {
  const digits = phone.replace(/\D/g, '');
  const local = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  return local.length === 10 ? `+1 (${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}` : phone;
}

function formatVehicle(brand?: string, model?: string) {
  return [brand, model].filter(Boolean).join(' ') || 'this vehicle';
}

function mergeActivity(messages: ChatMessage[], updated: ChatMessage) {
  return [...messages.filter((message) => message.id !== updated.id), updated]
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
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

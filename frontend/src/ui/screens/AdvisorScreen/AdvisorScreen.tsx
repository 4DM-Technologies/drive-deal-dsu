/* eslint-disable react-refresh/only-export-components -- response formatting helpers are exported for focused tests */
import { ArrowUp, CheckCircle2, FileCheck2, History, Menu, MoreHorizontal, Pencil, Plus, Sparkles, Square, Trash2, Trophy, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import { Link, useSearchParams } from 'react-router-dom';
import remarkGfm from 'remark-gfm';
import { formatMoney } from '@/helpers/currency';
import { relativeTime } from '@/helpers/dateTime';
import { client } from '@/services/platform/client';
import { CompareIcon } from '@/ui/reusables/Icons/CompareIcon';
import { SerraLoader } from '@/ui/reusables/PageLoading/PageLoading';
import { SerraLogo } from '@/ui/reusables/SerraLogo/SerraLogo';
import type { AiMessage, AiThread, BuyerRequest, Quote } from '@/types/domain';

type RequestDraft = Record<string, string>;
interface CompareDraft { leader?: string; total?: string; difference?: string; requestIds?: string[]; quoteIds?: string[] }
type CompareMode = 'requests' | 'dealers';
type CompareSelection = { requestIds?: string[]; quoteIds?: string[] };

const compareOffersPrompt = 'Compare offers on my requests';
const prompts = ['Find a family SUV for me', compareOffersPrompt, 'Help me build a buyer request', 'What should I ask a dealer?'];
const greeting = 'Hi, I’m Sera—your buyer-side car advisor. I can help you:\n\n- Find the right vehicle for your life and budget\n- Compare itemized dealer offers\n- Turn a conversation into a private buying request';
type ActivityPhase = 'classifying' | 'searching' | 'crawling' | 'composing';

const activity: Record<ActivityPhase, string> = {
  classifying: 'Thinking',
  searching: 'Searching Deal&Drive knowledge',
  crawling: 'Searching trusted sources',
  composing: 'Preparing response',
};

function ActivityStatus({ label }: { label: string }) {
  return <span className="agent-status" role="status"><span>{label}</span><span className="status-dots" aria-hidden="true"><i /><i /><i /></span></span>;
}

function Answer({ body }: { body: string }) {
  return <div className="answer-markdown"><Markdown remarkPlugins={[remarkGfm]} components={{
    a: ({ children, ...props }) => <a {...props} target="_blank" rel="noreferrer">{children}</a>,
    table: ({ children, ...props }) => <table {...props}>{children}</table>,
  }}>{body}</Markdown></div>;
}

export function normalizeRequestDraft(payload: unknown): RequestDraft | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const card = payload as Record<string, unknown>;
  // Clarification cards contain structured question objects. The assistant already asks those questions
  // conversationally, so they must never be rendered as editable text fields.
  if (Array.isArray(card.questions)) return null;
  const source = card.draft && typeof card.draft === 'object' && !Array.isArray(card.draft)
    ? card.draft as Record<string, unknown>
    : card;
  const aliases: Array<[string, string[]]> = [
    ['brand', ['brand']], ['model', ['model', 'model_name']], ['years', ['years']],
    ['budget', ['budget', 'budget_max']], ['area', ['area', 'buyer_area']],
    ['timeline', ['timeline']], ['mustHaves', ['mustHaves', 'must_haves']], ['bodyType', ['bodyType', 'body_type']],
  ];
  const draft: RequestDraft = {};
  for (const [label, keys] of aliases) {
    const value = keys.map((key) => source[key]).find((item) => item !== undefined && item !== null && item !== '');
    if (typeof value === 'string' || typeof value === 'number') draft[label] = String(value);
    else if (Array.isArray(value) && value.every((item) => typeof item === 'string')) draft[label] = value.join(', ');
  }
  return Object.keys(draft).length ? draft : null;
}

export default function AdvisorScreen() {
  const [params, setParams] = useSearchParams();
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [requests, setRequests] = useState<BuyerRequest[]>([]);
  const initialSelected = (params.get('compare') ?? '').split(',').filter(Boolean);
  const [selected, setSelected] = useState<string[]>(initialSelected);
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [threads, setThreads] = useState<AiThread[]>([]);
  const [threadsLoading, setThreadsLoading] = useState(true);
  const [threadLoading, setThreadLoading] = useState(false);
  const [input, setInput] = useState(params.get('prompt') === 'compare' || initialSelected.length ? 'Compare these dealer offers' : params.get('prompt') === 'request' ? 'Show my request draft' : '');
  const [status, setStatus] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [activeAssistantId, setActiveAssistantId] = useState<string | null>(null);
  const [stopped, setStopped] = useState(false);
  const [threadId, setThreadId] = useState<string>();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(initialSelected.length > 0);
  const [compareMode, setCompareMode] = useState<CompareMode>(initialSelected.length >= 2 ? 'requests' : 'dealers');
  const [selectedQuoteIds, setSelectedQuoteIds] = useState<string[]>([]);
  const [dealerRequestId, setDealerRequestId] = useState<string | null>(null);
  const [draft, setDraft] = useState<RequestDraft | null>(null);
  const [compare, setCompare] = useState<CompareDraft | null>(null);
  const [editing, setEditing] = useState(false);
  const [published, setPublished] = useState(false);
  const [threadMenuId, setThreadMenuId] = useState<string | null>(null);
  const [deletingThreadId, setDeletingThreadId] = useState<string | null>(null);
  const [threadActionError, setThreadActionError] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const activeRunRef = useRef(0);
  const activeAssistantIdRef = useRef<string | null>(null);
  const greetingRunRef = useRef(0);
  const requestGroups = useMemo(() => requests.map((request) => ({ request, quotes: quotes.filter((quote) => quote.requestId === request.id) })).filter((group) => group.quotes.length >= 1), [quotes, requests]);
  const dealerGroups = useMemo(() => requestGroups.filter((group) => group.quotes.length >= 2), [requestGroups]);
  const activeDealerRequestId = dealerRequestId ?? dealerGroups[0]?.request.id ?? null;
  const activeDealerGroup = dealerGroups.find((group) => group.request.id === activeDealerRequestId);
  const canCompare = compareMode === 'requests' ? selected.length >= 2 : selectedQuoteIds.length >= 2;

  const refreshThreads = useCallback(async () => {
    try { setThreads(await client.ai.threads()); } catch { setThreads([]); } finally { setThreadsLoading(false); }
  }, []);

  const cancelActiveResponse = useCallback((showNotice = false) => {
    const controller = abortControllerRef.current;
    if (!controller || controller.signal.aborted) return;
    controller.abort();
    abortControllerRef.current = null;
    activeRunRef.current += 1;
    const assistantId = activeAssistantIdRef.current;
    activeAssistantIdRef.current = null;
    setActiveAssistantId(null);
    if (assistantId) setMessages((items) => items.filter((item) => item.id !== assistantId || Boolean(item.body)));
    setStreaming(false);
    setStatus('');
    setStopped(showNotice);
  }, []);

  const streamGreeting = useCallback(() => {
    const run = ++greetingRunRef.current;
    const id = crypto.randomUUID();
    setMessages([{ id, role: 'assistant', body: '' }]);
    void (async () => {
      for (const piece of greeting.split(/(\s+)/)) {
        await new Promise((resolve) => window.setTimeout(resolve, 14));
        if (greetingRunRef.current !== run) return;
        setMessages((items) => items.map((item) => item.id === id ? { ...item, body: item.body + piece } : item));
      }
    })();
  }, []);

  const openThread = useCallback(async (id: string) => {
    cancelActiveResponse(false);
    ++greetingRunRef.current;
    setStatus('');
    setDraft(null);
    setCompare(null);
    setThreadLoading(true);
    try {
      const thread = await client.ai.thread(id);
      setThreadId(thread.id);
      setMessages(thread.messages);
      setSidebarOpen(false);
      setParams({ thread: thread.id }, { replace: true });
    } catch {
      streamGreeting();
    } finally {
      setThreadLoading(false);
    }
  }, [cancelActiveResponse, setParams, streamGreeting]);

  // This is an intentional mount-only bootstrap; each function owns cancellation/error handling.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshThreads();
    void client.requests.list().then(setRequests).catch(() => setRequests([]));
    void client.quotes.list().then(setQuotes).catch(() => setQuotes([]));
    const initialThread = params.get('thread');
    if (initialThread) void openThread(initialThread);
    else streamGreeting();
  // The bootstrap must not restart when callbacks receive new state closures.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => () => { activeRunRef.current += 1; abortControllerRef.current?.abort(); }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, [messages, status, draft, compare]);

  function newChat() {
    cancelActiveResponse(false);
    ++greetingRunRef.current;
    setDraft(null); setCompare(null); setSelected([]); setSelectedQuoteIds([]); setThreadId(undefined); setPublished(false); setSidebarOpen(false); setParams({}, { replace: true });
    streamGreeting();
  }

  function toggleRequest(requestId: string) {
    setSelected((items) => items.includes(requestId) ? items.filter((item) => item !== requestId) : [...items, requestId].slice(0, 5));
  }

  function toggleQuote(quoteId: string) {
    setSelectedQuoteIds((items) => items.includes(quoteId) ? items.filter((item) => item !== quoteId) : [...items, quoteId].slice(0, 5));
  }

  async function deleteThread(thread: AiThread) {
    if (deletingThreadId) return;
    setThreadMenuId(null);
    setDeletingThreadId(thread.id);
    setThreadActionError('');
    const deletingActiveThread = thread.id === threadId;
    if (deletingActiveThread) cancelActiveResponse(false);
    try {
      await client.ai.deleteThread(thread.id);
      setThreads((items) => items.filter((item) => item.id !== thread.id));
      if (deletingActiveThread) newChat();
    } catch (error) {
      setThreadActionError(error instanceof Error ? error.message : 'Could not delete this chat. Please try again.');
    } finally {
      setDeletingThreadId(null);
    }
  }

  function runComparison() {
    if (!canCompare || streaming) return;
    setCompareOpen(false);
    if (compareMode === 'requests') {
      void send('Compare the best dealer offers across these selected vehicle requests and explain the trade-offs.', { requestIds: selected });
    } else {
      void send('Compare these selected dealer offers for this buyer request and recommend the strongest offer.', { quoteIds: selectedQuoteIds });
    }
  }

  function handlePrompt(prompt: string) {
    if (prompt === compareOffersPrompt) {
      setCompareMode('dealers');
      setCompareOpen(true);
      return;
    }
    void send(prompt);
  }

  async function send(value = input, comparison?: CompareSelection) {
    const text = value.trim();
    if (!text || streaming) return;
    if (!comparison && text.toLowerCase() === compareOffersPrompt.toLowerCase()) {
      setInput('');
      setCompareMode('dealers');
      setCompareOpen(true);
      return;
    }
    ++greetingRunRef.current;
    const run = ++activeRunRef.current;
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setInput(''); setStopped(false); setCompare(null); setStreaming(true); setStatus(activity.classifying);
    const assistantId = crypto.randomUUID();
    activeAssistantIdRef.current = assistantId;
    setActiveAssistantId(assistantId);
    setMessages((items) => [...items, { id: crypto.randomUUID(), role: 'user', body: text }, { id: assistantId, role: 'assistant', body: '' }]);
    // Only a confirmed picker selection invokes the saved-offer comparison agent. Natural questions such as
    // "compare BMW and Audi" stay in Sera's normal knowledge-backed conversation, even if old selections exist.
    const isCompare = Boolean(comparison) || (compareOpen && canCompare);
    const requestIds = comparison?.requestIds ?? (isCompare && compareMode === 'requests' ? selected : []);
    const quoteIds = comparison?.quoteIds ?? (isCompare && compareMode === 'dealers' ? selectedQuoteIds : []);
    try {
      for await (const event of client.ai.chat({ message: text, ...(threadId ? { threadId } : {}), agent: isCompare ? 'compare-agent' : 'sera-agent', requestIds, quoteIds, signal: controller.signal })) {
        if (controller.signal.aborted || activeRunRef.current !== run) break;
        if (event.type === 'status') setStatus(activity[event.phase]);
        if (event.type === 'token') { setStatus(''); setMessages((items) => items.map((item) => item.id === assistantId ? { ...item, body: item.body + event.text } : item)); }
        if (event.type === 'card' && event.kind === 'requestPreview') setDraft(normalizeRequestDraft(event.payload));
        if (event.type === 'card' && event.kind === 'compare') setCompare(event.payload as CompareDraft);
        if (event.type === 'error') {
          setStatus('');
          setMessages((items) => items.map((item) => item.id === assistantId ? { ...item, body: item.body || `## I hit a problem\n${event.message || 'Please try sending that message again.'}` } : item));
        }
        if (event.type === 'done') {
          setStatus('');
          setThreadId(event.threadId);
          setParams({ thread: event.threadId }, { replace: true });
          await refreshThreads();
        }
      }
    } catch {
      if (controller.signal.aborted || activeRunRef.current !== run) return;
      setMessages((items) => items.map((item) => item.id === assistantId ? { ...item, body: '## I hit a connection problem\n- Your conversation is safe\n- Please try sending that message again' } : item));
    } finally {
      if (activeRunRef.current === run) {
        abortControllerRef.current = null;
        activeAssistantIdRef.current = null;
        setActiveAssistantId(null);
        setStreaming(false);
        setStatus('');
      }
    }
  }

  return <div className="advisor-page">
    <section className="shell advisor-shell" aria-label="Ask Sera">
      {sidebarOpen && <button className="advisor-scrim" aria-label="Close chat list" onClick={() => setSidebarOpen(false)} />}
      <aside className={`advisor-sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="advisor-sidebar-head"><div><span className="eyebrow">Conversation memory</span><h2>Your chats</h2><p className="advisor-sidebar-note">Research, compare, and build a request—with you in control.</p></div><button className="button button-ghost advisor-mobile-menu" onClick={() => setSidebarOpen(false)} aria-label="Close chat list"><X size={19} /></button></div>
        <button className="button button-primary button-wide" onClick={newChat}><Plus size={17} /> New chat</button>
        <div className="advisor-thread-list" aria-busy={threadsLoading}>{threadsLoading ? <div className="loader-inline"><SerraLoader size={28} label="Loading your chats" /></div> : threads.map((thread) => <div key={thread.id} className={`advisor-thread-item${thread.id === threadId ? ' active' : ''}`} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setThreadMenuId(null); }}><button type="button" className="advisor-thread-open" onClick={() => void openThread(thread.id)}><History size={16} /><span><strong>{thread.title}</strong><small>{thread.id === threadId ? 'Active now' : relativeTime(thread.updatedAt)}</small></span></button><button type="button" className="advisor-thread-more" aria-label={`More options for ${thread.title}`} aria-expanded={threadMenuId === thread.id} onClick={() => setThreadMenuId((id) => id === thread.id ? null : thread.id)}><MoreHorizontal size={17} /></button>{threadMenuId === thread.id && <div className="advisor-thread-menu" role="menu"><button type="button" role="menuitem" disabled={deletingThreadId === thread.id} onClick={() => void deleteThread(thread)}><Trash2 size={15} /> {deletingThreadId === thread.id ? 'Deleting…' : 'Delete chat'}</button></div>}</div>)}</div>
        {threadActionError && <p className="advisor-thread-error" role="alert">{threadActionError}</p>}
        <div className="advisor-privacy"><CheckCircle2 size={18} /><span><strong>You stay in control</strong><small>Sera never posts or accepts without approval.</small></span></div>
      </aside>
      <main className="advisor-chat">
        <header className="advisor-chat-head"><button className="button button-ghost advisor-mobile-menu" onClick={() => setSidebarOpen(true)} aria-label="Open chat list"><Menu size={19} /></button><div className="serra-avatar"><SerraLogo size={40} title={null} /></div><span><strong>Sera</strong><small><i /> Online · remembers this chat</small></span></header>
        <div className="advisor-scroll" aria-live="polite">
          <div className="advisor-day">Today</div>
          {threadLoading ? <div className="advisor-loading"><SerraLoader size={56} label="Opening this chat" /></div> : messages.map((message) => {
            const showStatus = message.id === activeAssistantId && !message.body && Boolean(status);
            if (!message.body && !showStatus) return null;
            return <article key={message.id} className={`advisor-message ${message.role}`}>
              <div className="message-content">
                <div className={`message-bubble${showStatus ? ' is-status' : ''}`}>{message.body ? <Answer body={message.body} /> : <ActivityStatus label={status} />}</div>
              </div>
            </article>;
          })}
          {stopped && <div className="inline-notice">Response stopped. Your partial answer remains in this chat.</div>}
          {draft && <section className="ai-result-card request-preview"><div className="result-card-head"><div><span className="eyebrow">Dealer-ready draft</span><h3>Your buying request</h3></div><button className="button button-secondary button-sm" onClick={() => setEditing(!editing)}><Pencil size={14} /> {editing ? 'Done' : 'Edit'}</button></div><div className="request-preview-grid">{Object.entries(draft).map(([key, value]) => <label key={key}><span>{key === 'mustHaves' ? 'Must-haves' : key.replace(/([A-Z])/g, ' $1')}</span>{editing ? <input value={value} onChange={(event) => setDraft({ ...draft, [key]: event.target.value })} /> : <strong>{value}</strong>}</label>)}</div><div className="result-card-actions"><p><CheckCircle2 size={16} /> Nothing is posted until you confirm.</p><button className="button button-primary" onClick={() => setPublished(true)} disabled={published}><FileCheck2 size={17} /> {published ? 'Request posted' : 'Post this request'}</button></div></section>}
          {compare && <ComparisonCard compare={compare} selected={selected} selectedQuoteIds={selectedQuoteIds} quotes={quotes} requests={requests} />}
          <div ref={endRef} />
        </div>
        <div className="advisor-dock">
          {compareOpen && <section className="compare-popover" aria-label="Compare dealer offers" onKeyDown={(event) => { if (event.key === 'Enter' && event.target instanceof HTMLInputElement && canCompare) { event.preventDefault(); runComparison(); } }}>
            <div className="compare-popover-head"><span><CompareIcon size={17} /><strong>Compare offers</strong><small>{compareMode === 'requests' ? `${selected.length} requests selected` : `${selectedQuoteIds.length} dealer offers selected`}</small></span><button type="button" className="button button-ghost button-sm" onClick={() => setCompareOpen(false)} aria-label="Close compare"><X size={16} /></button></div>
            <div className="compare-mode-tabs" role="tablist" aria-label="Comparison type">
              <button type="button" role="tab" aria-selected={compareMode === 'dealers'} className={compareMode === 'dealers' ? 'active' : ''} onClick={() => setCompareMode('dealers')}>Dealers on one request</button>
              <button type="button" role="tab" aria-selected={compareMode === 'requests'} className={compareMode === 'requests' ? 'active' : ''} onClick={() => setCompareMode('requests')}>Different vehicle requests</button>
            </div>
            <p className="compare-help">{compareMode === 'dealers' ? 'Choose at least two dealer offers from one request.' : 'Choose at least two vehicle requests to compare their best offers.'}</p>
            <div className="compare-picker-body">
              {compareMode === 'requests' ? <>
                {requestGroups.length ? requestGroups.map(({ request, quotes: groupQuotes }) => { const best = [...groupQuotes].sort((a, b) => Number(a.finalPrice) - Number(b.finalPrice))[0]; return <label className={`compare-request-option ${selected.includes(request.id) ? 'selected' : ''}`} key={request.id}><input type="checkbox" checked={selected.includes(request.id)} onChange={() => toggleRequest(request.id)} /><span><strong>{request.brand} {request.model}</strong><small>{groupQuotes.length} dealer {groupQuotes.length === 1 ? 'offer' : 'offers'} · best {best ? formatMoney(best.finalPrice) : 'not reported'}</small></span></label>; }) : <p className="muted">Requests appear here after at least one dealer responds.</p>}
              </> : <>
                {dealerGroups.length ? <>
                  <div className="compare-request-selector">{dealerGroups.map(({ request, quotes: groupQuotes }) => <button type="button" key={request.id} className={request.id === activeDealerRequestId ? 'active' : ''} onClick={() => { setDealerRequestId(request.id); setSelectedQuoteIds([]); }}><strong>{request.brand} {request.model}</strong><small>{groupQuotes.length} offers</small></button>)}</div>
                  <div className="compare-offer-list">{activeDealerGroup?.quotes.map((quote) => <label className={`compare-request-option ${selectedQuoteIds.includes(quote.id) ? 'selected' : ''}`} key={quote.id}><input type="checkbox" checked={selectedQuoteIds.includes(quote.id)} onChange={() => toggleQuote(quote.id)} /><span><strong>{quote.dealerName}</strong><small>{formatMoney(quote.finalPrice)} out the door · {quote.rating}★</small></span></label>)}</div>
                </> : <p className="muted">A request needs at least two dealer offers before you can compare dealers.</p>}
              </>}
              <button type="button" className="button button-primary button-wide" disabled={!canCompare || streaming} onClick={runComparison}>{compareMode === 'requests' ? `Compare ${selected.length || ''} requests` : `Compare ${selectedQuoteIds.length || ''} dealer offers`}</button>
            </div>
          </section>}
          <div className="advisor-dock-bar">
            <div className="advisor-prompts advisor-followups">{!streaming && prompts.map((prompt) => <button type="button" key={prompt} onClick={() => handlePrompt(prompt)}>{prompt}</button>)}</div>
            <button type="button" className={`compare-toggle ${compareOpen ? 'open' : ''}`} onClick={() => setCompareOpen((value) => !value)} aria-expanded={compareOpen}><CompareIcon size={16} /><span>Compare{(compareMode === 'requests' ? selected.length : selectedQuoteIds.length) ? ` (${compareMode === 'requests' ? selected.length : selectedQuoteIds.length})` : ''}</span></button>
          </div>
        <form className="advisor-composer" onSubmit={(event) => { event.preventDefault(); if (input.trim()) void send(); else runComparison(); }}><div className="composer-input"><textarea value={input} onChange={(event) => setInput(event.target.value)} rows={1} placeholder={compareOpen && canCompare ? 'Press Enter or Send to compare your selections' : 'Ask about a car, an offer, or your requirements'} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); if (input.trim()) void send(); else runComparison(); } }} /><div className="composer-actions">{streaming && <button type="button" className="button composer-stop" onClick={() => cancelActiveResponse(true)} aria-label="Stop generating" title="Stop generating"><Square size={12} fill="currentColor" /></button>}<button className="button button-primary" disabled={streaming || (!input.trim() && !(compareOpen && canCompare))} aria-label={compareOpen && canCompare && !input.trim() ? 'Compare selected offers' : 'Send message'}><ArrowUp size={18} /></button></div></div><small>Sera can make mistakes. Review prices and availability before deciding.</small></form>
        </div>
      </main>
    </section>
  </div>;
}

function ComparisonCard({ compare, selected, selectedQuoteIds, quotes, requests }: { compare: CompareDraft; selected: string[]; selectedQuoteIds: string[]; quotes: Quote[]; requests: BuyerRequest[] }) {
  const requestIds = compare.requestIds?.length ? compare.requestIds : selected;
  const quoteIds = compare.quoteIds?.length ? compare.quoteIds : selectedQuoteIds;
  const comparingDealers = quoteIds.length >= 2;
  const rows = (comparingDealers
    ? quotes.filter((quote) => quoteIds.includes(quote.id))
    : requestIds.flatMap((requestId) => { const quote = quotes.filter((item) => item.requestId === requestId).sort((a, b) => Number(a.finalPrice) - Number(b.finalPrice))[0]; return quote ? [quote] : []; }))
    .sort((a, b) => Number(a.finalPrice) - Number(b.finalPrice));
  return <section className="ai-result-card comparison-card"><div className="result-card-head"><div><span className="eyebrow">Sera comparison</span><h3>{comparingDealers ? 'Selected dealer offers' : 'Best offer from each selected request'}</h3></div><span className="comparison-count">{rows.length} {comparingDealers ? 'offers' : 'requests'}</span></div>{rows.map((quote, index) => { const request = requests.find((item) => item.id === quote.requestId); return <Link to={`/requests/${quote.requestId}`} className={`comparison-row ${index === 0 ? 'winner' : ''}`} key={quote.id}><span className="comparison-rank">{index === 0 ? <Trophy size={17} /> : index + 1}</span><span><strong>{comparingDealers ? quote.dealerName : `${request?.brand ?? ''} ${request?.model ?? ''}`}</strong><small>{comparingDealers ? `${request?.brand ?? ''} ${request?.model ?? ''}` : `${quote.dealerName} · ${quote.rating}★`}</small></span><span><strong>{formatMoney(quote.finalPrice)}</strong><small>Itemized out-the-door</small></span></Link>; })}<div className="comparison-insight"><Sparkles size={17} /><p><strong>Sera’s read:</strong> Compare total cost alongside equipment, delivery confidence, and anything a dealer did not report—not price alone.</p></div></section>;
}

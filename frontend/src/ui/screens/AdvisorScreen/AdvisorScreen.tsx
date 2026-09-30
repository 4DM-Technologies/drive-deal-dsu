import { ArrowUp, Bot, Check, CheckCircle2, ChevronLeft, Circle, FileCheck2, Globe2, History, Menu, Pencil, Plus, Scale, Search, Sparkles, StopCircle, Trophy, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { client } from '@/services/platform/client';
import { formatMoney } from '@/helpers/currency';
import { useDemoStore } from '@/services/platform/demoStore';

interface AdvisorMessage { id: string; role: 'user' | 'assistant'; body: string }
interface RequestDraft { brand: string; model: string; years: string; budget: string; area: string; timeline: string; mustHaves: string }
interface CompareDraft { leader?: string; total?: string; difference?: string; requestIds?: string[] }

const prompts = ['Find a family SUV for me', 'Compare offers on my requests', 'Help me build a buyer request', 'What should I ask a dealer?'];
const threads = ['Bronco offer comparison', 'Family SUV shortlist', 'BMW ownership costs', 'New request draft'];
const activity = [
  { phase: 'classifying', label: 'Understanding your intent', icon: Sparkles },
  { phase: 'searching', label: 'Checking DriveDeal knowledge', icon: Search },
  { phase: 'crawling', label: 'Researching trusted sources', icon: Globe2 },
  { phase: 'composing', label: 'Building your answer', icon: Bot },
];

function Answer({ body }: { body: string }) {
  const sections = body.split('\n').map((line) => line.trim()).filter(Boolean);
  if (sections.length > 1) return <div className="answer-sections">{sections.map((line, index) => line.startsWith('## ') ? <h4 key={`${line}-${index}`}>{line.slice(3)}</h4> : line.startsWith('- ') ? <div className="answer-point" key={`${line}-${index}`}><Check size={14} /><span>{line.slice(2)}</span></div> : <p key={`${line}-${index}`}>{line}</p>)}</div>;
  const sentences = body.split(/(?<=[.!?])\s+/).filter(Boolean);
  if (sentences.length < 3) return <p>{body}</p>;
  return <><p className="answer-lead">{sentences[0]}</p><div className="answer-points">{sentences.slice(1).map((sentence) => <div className="answer-point" key={sentence}><Check size={14} /><span>{sentence}</span></div>)}</div></>;
}

export default function AdvisorScreen() {
  const [params] = useSearchParams();
  const quotes = useDemoStore((state) => state.quotes);
  const requests = useDemoStore((state) => state.requests);
  const initialSelected = (params.get('compare') ?? '').split(',').filter(Boolean);
  const [selected, setSelected] = useState<string[]>(initialSelected);
  const [messages, setMessages] = useState<AdvisorMessage[]>([{ id: 'welcome', role: 'assistant', body: 'Hi, I’m Serra. I can help you choose a vehicle, turn your needs into a dealer-ready request, or compare real offers. You approve every action.' }]);
  const [input, setInput] = useState(params.get('prompt') === 'compare' || initialSelected.length ? 'Compare these dealer offers' : params.get('prompt') === 'request' ? 'Show my request draft' : '');
  const [status, setStatus] = useState('');
  const [phase, setPhase] = useState('');
  const [stopped, setStopped] = useState(false);
  const [threadId, setThreadId] = useState<string>();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [draft, setDraft] = useState<RequestDraft | null>(null);
  const [compare, setCompare] = useState<CompareDraft | null>(null);
  const [editing, setEditing] = useState(false);
  const [published, setPublished] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef(false);
  const activePhase = Math.max(0, activity.findIndex((item) => item.phase === phase));
  const requestGroups = useMemo(() => requests.map((request) => ({ request, quotes: quotes.filter((quote) => quote.requestId === request.id) })).filter((group) => group.quotes.length >= 1), [quotes, requests]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, [messages, status, draft, compare]);

  function newChat() {
    setMessages([{ id: crypto.randomUUID(), role: 'assistant', body: 'Fresh chat, clean slate. What are you hoping to buy?' }]);
    setDraft(null); setCompare(null); setSelected([]); setThreadId(undefined); setPublished(false); setSidebarOpen(false);
  }

  function toggleRequest(requestId: string) {
    setSelected((items) => items.includes(requestId) ? items.filter((item) => item !== requestId) : [...items, requestId].slice(0, 5));
  }

  async function send(value = input) {
    const text = value.trim();
    if (!text || status) return;
    setInput(''); setStopped(false); abortRef.current = false; setCompare(null);
    const assistantId = crypto.randomUUID();
    setMessages((items) => [...items, { id: crypto.randomUUID(), role: 'user', body: text }, { id: assistantId, role: 'assistant', body: '' }]);
    const isCompare = text.toLowerCase().includes('compare') && selected.length >= 2;
    try {
      for await (const event of client.ai.chat({ message: text, ...(threadId ? { threadId } : {}), agent: isCompare ? 'compare-agent' : 'sera-agent', requestIds: isCompare ? selected : [] })) {
        if (abortRef.current) { setStopped(true); setStatus(''); break; }
        if (event.type === 'status') { setStatus(event.label); setPhase(event.phase); }
        if (event.type === 'token') { setStatus(''); setMessages((items) => items.map((item) => item.id === assistantId ? { ...item, body: item.body + event.text } : item)); }
        if (event.type === 'card' && event.kind === 'requestPreview') setDraft(event.payload as RequestDraft);
        if (event.type === 'card' && event.kind === 'compare') setCompare(event.payload as CompareDraft);
        if (event.type === 'done') { setStatus(''); setThreadId(event.threadId); }
      }
    } catch {
      setStatus('');
      setMessages((items) => items.map((item) => item.id === assistantId ? { ...item, body: 'I couldn’t finish that reply. Your chat is safe—please try again.' } : item));
    }
  }

  return (
    <div className="advisor-page">
      <div className="shell advisor-heading"><div><span className="eyebrow">Buyer AI workspace</span><h1>Ask Serra</h1><p>Research, compare, and build a request—with you in control.</p></div><div className="advisor-heading-actions"><button className="button button-secondary advisor-mobile-menu" onClick={() => setSidebarOpen(true)}><Menu size={17} /> Chats</button></div></div>
      <section className="shell advisor-shell">
        {sidebarOpen && <button className="advisor-scrim" aria-label="Close chat list" onClick={() => setSidebarOpen(false)} />}
        <aside className={`advisor-sidebar ${sidebarOpen ? 'open' : ''}`}>
          <div className="advisor-sidebar-head"><div><span className="eyebrow">Conversation memory</span><h2>Your chats</h2></div><button className="button button-ghost advisor-mobile-menu" onClick={() => setSidebarOpen(false)} aria-label="Close chat list"><X size={19} /></button></div>
          <button className="button button-primary button-wide" onClick={newChat}><Plus size={17} /> New chat</button>
          <div className="advisor-thread-list">{threads.map((thread, index) => <button key={thread} className={index === 0 ? 'active' : ''} onClick={() => setSidebarOpen(false)}><History size={16} /><span><strong>{thread}</strong><small>{index === 0 ? 'Active now' : `${index + 1} days ago`}</small></span></button>)}</div>
          <div className="advisor-privacy"><CheckCircle2 size={18} /><span><strong>You stay in control</strong><small>Serra never posts or accepts without approval.</small></span></div>
        </aside>
        <main className="advisor-chat">
          <header className="advisor-chat-head"><div className="serra-avatar"><Sparkles size={19} /></div><span><strong>Serra</strong><small><i /> Online · remembers this chat</small></span>{status && <button className="button button-ghost button-sm" onClick={() => { abortRef.current = true; }}><StopCircle size={16} /> Stop</button>}</header>
          <div className="advisor-scroll" aria-live="polite">
            <div className="advisor-day">Today</div>
            {messages.map((message) => <article key={message.id} className={`advisor-message ${message.role}`}>
              {message.role === 'assistant' && <div className="message-avatar"><Bot size={17} /></div>}
              <div className="message-content">{message.role === 'assistant' && <span className="message-author">Serra</span>}<div className="message-bubble">{message.body ? <Answer body={message.body} /> : status ? null : '…'}</div></div>
            </article>)}
            {status && <section className="agent-activity"><div className="activity-title"><span className="dots"><i /><i /><i /></span><strong>{status}</strong></div>{activity.map(({ phase: itemPhase, label, icon: Icon }, index) => <div key={itemPhase} className={index < activePhase ? 'done' : index === activePhase ? 'active' : ''}>{index < activePhase ? <Check size={15} /> : index === activePhase ? <Icon size={15} /> : <Circle size={12} />}<span>{label}</span></div>)}</section>}
            {stopped && <div className="inline-notice">Stopped. Your partial response remains in this chat.</div>}
            {draft && <section className="ai-result-card request-preview"><div className="result-card-head"><div><span className="eyebrow">Dealer-ready draft</span><h3>Your buying request</h3></div><button className="button button-secondary button-sm" onClick={() => setEditing(!editing)}><Pencil size={14} /> {editing ? 'Done' : 'Edit'}</button></div><div className="request-preview-grid">{Object.entries(draft).map(([key, value]) => <label key={key}><span>{key === 'mustHaves' ? 'Must-haves' : key.replace(/([A-Z])/g, ' $1')}</span>{editing ? <input value={value} onChange={(event) => setDraft({ ...draft, [key]: event.target.value })} /> : <strong>{value}</strong>}</label>)}</div><div className="result-card-actions"><p><CheckCircle2 size={16} /> Nothing is posted until you confirm.</p><button className="button button-primary" onClick={() => setPublished(true)} disabled={published}><FileCheck2 size={17} /> {published ? 'Request posted' : 'Post this request'}</button></div></section>}
            {compare && <ComparisonCard compare={compare} selected={selected} quotes={quotes} requests={requests} />}
            <div ref={endRef} />
          </div>
          {messages.length <= 2 && <div className="advisor-prompts">{prompts.map((prompt) => <button key={prompt} onClick={() => void send(prompt)}><Sparkles size={14} />{prompt}</button>)}</div>}
          <section className="compare-picker"><details open={params.has('compare')}><summary><span><Scale size={17} /><strong>Compare my requests</strong><small>{selected.length ? `${selected.length} selected` : 'Choose 2–5 requests with offers'}</small></span><ChevronLeft size={17} /></summary><div className="compare-picker-body">{requestGroups.length ? requestGroups.map(({ request, quotes: groupQuotes }) => { const best = [...groupQuotes].sort((a, b) => Number(a.finalPrice) - Number(b.finalPrice))[0]; return <label className={`compare-request-option ${selected.includes(request.id) ? 'selected' : ''}`} key={request.id}><input type="checkbox" checked={selected.includes(request.id)} onChange={() => toggleRequest(request.id)} /><span><strong>{request.brand} {request.model}</strong><small>{groupQuotes.length} dealer offers · best {best ? formatMoney(best.finalPrice) : 'not reported'}</small></span></label>; }) : <p className="muted">Requests appear here after at least one dealer responds.</p>}<button className="button button-secondary button-wide" disabled={selected.length < 2} onClick={() => void send('Compare the selected vehicle requests and their dealer offers, then explain the trade-offs')}>Compare {selected.length || ''} requests</button></div></details></section>
          <form className="advisor-composer" onSubmit={(event) => { event.preventDefault(); void send(); }}><div className="composer-input"><textarea value={input} onChange={(event) => setInput(event.target.value)} rows={1} placeholder="Ask about a car, an offer, or your requirements" onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send(); } }} /><button className="button button-primary" disabled={!input.trim() || Boolean(status)} aria-label="Send message"><ArrowUp size={18} /></button></div><small>Serra can make mistakes. Review prices and availability before deciding.</small></form>
        </main>
      </section>
    </div>
  );
}

function ComparisonCard({ compare, selected, quotes, requests }: { compare: CompareDraft; selected: string[]; quotes: ReturnType<typeof useDemoStore.getState>['quotes']; requests: ReturnType<typeof useDemoStore.getState>['requests'] }) {
  const requestIds = compare.requestIds?.length ? compare.requestIds : selected;
  const rows = requestIds.flatMap((requestId) => { const quote = quotes.filter((item) => item.requestId === requestId).sort((a, b) => Number(a.finalPrice) - Number(b.finalPrice))[0]; return quote ? [quote] : []; });
  return <section className="ai-result-card comparison-card"><div className="result-card-head"><div><span className="eyebrow">Serra comparison</span><h3>Best offer from each selected request</h3></div><span className="comparison-count">{rows.length} requests</span></div>{rows.map((quote, index) => { const request = requests.find((item) => item.id === quote.requestId); return <Link to={`/requests/${quote.requestId}`} className={`comparison-row ${index === 0 ? 'winner' : ''}`} key={quote.id}><span className="comparison-rank">{index === 0 ? <Trophy size={17} /> : index + 1}</span><span><strong>{request?.brand} {request?.model}</strong><small>{quote.dealerName} · {quote.rating}★</small></span><span><strong>{formatMoney(quote.finalPrice)}</strong><small>Best current OTD</small></span></Link>; })}<div className="comparison-insight"><Sparkles size={17} /><p><strong>Serra’s read:</strong> Compare total cost alongside use case, equipment, delivery confidence, and anything a dealer did not report—not price alone.</p></div></section>;
}

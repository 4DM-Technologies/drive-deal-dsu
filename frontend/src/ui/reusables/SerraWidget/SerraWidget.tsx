import { AnimatePresence, motion } from 'motion/react';
import { ArrowUp, Check, Expand, MessageCircle, Sparkles, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { client } from '@/services/platform/client';
import { BROWSER_STORAGE_KEYS } from '@/config/browser';
import { createId } from '@/helpers/ids';
import { SerraLogo } from '@/ui/reusables/SerraLogo/SerraLogo';

interface Message { id: string; role: 'user' | 'assistant'; body: string }

const suggestions = ['Help me choose a car', 'Compare my Bronco quotes', 'Build a buyer request'];

function CompactAnswer({ body }: { body: string }) {
  const lines = body.split('\n').map((line) => line.trim()).filter(Boolean);
  if (lines.length === 1) return <p>{body}</p>;
  return <div className="compact-answer">{lines.map((line, index) => line.startsWith('## ') ? <strong key={`${line}-${index}`}>{line.slice(3)}</strong> : line.startsWith('- ') ? <span key={`${line}-${index}`}><Check size={13} /> {line.slice(2)}</span> : <p key={`${line}-${index}`}>{line}</p>)}</div>;
}

export function SerraWidget() {
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [visible, setVisible] = useState(
    () => window.sessionStorage.getItem(BROWSER_STORAGE_KEYS.seraWidgetDismissed) !== 'true',
  );
  const [showNudge, setShowNudge] = useState(false);
  const [bump, setBump] = useState(false);
  const [input, setInput] = useState('');
  const [status, setStatus] = useState('');
  const [threadId, setThreadId] = useState<string>();
  const [userTurns, setUserTurns] = useState(0);
  const [messages, setMessages] = useState<Message[]>([
    { id: 'welcome', role: 'assistant', body: 'Hi, I’m Sera.\n- Find the right car\n- Compare dealer offers\n- Build a private request' },
  ]);
  const [preview, setPreview] = useState<Record<string, string> | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const streaming = Boolean(status);

  useEffect(() => {
    if (!visible) return;
    // The nudge floats above the launcher for 25 seconds, glides into it, and the launcher gives a small pulse.
    const show = window.setTimeout(() => setShowNudge(true), 1400);
    const leave = window.setTimeout(() => setShowNudge(false), 26_400);
    const pulse = window.setTimeout(() => setBump(true), 26_800);
    const calm = window.setTimeout(() => setBump(false), 27_700);
    return () => { [show, leave, pulse, calm].forEach((timer) => window.clearTimeout(timer)); };
  }, [visible]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, [messages, status]);

  if (!visible || location.pathname === '/chat' || location.pathname.startsWith('/chat/')) return null;

  function dismiss() {
    window.sessionStorage.setItem(BROWSER_STORAGE_KEYS.seraWidgetDismissed, 'true');
    setShowNudge(false);
    setOpen(false);
    setVisible(false);
  }

  async function send(value = input) {
    const text = value.trim();
    if (!text || streaming) return;
    setInput('');
    const nextTurn = userTurns + 1;
    setUserTurns(nextTurn);
    const assistantId = createId();
    let completedThread = threadId;
    setMessages((items) => [...items, { id: createId(), role: 'user', body: text }, { id: assistantId, role: 'assistant', body: '' }]);
    try {
      for await (const event of client.ai.chat({ message: text, ...(threadId ? { threadId } : {}) })) {
        if (event.type === 'status') setStatus(event.label);
        if (event.type === 'token') {
          setStatus('');
          setMessages((items) => items.map((item) => item.id === assistantId ? { ...item, body: item.body + event.text } : item));
        }
        if (event.type === 'card' && event.kind === 'requestPreview') setPreview(event.payload as Record<string, string>);
        if (event.type === 'done') {
          completedThread = event.threadId;
          setThreadId(event.threadId);
          setStatus('');
        }
      }
      if (nextTurn >= 3 && completedThread) navigate(`/chatbot?thread=${completedThread}`);
    } catch {
      setStatus('');
      setMessages((items) => items.map((item) => item.id === assistantId ? { ...item, body: '## I hit a connection problem\n- Your conversation is safe\n- Try sending that message again' } : item));
    }
  }

  const fullChatUrl = threadId ? `/chatbot?thread=${threadId}` : '/chatbot';
  return <>
    <AnimatePresence>{showNudge && !open && <motion.div className="ai-nudge" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 8, y: 52, scale: .45 }} style={{ originX: 1, originY: 1 }} transition={{ duration: .55, ease: [.65, 0, .35, 1] }}><button className="ai-nudge-main" onClick={() => { setOpen(true); setShowNudge(false); }}><span className="ai-nudge-icon"><Sparkles size={17} /></span><span><strong>Buying a car?</strong><small>Ask Sera to find, compare, or draft.</small></span></button><button className="ai-nudge-close" aria-label="Dismiss Sera advisor" onClick={dismiss}><X size={15} /></button></motion.div>}</AnimatePresence>
    <div className="ai-launcher"><motion.button className="ai-fab" animate={bump ? { scale: [1, 1.16, 1] } : { scale: 1 }} transition={{ duration: .7, ease: [.34, 1.56, .64, 1] }} onClick={() => setOpen((value) => !value)} aria-label={open ? 'Close Sera advisor' : 'Open Sera advisor'}>{open ? <X /> : <span className="ai-launcher-mark"><MessageCircle /><Sparkles size={13} /></span>}</motion.button>{!open && <button type="button" className="ai-launcher-dismiss" onClick={dismiss} aria-label="Hide Sera chat launcher"><X size={12} /></button>}</div>
    <AnimatePresence>{open && <motion.section className="ai-panel" initial={{ opacity: 0, y: 16, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10, scale: .98 }} transition={{ duration: .22 }} aria-label="Sera AI advisor"><header className="ai-header"><div className="ai-header-icon"><SerraLogo size={40} title={null} /></div><div className="ai-header-copy"><strong>Sera advisor</strong><span>Buyer guidance · you approve every action</span></div><Link className="button button-ghost button-sm" to={fullChatUrl} aria-label="Open full advisor"><Expand size={17} /></Link></header><div className="ai-messages" aria-live="polite">{messages.map((message) => <div key={message.id} className={`bubble bubble-${message.role === 'assistant' ? 'assistant' : 'user'}`}>{message.body ? <CompactAnswer body={message.body} /> : status ? null : '…'}</div>)}{status && <div className="thinking"><span className="dots"><i /><i /><i /></span><span>{status}</span></div>}{preview && <div className="ai-mini-card"><span className="eyebrow">Request ready to review</span><strong>{preview.brand} {preview.model}</strong><small>{preview.years} · {preview.budget}</small><Link to={fullChatUrl} className="button button-secondary button-sm"><Check size={14} /> Review draft</Link></div>}<div ref={endRef} /></div><div className="quick-prompts">{suggestions.map((suggestion) => <button className="quick-prompt" key={suggestion} onClick={() => void send(suggestion)}>{suggestion}</button>)}</div><form className="ai-composer" onSubmit={(event) => { event.preventDefault(); void send(); }}><input value={input} onChange={(event) => setInput(event.target.value)} placeholder="Ask Sera about your next car" aria-label="Message Sera" /><button className="button button-primary" disabled={!input.trim() || streaming} aria-label="Send message"><ArrowUp size={18} /></button></form></motion.section>}</AnimatePresence>
  </>;
}

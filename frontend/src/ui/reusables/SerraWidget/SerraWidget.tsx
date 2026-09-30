import { AnimatePresence, motion } from 'motion/react';
import { ArrowUp, Bot, Check, Expand, MessageCircle, Sparkles, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { client } from '@/services/platform/client';

interface Message { id: string; role: 'user' | 'assistant'; body: string }

const suggestions = ['Help me choose a car', 'Compare my Bronco quotes', 'Build a buyer request'];

export function SerraWidget() {
  const [open, setOpen] = useState(false);
  const [visible, setVisible] = useState(true);
  const [showNudge, setShowNudge] = useState(false);
  const [input, setInput] = useState('');
  const [status, setStatus] = useState('');
  const [messages, setMessages] = useState<Message[]>([
    { id: 'welcome', role: 'assistant', body: 'Hi, I’m Serra. Tell me what you want from your next car, or ask me to compare your dealer offers.' },
  ]);
  const [preview, setPreview] = useState<Record<string, string> | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const streaming = Boolean(status);

  useEffect(() => {
    if (!visible) return;
    const timer = window.setTimeout(() => setShowNudge(true), 1400);
    return () => window.clearTimeout(timer);
  }, [visible]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, status]);

  if (!visible) return null;

  async function send(value = input) {
    const text = value.trim();
    if (!text || streaming) return;
    setInput('');
    const assistantId = crypto.randomUUID();
    setMessages((items) => [...items, { id: crypto.randomUUID(), role: 'user', body: text }, { id: assistantId, role: 'assistant', body: '' }]);
    try {
      for await (const event of client.ai.chat({ message: text })) {
        if (event.type === 'status') setStatus(event.label);
        if (event.type === 'token') {
          setStatus('');
          setMessages((items) => items.map((item) => item.id === assistantId ? { ...item, body: item.body + event.text } : item));
        }
        if (event.type === 'card' && event.kind === 'requestPreview') setPreview(event.payload as Record<string, string>);
        if (event.type === 'done') setStatus('');
      }
    } catch {
      setStatus('');
      setMessages((items) => items.map((item) => item.id === assistantId ? { ...item, body: 'I couldn’t finish that reply. Please try again.' } : item));
    }
  }

  return (
    <>
      <AnimatePresence>
        {showNudge && !open && (
          <motion.div className="ai-nudge" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 12 }}>
            <button className="ai-nudge-main" onClick={() => { setOpen(true); setShowNudge(false); }}>
              <span className="ai-nudge-icon"><Sparkles size={17} /></span>
              <span><strong>Buying a car?</strong><small>Ask Serra to find, compare, or draft.</small></span>
            </button>
            <button className="ai-nudge-close" aria-label="Dismiss Serra advisor for now" onClick={() => { setShowNudge(false); setVisible(false); }}><X size={15} /></button>
          </motion.div>
        )}
      </AnimatePresence>
      <button className="ai-fab" onClick={() => setOpen((value) => !value)} aria-label={open ? 'Close Serra advisor' : 'Open Serra advisor'}>
        {open ? <X /> : <span className="ai-launcher-mark"><MessageCircle /><Sparkles size={13} /></span>}
      </button>
      <AnimatePresence>
        {open && (
          <motion.section className="ai-panel" initial={{ opacity: 0, y: 16, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10, scale: .98 }} transition={{ duration: .22 }} aria-label="Serra AI advisor">
            <header className="ai-header">
              <div className="ai-header-icon"><Bot size={20} /></div>
              <div className="ai-header-copy"><strong>Serra advisor</strong><span>Buyer guidance · you approve every action</span></div>
              <Link className="button button-ghost button-sm" to="/chatbot" aria-label="Open full advisor"><Expand size={17} /></Link>
            </header>
            <div className="ai-messages" aria-live="polite">
              {messages.map((message) => <div key={message.id} className={`bubble bubble-${message.role === 'assistant' ? 'assistant' : 'user'}`}>{message.body || (status ? null : '…')}</div>)}
              {status && <div className="thinking"><span className="dots"><i /><i /><i /></span><span>{status}</span></div>}
              {preview && <div className="ai-mini-card"><span className="eyebrow">Request ready to review</span><strong>{preview.brand} {preview.model}</strong><small>{preview.years} · {preview.budget}</small><Link to="/chatbot?prompt=request" className="button button-secondary button-sm"><Check size={14} /> Review draft</Link></div>}
              <div ref={endRef} />
            </div>
            <div className="quick-prompts">
              {suggestions.map((suggestion) => <button className="quick-prompt" key={suggestion} onClick={() => void send(suggestion)}>{suggestion}</button>)}
            </div>
            <form className="ai-composer" onSubmit={(event) => { event.preventDefault(); void send(); }}>
              <input value={input} onChange={(event) => setInput(event.target.value)} placeholder="Ask Serra about your next car" aria-label="Message Serra" />
              <button className="button button-primary" disabled={!input.trim() || streaming} aria-label="Send message"><ArrowUp size={18} /></button>
            </form>
          </motion.section>
        )}
      </AnimatePresence>
    </>
  );
}

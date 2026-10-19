import { AlertTriangle, Check, ChevronDown, Copy, Cpu, History, Timer, X, Zap } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { client } from '@/services/platform/client';
import type { AiTrace, AiTraceSpan } from '@/types/domain';

const pretty = (value: string) => value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());

/** Where a conversation's turn-by-turn history opens. */
const sessionPath = (threadId: string) => `/support-administration/sessions/${encodeURIComponent(threadId)}`;

export function TraceSpanCard({ span, index }: { span: AiTraceSpan; index: number }) {
  const details = span.details ?? {};
  const formatValue = (value: unknown) => typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  const hasDetails = details.input != null || details.output != null || details.error != null;
  const hasIo = details.input != null || details.output != null;
  const [ioView, setIoView] = useState<'input' | 'output'>(details.input != null ? 'input' : 'output');
  const ioValue = ioView === 'input' ? details.input : details.output;
  return <details className="trace-span-card" open={span.kind === 'llm'}><summary><span>{index + 1}</span><div><strong>{pretty(span.name)}</strong><small>{pretty(span.kind)} · {span.duration_ms.toLocaleString()} ms · {span.input_tokens.toLocaleString()} in / {span.output_tokens.toLocaleString()} out{span.model_name ? ` · ${span.model_name}` : ''}</small></div><span className={`trace-llm-flag ${details.llm_called ? 'yes' : ''}`}>{details.llm_called ? 'LLM' : 'No LLM'}</span><ChevronDown size={15} /></summary>{hasDetails && <div className="trace-span-body"><div className="trace-handoff"><span>Next handoff</span><strong>{pretty(String(details.next_step ?? 'response'))}</strong></div>{details.provider != null && <div className="trace-facts"><span>Provider <strong>{String(details.provider)}</strong></span><span>Prompt version <strong>{String(details.prompt_version ?? 'default')}</strong></span><span>Reasoning <strong>{String(details.reasoning_effort ?? 'default')}</strong></span><span>Attempts <strong>{String(details.attempt_count ?? 1)}</strong></span></div>}{hasIo && <div className="trace-io-switch" role="tablist" aria-label="Stage input or output"><button type="button" role="tab" aria-selected={ioView === 'input'} className={ioView === 'input' ? 'active' : ''} onClick={() => setIoView('input')}>Input</button><button type="button" role="tab" aria-selected={ioView === 'output'} className={ioView === 'output' ? 'active' : ''} onClick={() => setIoView('output')}>Output</button></div>}{hasIo && <section className="trace-io-card"><pre>{ioValue != null ? formatValue(ioValue) : 'Not recorded for this stage.'}</pre></section>}{details.error != null && <section className="trace-error-block"><h4>Error</h4><pre>{formatValue(details.error)}</pre></section>}</div>}</details>;
}

/** The thread id with a one-click copy, so it can be pasted into a ticket or a database query. */
export function ThreadIdChip({ threadId }: { threadId: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard?.writeText(threadId).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    }).catch(() => undefined);
  };
  return <button type="button" className="thread-id-chip" onClick={copy} title="Copy thread ID" aria-label={copied ? 'Thread ID copied' : `Copy thread ID ${threadId}`}>
    <code>{threadId}</code>{copied ? <Check size={13} /> : <Copy size={13} />}
  </button>;
}

/**
 * One trace's full execution path. Opened from the AI logs table and from a conversation's session page.
 * `showConversationLink` adds the button that opens every turn of this trace's conversation.
 * Render it with `key={trace.id}` so switching traces starts from a clean loading state.
 */
export function TraceDrawer({ trace, onClose, showConversationLink = true }: { trace: AiTrace; onClose: () => void; showConversationLink?: boolean }) {
  const [detail, setDetail] = useState<AiTrace | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    void client.administration.trace(trace.id)
      .then((value) => { if (active) setDetail(value); })
      .catch((cause: Error) => { if (active) setError(cause.message); });
    return () => { active = false; };
  }, [trace.id, attempt]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const threadId = detail?.session?.thread_id ?? trace.thread_id;
  const sessionTitle = detail?.session?.title;

  return <div className="trace-drawer-backdrop" onMouseDown={onClose}>
    <aside className="trace-drawer" role="dialog" aria-modal="true" aria-label={`Trace details for ${trace.query}`} onMouseDown={(event) => event.stopPropagation()}>
      <header>
        <div className="trace-drawer-title">
          <span>Trace {trace.id.slice(0, 8)}</span>
          <h3>{trace.query}</h3>
          {threadId && <div className="trace-drawer-session">
            <span className="trace-drawer-session-label">Session</span>
            <strong>{sessionTitle ?? (detail || error ? 'Untitled conversation' : 'Loading session…')}</strong>
            <ThreadIdChip threadId={threadId} />
          </div>}
        </div>
        <div className="trace-drawer-actions">
          {showConversationLink && threadId && <Link className="button button-sm trace-conversation-link" to={sessionPath(threadId)}><History size={15} /> View full conversation</Link>}
          <button type="button" className="trace-drawer-close" onClick={onClose} aria-label="Close trace details"><X /></button>
        </div>
      </header>
      {error ? <div className="trace-detail-error"><AlertTriangle size={18} /><div><strong>Trace details could not be loaded</strong><p>{error}</p></div><button className="button button-secondary button-sm" onClick={() => { setError(''); setAttempt((value) => value + 1); }}>Retry</button></div>
        : !detail ? <div className="trace-detail-loading"><span /><strong>Loading agent stages</strong></div>
          : <>
            {detail.status === 'failed' && <div className="trace-failure-banner" role="alert"><AlertTriangle size={17} /><div><strong>This trace failed: an AI model call returned an error</strong><p>The buyer was sent a fallback reply instead of a model answer.</p>{detail.error_message && <code>{detail.error_message}</code>}</div></div>}
            <div className="trace-detail-metrics"><span><Timer size={15} /> {detail.duration_ms.toLocaleString()} ms</span><span><Zap size={15} /> {detail.input_tokens.toLocaleString()} in</span><span><Zap size={15} /> {detail.output_tokens.toLocaleString()} out</span><span><Cpu size={15} /> {detail.model_name ?? 'No model'}</span></div>
            <div className="trace-flow verbose-trace-flow">{(detail.spans ?? []).map((span, index) => <TraceSpanCard key={span.id} span={span} index={index} />)}</div>
            {(detail.spans ?? []).length === 0 && <p className="muted">No agent spans were recorded for this trace.</p>}
          </>}
    </aside>
  </div>;
}

import { Activity, AlertTriangle, ArrowDownToLine, ArrowLeft, ArrowUpFromLine, MessagesSquare, RefreshCw, Search, Timer, UserRound, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { traceStatusClass } from '@/helpers/traceStatus';
import { client } from '@/services/platform/client';
import { PageLoading } from '@/ui/reusables/PageLoading/PageLoading';
import type { AiTrace, AiTraceSession } from '@/types/domain';
import './AdministrationScreen.css';
import { ThreadIdChip, TraceDrawer } from './TraceDrawer';

const pretty = (value: string) => value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
const LOGS_PATH = '/support-administration?tab=logs';

/** Every message of one Sera conversation, newest first. Each row opens the same trace drawer as the AI logs tab. */
export default function ConversationSessionScreen() {
  const { threadId = '' } = useParams();
  // The result remembers which thread it belongs to, so a new thread id shows the loader instead of stale turns.
  const [result, setResult] = useState<{ threadId: string; session: AiTraceSession | null; error: string } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<AiTrace | null>(null);
  const closeTrace = useCallback(() => setSelected(null), []);
  const load = () => { setRefreshing(true); setReloadKey((value) => value + 1); };

  useEffect(() => {
    let active = true;
    void client.administration.session(threadId)
      .then((session) => { if (active) setResult({ threadId, session, error: '' }); })
      .catch((cause: Error) => { if (active) setResult({ threadId, session: null, error: cause.message }); })
      .finally(() => { if (active) setRefreshing(false); });
    return () => { active = false; };
  }, [threadId, reloadKey]);

  const current = result?.threadId === threadId ? result : null;
  const session = current?.session ?? null;
  const error = current?.error ?? '';
  const loading = refreshing || !current;
  if (!current) return <PageLoading label="Loading conversation" />;

  const back = <Link className="session-back" to={LOGS_PATH}><ArrowLeft size={15} /> Back to AI logs</Link>;
  if (!session) {
    return <main className="admin-page"><div className="shell admin-workspace"><section className="admin-section session-page">
      {back}
      <div className="trace-detail-error"><AlertTriangle size={18} /><div><strong>This conversation could not be loaded</strong><p>{error || 'No AI traces were recorded for this conversation.'}</p></div><button className="button button-secondary button-sm" onClick={load}>Retry</button></div>
    </section></div></main>;
  }

  const terms = query.trim().toLowerCase();
  // The API returns the conversation oldest first; number each message in that order, then show the newest on top.
  const turns = session.traces.map((trace, index) => ({ trace, turn: index + 1 })).reverse();
  const visible = terms ? turns.filter(({ trace }) => `${trace.query} ${trace.reply_preview ?? ''} ${trace.route} ${trace.model_name} ${trace.status}`.toLowerCase().includes(terms)) : turns;
  const { totals } = session;
  const when = (value: string | null) => value ? new Date(value).toLocaleString() : '—';

  return <main className="admin-page">
    <div className="shell admin-workspace">
      <section className="admin-section session-page">
        {back}
        <div className="admin-section-head">
          <div>
            <span className="eyebrow">{session.type_label} · Conversation</span>
            <h2>{session.title}</h2>
            <p>{totals.turns.toLocaleString()} {totals.turns === 1 ? 'message' : 'messages'} · Started {when(session.started_at)} · Last activity {when(session.last_activity_at)}</p>
          </div>
          <button className="button button-secondary button-sm" onClick={load} disabled={loading}><RefreshCw size={15} /> {loading ? 'Refreshing…' : 'Refresh'}</button>
        </div>
        <div className="session-meta">
          <div><UserRound size={16} /><span><small>User</small><strong>{session.user ? session.user.name : 'Unknown user'}</strong>{session.user && <small>{session.user.email} · {pretty(session.user.role)}</small>}</span></div>
          <div><MessagesSquare size={16} /><span><small>Thread / session ID</small><ThreadIdChip threadId={session.thread_id} /></span></div>
        </div>
        <div className="trace-summary">
          <article><Activity size={17} /><span><small>Conversation messages</small><strong>{totals.turns.toLocaleString()}</strong></span></article>
          <article><Timer size={17} /><span><small>Average duration</small><strong>{totals.average_duration_ms.toLocaleString()} ms</strong></span></article>
          <article><ArrowDownToLine size={17} /><span><small>Input tokens</small><strong>{totals.input_tokens.toLocaleString()}</strong></span></article>
          <article><ArrowUpFromLine size={17} /><span><small>Output tokens</small><strong>{totals.output_tokens.toLocaleString()}</strong></span></article>
          <article><X size={17} /><span><small>Failed</small><strong>{totals.failed.toLocaleString()}</strong></span></article>
        </div>
        <label className="admin-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search this conversation" aria-label="Search this conversation" /></label>
        <div className="trace-table session-trace-table">
          <div className="trace-row trace-head"><span>Message · buyer query and Sera reply</span><span>Route / model</span><span>Tokens</span><span>Duration</span><span>Status</span></div>
          {visible.map(({ trace, turn }) => <button type="button" className={`trace-row ${selected?.id === trace.id ? 'selected' : ''}`} key={trace.id} onClick={() => setSelected(trace)}>
            <span className="session-turn">
              <b aria-label={`Message ${turn}`}>{turn}</b>
              <span>
                <strong>{trace.query}</strong>
                <small>{new Date(trace.created_at).toLocaleString()}{trace.is_test ? ' · Test run' : ''}</small>
                <em className={trace.reply_preview ? '' : 'is-empty'}>{trace.reply_preview ? <>Sera: {trace.reply_preview}</> : 'No saved reply for this message'}</em>
              </span>
            </span>
            <span><strong>{pretty(trace.route ?? 'pending')}</strong><small>{trace.model_name ?? 'No model call'}</small></span>
            <span>{(trace.input_tokens + trace.output_tokens).toLocaleString()}</span>
            <span>{trace.duration_ms.toLocaleString()} ms</span>
            <span className={`status ${traceStatusClass(trace.status)}`}>{pretty(trace.status)}</span>
          </button>)}
          {visible.length === 0 && <p className="session-empty">No messages match “{query}”.</p>}
        </div>
      </section>
    </div>
    {selected && <TraceDrawer key={selected.id} trace={selected} onClose={closeTrace} showConversationLink={false} />}
  </main>;
}

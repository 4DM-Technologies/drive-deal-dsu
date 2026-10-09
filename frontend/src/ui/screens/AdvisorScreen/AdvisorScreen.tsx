/* eslint-disable react-refresh/only-export-components -- response formatting helpers are exported for focused tests */
import { ArrowUp, CheckCircle2, FileCheck2, History, Menu, MoreHorizontal, Pencil, Plus, Sparkles, Square, Trash2, Trophy, X } from 'lucide-react';
import { Children, isValidElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import Markdown from 'react-markdown';
import { Link, useSearchParams } from 'react-router-dom';
import remarkGfm from 'remark-gfm';
import { formatMoney } from '@/helpers/currency';
import { relativeTime } from '@/helpers/dateTime';
import { createId } from '@/helpers/ids';
import { gateReasonFor, postingGate } from '@/helpers/subscription';
import { client } from '@/services/platform/client';
import { useDemoStore } from '@/services/platform/demoStore';
import { CompareIcon } from '@/ui/reusables/Icons/CompareIcon';
import { SerraLoader } from '@/ui/reusables/PageLoading/PageLoading';
import { SerraLogo } from '@/ui/reusables/SerraLogo/SerraLogo';
import { QuestionCard } from '@/ui/reusables/QuestionCard/QuestionCard';
import { UpgradePrompt } from '@/ui/reusables/UpgradePrompt/UpgradePrompt';
import type { AiMessage, AiThread, BuyerRequest, GuidedAnswers, Quote } from '@/types/domain';
import { useGuidedCard } from './useGuidedCard';

type RequestDraft = Record<string, string>;
interface CompareDraft { leader?: string; total?: string; difference?: string; requestIds?: string[]; quoteIds?: string[] }
interface VehicleMedia { image_url: string; thumbnail_url?: string; source_url: string; source_name?: string; alt?: string }
interface VehicleSource { url: string; title: string }
interface ThreadResponseUi { draft?: RequestDraft | null; compare?: CompareDraft | null; media?: VehicleMedia[]; sources?: VehicleSource[]; questionPayload?: unknown; published?: boolean; postGate?: ReturnType<typeof postingGate> }
type CompareMode = 'requests' | 'dealers';
type CompareSelection = { requestIds?: string[]; quoteIds?: string[] };
type GuidedStep = 'start' | 'card' | 'review' | 'complete';
const START_OPTIONS = ['I know the car I want', 'Help me choose', 'Ask Sera a question'];
const HIDDEN_DRAFT_FIELDS = new Set(['stateId', 'brandId']);
const DRAFT_LABELS: Record<string, string> = { mustHaves: 'Must-haves', fuelType: 'Fuel', transmission: 'Transmission', drivetrain: 'Drivetrain', additionalInformation: 'Additional details', bodyType: 'Body style', budgetMin: 'Budget from', budgetMax: 'Budget up to', years: 'Model year' };
const IMAGE_CACHE_PREFIX = 'sera-vehicle-image:';

function vehicleImageQuery(draft: RequestDraft | null | undefined): string {
  if (!draft?.brand || !draft.model || draft.model === 'Vehicle' || draft.model === 'Open to recommendations') return '';
  return `${draft.years ? `${draft.years} ` : ''}${draft.brand} ${draft.model}`.trim();
}

function readVehicleImageCache(userId: string | undefined, query: string): { items: VehicleMedia[]; status: 'found' | 'not_found' | 'unavailable' } | null {
  if (!userId || !query) return null;
  try {
    const raw = window.sessionStorage.getItem(`${IMAGE_CACHE_PREFIX}${userId}:${query.toLowerCase()}`);
    if (!raw) return null;
    const cached = JSON.parse(raw) as { expiresAt: number; items: VehicleMedia[]; status: 'found' | 'not_found' | 'unavailable' };
    if (cached.expiresAt <= Date.now() || !Array.isArray(cached.items)) {
      window.sessionStorage.removeItem(`${IMAGE_CACHE_PREFIX}${userId}:${query.toLowerCase()}`);
      return null;
    }
    return cached;
  } catch { return null; }
}

function writeVehicleImageCache(userId: string | undefined, query: string, items: VehicleMedia[], status: 'found' | 'not_found' | 'unavailable') {
  if (!userId || !query) return;
  // Positive and clean negative results stay warm for a session; provider outages only cool down briefly.
  const ttl = status === 'unavailable' ? 60_000 : 6 * 60 * 60 * 1000;
  try { window.sessionStorage.setItem(`${IMAGE_CACHE_PREFIX}${userId}:${query.toLowerCase()}`, JSON.stringify({ items, status, expiresAt: Date.now() + ttl })); } catch { /* The search still works if browser storage is full or disabled. */ }
}

/** Saved chats from before the question card used per-field steps; they reopen at the greeting choices. */
function normalizeGuidedStep(value: unknown): GuidedStep | null {
  return value === 'start' || value === 'card' || value === 'review' || value === 'complete' ? value : null;
}

const compareOffersPrompt = 'Compare offers on my requests';
const prompts = ['Find a family SUV for me', compareOffersPrompt, 'Help me build a buyer request', 'What should I ask a dealer?'];
const greeting = 'Hi, I’m Sera, your car buying advisor. What car are you looking for? Choose a path below, or ask me a question.';
type ActivityPhase = 'classifying' | 'searching' | 'crawling' | 'composing';

const activity: Record<ActivityPhase, string> = {
  classifying: 'Thinking',
  searching: 'Searching vehicle sources',
  crawling: 'Searching trusted sources',
  composing: 'Preparing response',
};

function ActivityStatus({ label }: { label: string }) {
  return <span className="agent-status" role="status"><span>{label}</span><span className="status-dots" aria-hidden="true"><i /><i /><i /></span></span>;
}

function Answer({ body }: { body: string }) {
  return <div className="answer-markdown"><Markdown remarkPlugins={[remarkGfm]} components={{
    a: ({ children, ...props }) => <a {...props} target="_blank" rel="noreferrer">{children}</a>,
    p: ({ children, ...props }) => {
      const first = Children.toArray(children)[0];
      const label = isValidElement<{ children?: ReactNode }>(first) ? Children.toArray(first.props.children).join('') : '';
      return <p {...props} className={label.toLowerCase().startsWith('bottom line') ? 'answer-takeaway' : undefined}>{children}</p>;
    },
    table: ({ children, ...props }) => <div className="answer-table-wrap" role="region" aria-label="Scrollable comparison table" tabIndex={0}><table {...props}>{children}</table></div>,
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
    ['budget', ['budget', 'budget_max']], ['area', ['area', 'buyer_area']], ['state', ['state']],
    ['timeline', ['timeline']], ['mustHaves', ['mustHaves', 'must_haves']], ['bodyType', ['bodyType', 'body_type']],
    ['fuelType', ['fuelType', 'fuel_type']], ['transmission', ['transmission']],
    ['additionalInformation', ['additionalInformation', 'additional_information']],
  ];
  const draft: RequestDraft = {};
  for (const [label, keys] of aliases) {
    const value = keys.map((key) => source[key]).find((item) => item !== undefined && item !== null && item !== '');
    if (typeof value === 'string' || typeof value === 'number') draft[label] = String(value);
    else if (Array.isArray(value) && value.every((item) => typeof item === 'string')) draft[label] = value.join(', ');
  }
  return Object.keys(draft).length ? draft : null;
}

export function hasGuidedHistoryOptions(options: string[] | undefined): boolean {
  return (options?.length ?? 0) > 0;
}

export default function AdvisorScreen() {
  const session = useDemoStore((state) => state.session);
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
  const [streamingThreadId, setStreamingThreadId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(initialSelected.length > 0);
  const [compareMode, setCompareMode] = useState<CompareMode>(initialSelected.length >= 2 ? 'requests' : 'dealers');
  const [selectedQuoteIds, setSelectedQuoteIds] = useState<string[]>([]);
  const [dealerRequestId, setDealerRequestId] = useState<string | null>(null);
  const [draft, setDraft] = useState<RequestDraft | null>(null);
  const [compare, setCompare] = useState<CompareDraft | null>(null);
  const [media, setMedia] = useState<VehicleMedia[]>([]);
  const [sources, setSources] = useState<VehicleSource[]>([]);
  const [editing, setEditing] = useState(false);
  const [published, setPublished] = useState(false);
  const [publishingRequest, setPublishingRequest] = useState(false);
  const [publishError, setPublishError] = useState('');
  // Sera attaches the buyer's posting gate to each request preview; a blocked buyer sees an upgrade prompt instead of the post button.
  const [postGate, setPostGate] = useState<ReturnType<typeof postingGate>>(null);
  const [guidedStep, setGuidedStep] = useState<GuidedStep | null>(null);
  const [imageLoading, setImageLoading] = useState(false);
  const [imageSearchStatus, setImageSearchStatus] = useState<'idle' | 'loading' | 'found' | 'not_found' | 'unavailable'>('idle');
  const [imageAttempt, setImageAttempt] = useState(0);
  const [publishedRequestId, setPublishedRequestId] = useState<string | null>(null);
  const postBlocked = postGate?.allowed === false;
  const [threadMenuId, setThreadMenuId] = useState<string | null>(null);
  const [deletingThreadId, setDeletingThreadId] = useState<string | null>(null);
  const [threadActionError, setThreadActionError] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const threadIdRef = useRef(threadId);
  const displayedMessagesRef = useRef(messages);
  const streamingThreadIdRef = useRef<string | null>(null);
  const streamedMessagesByThreadRef = useRef<Record<string, AiMessage[]>>({});
  const responseUiByThreadRef = useRef<Record<string, ThreadResponseUi>>({});
  const threadOpenRunRef = useRef(0);
  const activeRunRef = useRef(0);
  const activeAssistantIdRef = useRef<string | null>(null);
  const activeGuidedQueryRef = useRef('');
  const dismissedGuidedQueryRef = useRef('');
  const lastSentQueryRef = useRef('');
  const guidedCancelledRef = useRef(false);
  const guidedSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const savedGuidedSignatureRef = useRef<Record<string, string>>({});
  const initialThreadIdRef = useRef<string | null>(null);
  const restoredImageQueryRef = useRef('');
  const guidedOwnedThreadRef = useRef(false);
  const completedCompareRef = useRef(false);
  const greetingRunRef = useRef(0);
  const compareDrawerRef = useRef<HTMLElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const sendRef = useRef<(text: string) => void>(() => undefined);
  useEffect(() => { displayedMessagesRef.current = messages; }, [messages]);
  const appendTranscript = useCallback((lines: Array<{ role: 'assistant' | 'user'; body: string }>) => {
    setMessages((items) => [...items, ...lines.map((line) => ({ id: createId(), ...line }))]);
  }, []);
  function updateStreamTranscript(id: string, update: (items: AiMessage[]) => AiMessage[]) {
    const current = streamedMessagesByThreadRef.current[id] ?? (threadIdRef.current === id ? displayedMessagesRef.current : []);
    const next = update(current);
    streamedMessagesByThreadRef.current[id] = next;
    if (threadIdRef.current === id) setMessages(next);
  }
  const showDraft = useCallback((result: Record<string, string>) => {
    restoredImageQueryRef.current = '';
    setDraft(result);
    setPublished(false);
    setGuidedStep('review');
    setMessages((items) => [...items, { id: createId(), role: 'assistant', body: 'Here’s your request. Check the details, edit anything, then send it to matching dealers.' }]);
  }, []);
  const card = useGuidedCard({
    onTranscript: appendTranscript,
    onDraft: showDraft,
    onUnresolved: (text) => {
      guidedCancelledRef.current = true;
      setGuidedStep(null);
      sendRef.current(text);
    },
  });
  const requestGroups = useMemo(() => requests.map((request) => ({ request, quotes: quotes.filter((quote) => quote.requestId === request.id) })).filter((group) => group.quotes.length >= 1), [quotes, requests]);
  const dealerGroups = useMemo(() => requestGroups.filter((group) => group.quotes.length >= 2), [requestGroups]);
  const activeDealerRequestId = dealerRequestId ?? dealerGroups[0]?.request.id ?? null;
  const activeDealerGroup = dealerGroups.find((group) => group.request.id === activeDealerRequestId);
  const canCompare = compareMode === 'requests' ? selected.length >= 2 : selectedQuoteIds.length >= 2;
  const compareCount = compareMode === 'requests' ? selected.length : selectedQuoteIds.length;

  const refreshThreads = useCallback(async () => {
    try { setThreads(await client.ai.threads()); } catch { setThreads([]); } finally { setThreadsLoading(false); }
  }, []);

  const cancelActiveResponse = useCallback((showNotice = false) => {
    const controller = abortControllerRef.current;
    if (!controller || controller.signal.aborted) return;
    controller.abort();
    abortControllerRef.current = null;
    streamingThreadIdRef.current = null;
    activeRunRef.current += 1;
    const assistantId = activeAssistantIdRef.current;
    activeAssistantIdRef.current = null;
    setActiveAssistantId(null);
    if (assistantId) setMessages((items) => items.filter((item) => item.id !== assistantId || Boolean(item.body)));
    setStreaming(false);
    setStreamingThreadId(null);
    setStatus('');
    setStopped(showNotice);
  }, []);

  const streamGreeting = useCallback(() => {
    ++greetingRunRef.current;
    const id = createId();
    setMessages([{ id, role: 'assistant', body: greeting, guidedStep: 'start', options: START_OPTIONS }]);
  }, []);

  const restoreGuidedFlow = useCallback((id: string) => {
    try {
      const saved = window.localStorage.getItem(`sera-guided-${session?.id}-${id}`);
      if (!saved) { setGuidedStep(null); setPublishedRequestId(null); setPublished(false); return; }
      const flow = JSON.parse(saved) as { guidedStep?: unknown; draft?: RequestDraft | null; messages?: AiMessage[]; publishedRequestId?: string | null; cardAnswers?: GuidedAnswers | null };
      const step = normalizeGuidedStep(flow.guidedStep);
      setGuidedStep(step);
      setDraft(flow.draft ?? null);
      setPublishedRequestId(flow.publishedRequestId ?? null);
      setPublished(Boolean(flow.publishedRequestId));
      if (flow.messages?.length) setMessages(flow.messages);
      if (step === 'card' && flow.cardAnswers) void card.restore(flow.cardAnswers);
    } catch { setGuidedStep(null); }
  }, [card, session]);

  const openThread = useCallback(async (id: string) => {
    const openRun = ++threadOpenRunRef.current;
    ++greetingRunRef.current;
    guidedCancelledRef.current = false;
    activeGuidedQueryRef.current = '';
    dismissedGuidedQueryRef.current = '';
    lastSentQueryRef.current = '';
    const isGeneratingThisThread = streamingThreadIdRef.current === id;
    restoredImageQueryRef.current = '';
    setImageAttempt(0);
    threadIdRef.current = id;
    if (!isGeneratingThisThread) {
      setDraft(null);
      setMedia([]); setSources([]);
      setPostGate(null);
      setPublished(false); setPublishedRequestId(null); setEditing(false); card.close(); setGuidedStep(null);
      setCompare(null);
    }
    setThreadLoading(true);
    try {
      if (isGeneratingThisThread) {
        guidedOwnedThreadRef.current = true;
        setThreadId(id);
        setMessages(streamedMessagesByThreadRef.current[id] ?? []);
        const responseUi = responseUiByThreadRef.current[id];
        setDraft(responseUi?.draft ?? null);
        setCompare(responseUi?.compare ?? null);
        setMedia(responseUi?.media ?? []);
        setSources(responseUi?.sources ?? []);
        setPostGate(responseUi?.postGate ?? null);
        setPublished(Boolean(responseUi?.published));
        if (responseUi?.questionPayload) { setGuidedStep('card'); card.open(responseUi.questionPayload); }
      } else {
        const thread = await client.ai.thread(id);
        if (threadOpenRunRef.current !== openRun) return;
        guidedOwnedThreadRef.current = Boolean(thread.guidedState);
        streamedMessagesByThreadRef.current[id] = thread.messages;
        setThreadId(thread.id);
        setMessages(thread.messages);
        if (thread.guidedState) {
          const step = normalizeGuidedStep(thread.guidedState.guidedStep);
          setGuidedStep(step);
          const restoredDraft = (thread.requestContext as RequestDraft | null) ?? null;
          restoredImageQueryRef.current = vehicleImageQuery(restoredDraft);
          setDraft(restoredDraft);
          const cardAnswers = thread.guidedState.cardAnswers as GuidedAnswers | null | undefined;
          if (step === 'card' && cardAnswers) void card.restore(cardAnswers);
          setPublishedRequestId((thread.guidedState.publishedRequestId as string | null) ?? null);
          setPublished(Boolean(thread.guidedState.publishedRequestId));
          savedGuidedSignatureRef.current[id] = JSON.stringify({
            messages: thread.messages.slice(-200),
            guidedState: {
              guidedStep: step,
              cardAnswers: cardAnswers ?? null,
              publishedRequestId: thread.guidedState.publishedRequestId ?? null,
            },
            requestContext: thread.requestContext ?? null,
          });
        } else {
          restoreGuidedFlow(thread.id);
          try {
            const localFlow = JSON.parse(window.localStorage.getItem(`sera-guided-${session?.id}-${id}`) ?? 'null') as { draft?: RequestDraft | null } | null;
            restoredImageQueryRef.current = vehicleImageQuery(localFlow?.draft);
          } catch { restoredImageQueryRef.current = ''; }
        }
        const responseUi = responseUiByThreadRef.current[id];
        if (responseUi) {
          setCompare(responseUi.compare ?? null);
          setMedia(responseUi.media ?? []);
          setSources(responseUi.sources ?? []);
          setPostGate(responseUi.postGate ?? null);
          setDraft(responseUi.draft ?? (thread.requestContext as RequestDraft | null) ?? null);
          if (responseUi.published) setPublished(true);
          if (responseUi.questionPayload) { setGuidedStep('card'); card.open(responseUi.questionPayload); }
        }
      }
      setSidebarOpen(false);
      setParams({ thread: id }, { replace: true });
    } catch {
      if (threadOpenRunRef.current !== openRun) return;
      threadIdRef.current = id;
      setThreadId(id);
      const saved = session?.id ? window.localStorage.getItem(`sera-guided-${session.id}-${id}`) : null;
      guidedOwnedThreadRef.current = Boolean(saved);
      if (saved) {
        restoreGuidedFlow(id);
        try { restoredImageQueryRef.current = vehicleImageQuery((JSON.parse(saved) as { draft?: RequestDraft | null }).draft); } catch { restoredImageQueryRef.current = ''; }
      }
      else { streamGreeting(); setGuidedStep('start'); }
    } finally {
      if (threadOpenRunRef.current === openRun) setThreadLoading(false);
    }
  }, [card, restoreGuidedFlow, session, setParams, streamGreeting]);

  // This is an intentional mount-only bootstrap; each function owns cancellation/error handling.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshThreads();
    void client.requests.list().then(setRequests).catch(() => setRequests([]));
    void client.quotes.list().then(setQuotes).catch(() => setQuotes([]));
    const initialThread = params.get('thread');
    if (initialThread) void openThread(initialThread);
    else {
      const id = initialThreadIdRef.current ?? createId();
      initialThreadIdRef.current = id;
      threadIdRef.current = id;
      guidedOwnedThreadRef.current = true;
      setThreadId(id);
      setParams({ thread: id }, { replace: true });
      streamGreeting();
      setGuidedStep('start');
    }
  // The bootstrap must not restart when callbacks receive new state closures.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!session?.id || streaming) return;
    const key = `sera-guided-${session.id}-${threadId ?? 'new'}`;
    try {
      window.localStorage.setItem(key, JSON.stringify({ guidedStep, draft, messages, publishedRequestId, cardAnswers: card.answers }));
    } catch { /* Browser storage can be unavailable; the current chat remains usable. */ }
  }, [session?.id, threadId, guidedStep, draft, messages, publishedRequestId, card.answers, streaming]);
  useEffect(() => {
    if (!session?.id || !guidedOwnedThreadRef.current || !threadId || !messages.length || streaming || (guidedStep === null && !draft && !guidedCancelledRef.current) || completedCompareRef.current) return;
    // A fresh greeting is a local draft, not a saved conversation. Create a history item only after
    // the buyer has actually sent something or started a guided request.
    const hasBuyerActivity = messages.some((message) => message.role === 'user') || Boolean(draft) || guidedCancelledRef.current;
    if (!hasBuyerActivity) return;
    const snapshot = {
      threadId,
      messages: messages.slice(-200),
      guidedState: { guidedStep, cardAnswers: card.answers, publishedRequestId },
      requestContext: draft,
    };
    const signature = JSON.stringify({
      messages: snapshot.messages,
      guidedState: {
        guidedStep,
        cardAnswers: card.answers ?? null,
        publishedRequestId: publishedRequestId ?? null,
      },
      requestContext: draft ?? null,
    });
    if (savedGuidedSignatureRef.current[threadId] === signature) return;
    const timer = window.setTimeout(() => {
      guidedSaveQueueRef.current = guidedSaveQueueRef.current
        .then(() => client.ai.saveGuidedCheckpoint(snapshot))
        .then(() => {
          savedGuidedSignatureRef.current[threadId] = signature;
          guidedCancelledRef.current = false;
          const firstBuyerMessage = messages.find((message) => message.role === 'user')?.body?.trim();
          const title = draft?.brand
            ? `Buying request: ${[draft.brand, draft.model && draft.model !== 'Open to recommendations' ? draft.model : ''].filter(Boolean).join(' ')}`
            : firstBuyerMessage?.slice(0, 72) || 'New Sera chat';
          setThreads((items) => {
            const existing = items.find((item) => item.id === threadId);
            const updated: AiThread = { id: threadId, type: 'sera', title, updatedAt: new Date().toISOString(), messages: existing?.messages ?? [] };
            return [updated, ...items.filter((item) => item.id !== threadId)];
          });
        })
        .catch(() => { /* Local storage remains a recovery copy if the service is unavailable. */ });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [session?.id, threadId, messages, streaming, guidedStep, card.answers, publishedRequestId, draft]);
  useEffect(() => {
    const query = vehicleImageQuery(draft);
    if (!query) return;
    const isRetry = imageAttempt > 0;
    const restored = restoredImageQueryRef.current.toLowerCase() === query.toLowerCase();
    let active = true;
    if (restored && !isRetry) {
      const cached = readVehicleImageCache(session?.id, query);
      // Restoring a saved request must not trigger a model/search call. Reuse this session's
      // result when present; otherwise leave the optional image area quiet until the user retries.
      queueMicrotask(() => {
        if (!active) return;
        setMedia(cached?.items ?? []);
        setImageSearchStatus(cached?.status ?? 'idle');
        setImageLoading(false);
      });
      return () => { active = false; };
    }
    const cached = !isRetry ? readVehicleImageCache(session?.id, query) : null;
    if (cached) {
      queueMicrotask(() => {
        if (!active) return;
        setMedia(cached.items);
        setImageSearchStatus(cached.status);
        setImageLoading(false);
      });
      return () => { active = false; };
    }
    // Start the UI loading state with the request lifecycle; the image search runs asynchronously.
    queueMicrotask(() => {
      if (!active) return;
      setImageLoading(true);
      setImageSearchStatus('loading');
      setMedia([]);
    });
    void client.ai.vehicleImages(query).then((result) => {
      if (active) {
        setMedia(result.items);
        setImageSearchStatus(result.status);
        writeVehicleImageCache(session?.id, query, result.items, result.status);
        if (threadIdRef.current) responseUiByThreadRef.current[threadIdRef.current] = { ...responseUiByThreadRef.current[threadIdRef.current], media: result.items };
      }
    }).catch(() => {
      if (active) {
        setMedia([]);
        setImageSearchStatus('unavailable');
      }
    }).finally(() => { if (active) setImageLoading(false); });
    return () => { active = false; };
  }, [draft, imageAttempt, session?.id, threadId]);
  // A route change or browser tab switch must not abort a response. Explicit Stop and thread deletion still cancel it.

  // The compare panel is a modal drawer: focus it when it opens and let Escape close it.
  useEffect(() => {
    if (!compareOpen) return;
    compareDrawerRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setCompareOpen(false); };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [compareOpen]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, [messages, status, draft, compare]);

  function newChat() {
    ++threadOpenRunRef.current;
    ++greetingRunRef.current;
    const id = createId();
    threadIdRef.current = id;
    activeGuidedQueryRef.current = '';
    dismissedGuidedQueryRef.current = '';
    lastSentQueryRef.current = '';
    guidedCancelledRef.current = false;
    restoredImageQueryRef.current = '';
    setImageAttempt(0);
    guidedOwnedThreadRef.current = true;
    completedCompareRef.current = false;
    setDraft(null); setMedia([]); setSources([]); setPostGate(null); setCompare(null); setSelected([]); setSelectedQuoteIds([]); setThreadId(id); setPublished(false); setEditing(false); card.close(); setGuidedStep('start'); setPublishedRequestId(null); setSidebarOpen(false); setParams({ thread: id }, { replace: true });
    streamGreeting();
  }

  function beginGuidedFlow(mode: 'known' | 'explore') {
    guidedCancelledRef.current = false;
    setDraft(null); setPublished(false); setPublishedRequestId(null); setMedia([]);
    if (session?.subscription) setPostGate({ allowed: session.subscription.canCreate, reason: session.subscription.canCreate ? null : gateReasonFor(session.subscription) });
    guidedOwnedThreadRef.current = true;
    setMessages((items) => [...items, { id: createId(), role: 'user', body: mode === 'known' ? 'I know the car I want' : 'Help me choose a car' }]);
    setGuidedStep('card');
    void card.start(mode === 'known' ? 'button' : 'explore');
  }

  function chooseStartOption(value: string) {
    if (value === 'I know the car I want') beginGuidedFlow('known');
    else if (value === 'Help me choose') beginGuidedFlow('explore');
    else {
      setGuidedStep(null);
      setInput('');
      window.setTimeout(() => composerRef.current?.focus(), 0);
    }
  }

  function closeCard() {
    guidedCancelledRef.current = true;
    dismissedGuidedQueryRef.current = activeGuidedQueryRef.current || lastSentQueryRef.current;
    activeGuidedQueryRef.current = '';
    card.close();
    setGuidedStep(draft && Object.keys(draft).length ? 'review' : null);
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
    const deletingActiveThread = thread.id === threadId || thread.id === streamingThreadIdRef.current;
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

  async function publishDraftRequest() {
    if (!draft || publishingRequest || published || postBlocked) return;
    setPublishingRequest(true);
    setPublishError('');
    try {
      const [brands, states] = await Promise.all([client.reference.brands(), client.reference.states()]);
      const brandName = draft.brand || '';
      const brand = brands.find((item) => item.id === draft.brandId) ?? brands.find((item) => item.name.toLowerCase() === brandName.toLowerCase());
      const area = (draft.area || '').trim();
      const state = states.find((item) => item.name.toLowerCase() === (draft.state || '').toLowerCase()) ?? states.find((item) => area.toLowerCase().includes(item.name.toLowerCase()) || new RegExp(`(?:,|\\b)\\s*${item.code}\\b`, 'i').test(area));
      if (!brand || !state) throw new Error('Please include a recognizable brand and city/state before publishing.');
      const yearValues = (draft.years || '').match(/20\d{2}/g)?.map(Number) ?? [];
      const validTimelines: BuyerRequest['timeline'][] = ['ASAP', 'Within 1 week', 'Within 2 weeks', 'Just exploring'];
      const timeline = validTimelines.includes(draft.timeline as BuyerRequest['timeline']) ? draft.timeline as BuyerRequest['timeline'] : 'Just exploring';
      const timelineNote = draft.timeline && timeline !== draft.timeline ? `Preferred timing: ${draft.timeline}` : '';
      const request = await client.requests.create({
        brandId: brand.id,
        buyerAreaStateId: state.id,
        model: draft.model || 'Vehicle',
        bodyType: draft.bodyType || null,
        fuelType: draft.fuelType || null,
        yearMin: yearValues[0] || null,
        yearMax: yearValues[1] || yearValues[0] || null,
        transmission: draft.transmission || null,
        trim: draft.trim || null,
        drivetrain: draft.drivetrain || null,
        budgetMin: draft.budgetMin || null,
        budgetMax: draft.budgetMax || null,
        buyerArea: area,
        searchRadiusMiles: 50,
        timeline,
        mustHaves: draft.mustHaves ? draft.mustHaves.split(',').map((item) => item.trim()).filter(Boolean) : [],
        additionalInformation: [draft.additionalInformation, timelineNote].filter(Boolean).join('\n') || null,
        requestExpire: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        status: 'draft',
      });
      const publishedRequest = await client.requests.publish(request.id);
      setRequests((items) => [publishedRequest, ...items.filter((item) => item.id !== publishedRequest.id)]);
      setPublished(true);
      setPublishedRequestId(publishedRequest.id);
      setGuidedStep('complete');
      setMessages((items) => [...items, { id: createId(), role: 'assistant', body: 'Your request is now with matching dealers. You can track replies in My Requests, or ask me anything about the car while you wait.' }]);
    } catch (error) {
      setPublishError(error instanceof Error ? error.message : 'The request could not be published.');
    } finally {
      setPublishingRequest(false);
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

  async function send(value = input, comparison?: CompareSelection, bypassCard = false) {
    const text = value.trim();
    if (!text || streaming) return;
    if (card.active && !comparison && !bypassCard) {
      setInput('');
      card.other(text);
      return;
    }
    if (!comparison && text.toLowerCase() === compareOffersPrompt.toLowerCase()) {
      setInput('');
      setCompareMode('dealers');
      setCompareOpen(true);
      return;
    }
    if (dismissedGuidedQueryRef.current && dismissedGuidedQueryRef.current !== text) dismissedGuidedQueryRef.current = '';
    lastSentQueryRef.current = text;
    ++greetingRunRef.current;
    const runThreadId = threadIdRef.current ?? createId();
    threadIdRef.current = runThreadId;
    if (!threadId) setThreadId(runThreadId);
    const run = ++activeRunRef.current;
    const controller = new AbortController();
    abortControllerRef.current = controller;
    streamingThreadIdRef.current = runThreadId;
    setStreamingThreadId(runThreadId);
    setInput(''); setStopped(false); setCompare(null); setMedia([]); setSources([]); setStreaming(true); setStatus(activity.classifying);
    const assistantId = createId();
    activeAssistantIdRef.current = assistantId;
    setActiveAssistantId(assistantId);
    const transcript = [...(streamedMessagesByThreadRef.current[runThreadId] ?? displayedMessagesRef.current), { id: createId(), role: 'user' as const, body: text }, { id: assistantId, role: 'assistant' as const, body: '' }];
    streamedMessagesByThreadRef.current[runThreadId] = transcript;
    responseUiByThreadRef.current[runThreadId] = { draft, compare: null, media: [], sources: [] };
    if (threadIdRef.current === runThreadId) setMessages(transcript);
    // Only a confirmed picker selection invokes the saved-offer comparison agent. Natural questions such as
    // "compare BMW and Audi" stay in Sera's normal knowledge-backed conversation, even if old selections exist.
    const isCompare = Boolean(comparison) || (compareOpen && canCompare);
    completedCompareRef.current = isCompare;
    if (isCompare && guidedStep) { card.close(); setGuidedStep(null); }
    const requestIds = comparison?.requestIds ?? (isCompare && compareMode === 'requests' ? selected : []);
    const quoteIds = comparison?.quoteIds ?? (isCompare && compareMode === 'dealers' ? selectedQuoteIds : []);
    try {
    for await (const event of client.ai.chat({ message: text, threadId: runThreadId, agent: isCompare ? 'compare-agent' : 'sera-agent', requestIds, quoteIds, ...(!isCompare && draft ? { requestContext: draft } : {}), signal: controller.signal })) {
        if (controller.signal.aborted || activeRunRef.current !== run) break;
        if (event.type === 'status') setStatus(activity[event.phase]);
        if (event.type === 'token') { setStatus(''); updateStreamTranscript(runThreadId, (items) => items.map((item) => item.id === assistantId ? { ...item, body: item.body + event.text } : item)); }
        if (event.type === 'card' && event.kind === 'requestPreview') {
          const nextDraft = normalizeRequestDraft(event.payload);
          const responseUi: ThreadResponseUi = responseUiByThreadRef.current[runThreadId] ?? {};
          const nextGate = postingGate(event.payload);
          responseUiByThreadRef.current[runThreadId] = { ...responseUi, draft: nextDraft, postGate: nextGate, published: Boolean(event.payload && typeof event.payload === 'object' && (event.payload as Record<string, unknown>).status === 'open') };
          if (threadIdRef.current === runThreadId) {
            setDraft(nextDraft);
            setPostGate(nextGate);
            if (responseUiByThreadRef.current[runThreadId]?.published) setPublished(true);
          }
        }
        if (event.type === 'card' && event.kind === 'compare') {
          responseUiByThreadRef.current[runThreadId] = { ...responseUiByThreadRef.current[runThreadId], compare: event.payload as CompareDraft };
          if (threadIdRef.current === runThreadId) setCompare(event.payload as CompareDraft);
        }
        if (event.type === 'card' && event.kind === 'question') {
          if (dismissedGuidedQueryRef.current === text) {
            card.close();
            setGuidedStep(null);
            continue;
          }
          const existingUi: ThreadResponseUi = responseUiByThreadRef.current[runThreadId] ?? {};
          responseUiByThreadRef.current[runThreadId] = { ...existingUi, questionPayload: event.payload, draft: published ? existingUi.draft ?? null : null };
          if (threadIdRef.current === runThreadId) {
            activeGuidedQueryRef.current = text;
            guidedCancelledRef.current = false;
            guidedOwnedThreadRef.current = true;
            if (!published) { setDraft(null); setPublishedRequestId(null); }
            if (session?.subscription) setPostGate({ allowed: session.subscription.canCreate, reason: session.subscription.canCreate ? null : gateReasonFor(session.subscription) });
            setGuidedStep('card');
            card.open(event.payload);
          }
        }
        if (event.type === 'media') {
          responseUiByThreadRef.current[runThreadId] = { ...responseUiByThreadRef.current[runThreadId], media: event.items as VehicleMedia[] };
          if (threadIdRef.current === runThreadId) setMedia(event.items as VehicleMedia[]);
        }
        if (event.type === 'sources') {
          responseUiByThreadRef.current[runThreadId] = { ...responseUiByThreadRef.current[runThreadId], sources: event.items as VehicleSource[] };
          if (threadIdRef.current === runThreadId) setSources(event.items as VehicleSource[]);
        }
        if (event.type === 'error') {
          setStatus('');
          updateStreamTranscript(runThreadId, (items) => items.map((item) => item.id === assistantId ? { ...item, body: item.body || `## I hit a problem\n${event.message || 'Please try sending that message again.'}` } : item));
        }
        if (event.type === 'done') {
          setStatus('');
          if (threadIdRef.current === runThreadId) setThreadId(event.threadId);
          if (threadIdRef.current === runThreadId) setParams({ thread: event.threadId }, { replace: true });
          await refreshThreads();
        }
      }
    } catch {
      if (controller.signal.aborted || activeRunRef.current !== run) return;
      updateStreamTranscript(runThreadId, (items) => items.map((item) => item.id === assistantId ? { ...item, body: '## I hit a connection problem\n- Your conversation is safe\n- Please try sending that message again' } : item));
    } finally {
      if (activeRunRef.current === run) {
        abortControllerRef.current = null;
        activeAssistantIdRef.current = null;
        streamingThreadIdRef.current = null;
        setActiveAssistantId(null);
        setStreamingThreadId(null);
        setStreaming(false);
        setStatus('');
      }
    }
  }

  // Keep the card's hand-off to Sera pointing at the latest send(); it closes over current state.
  useEffect(() => { sendRef.current = (text: string) => { void send(text, undefined, true); }; });
  const showComposer = guidedStep === null || guidedStep === 'card' || guidedStep === 'complete';
  const showSuggestedPrompts = !streaming && !guidedStep && messages.length === 0;

  return <div className="advisor-page">
    <section className="shell advisor-shell" aria-label="Ask Sera">
      {sidebarOpen && <button className="advisor-scrim" aria-label="Close chat list" onClick={() => setSidebarOpen(false)} />}
      <aside className={`advisor-sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="advisor-sidebar-head"><div><span className="eyebrow">Conversation memory</span><h2>Your chats</h2><p className="advisor-sidebar-note">Research, compare, and build a request—with you in control.</p></div><button className="button button-ghost advisor-mobile-menu" onClick={() => setSidebarOpen(false)} aria-label="Close chat list"><X size={19} /></button></div>
        <button className="button button-secondary button-wide advisor-new-chat" onClick={newChat}><Plus size={17} /> New chat</button>
        <div className="advisor-thread-list" aria-busy={threadsLoading}>{threadsLoading ? <div className="loader-inline"><SerraLoader size={28} label="Loading your chats" /></div> : threads.map((thread) => <div key={thread.id} className={`advisor-thread-item${thread.id === threadId ? ' active' : ''}`} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setThreadMenuId(null); }}><button type="button" className="advisor-thread-open" onClick={() => void openThread(thread.id)}><History size={16} /><span><strong>{thread.title}</strong><small>{streamingThreadId === thread.id ? 'Sera is replying…' : thread.id === threadId ? 'Active now' : relativeTime(thread.updatedAt)}</small></span></button><button type="button" className="advisor-thread-more" aria-label={`More options for ${thread.title}`} aria-expanded={threadMenuId === thread.id} onClick={() => setThreadMenuId((id) => id === thread.id ? null : thread.id)}><MoreHorizontal size={17} /></button>{threadMenuId === thread.id && <div className="advisor-thread-menu" role="menu"><button type="button" role="menuitem" disabled={deletingThreadId === thread.id} onClick={() => void deleteThread(thread)}><Trash2 size={15} /> {deletingThreadId === thread.id ? 'Deleting…' : 'Delete chat'}</button></div>}</div>)}</div>
        {threadActionError && <p className="advisor-thread-error" role="alert">{threadActionError}</p>}
        <div className="advisor-privacy"><CheckCircle2 size={18} /><span><strong>You stay in control</strong><small>Sera never posts or accepts without approval.</small></span></div>
      </aside>
      <main className="advisor-chat">
        <header className="advisor-chat-head"><button className="button button-ghost advisor-mobile-menu" onClick={() => setSidebarOpen(true)} aria-label="Open chat list"><Menu size={19} /></button><div className="serra-avatar"><SerraLogo size={40} title={null} /></div><span><strong>Sera</strong><small><i /> Online · remembers this chat</small></span><button type="button" className={`compare-toggle ${compareOpen ? 'open' : ''}`} onClick={() => setCompareOpen((value) => !value)} aria-haspopup="dialog" aria-expanded={compareOpen}><CompareIcon size={17} /><span>Compare</span>{compareCount > 0 && <b className="compare-toggle-count">{compareCount}</b>}</button></header>
        <div className="advisor-scroll" aria-live="polite">
          <div className="advisor-day">Today</div>
          {streaming && streamingThreadId !== threadId && <p className="advisor-background-stream" role="status">Sera is finishing a reply in another chat. It will be saved there automatically.</p>}
          {threadLoading ? <div className="advisor-loading"><SerraLoader size={56} label="Opening this chat" /></div> : messages.map((message) => {
            const showStatus = message.id === activeAssistantId && !message.body && Boolean(status);
            if (!message.body && !showStatus) return null;
            return <article key={message.id} className={`advisor-message ${message.role}`}>
              <div className="message-content">
                <div className={`message-bubble${showStatus ? ' is-status' : ''}`}>{message.body ? <Answer body={message.body} /> : <ActivityStatus label={status} />}</div>
                {message.role === 'assistant' && hasGuidedHistoryOptions(message.options) && guidedStep !== 'start' && <div className="guided-history-options" aria-label="Options Sera offered">{message.options?.map((option) => <span key={option}>{option}</span>)}</div>}
              </div>
            </article>;
          })}
          {stopped && <div className="inline-notice">Response stopped. Your partial answer remains in this chat.</div>}
          {guidedStep === 'start' && <article className="advisor-message assistant guided-message">
            <div className="message-content">
              <div className="guided-choice-card" aria-label="Sera response options">
                <div className="guided-choice-grid">{START_OPTIONS.map((option) => <button type="button" className={`guided-choice${option !== 'Ask Sera a question' ? ' guided-choice-primary' : ''}`} key={option} onClick={() => chooseStartOption(option)}>{option}</button>)}</div>
              </div>
            </div>
          </article>}
          {card.busy && !card.question && <p className="guided-image-loading"><ActivityStatus label="Preparing questions" /></p>}
          {card.error && !card.question && <p className="inline-warning" role="alert">{card.error}</p>}
          {sources.length > 0 && media.length === 0 && <section className="advisor-sources" aria-label="Research sources"><span>Sources</span>{sources.slice(0, 5).map((item) => <a key={item.url} href={item.url} target="_blank" rel="noreferrer">{item.title || item.url}</a>)}</section>}
          {media.length > 0 && (!draft || guidedStep === null || guidedStep === 'start') && <section className="advisor-chat-media" aria-label="Vehicle images">
            <p>Vehicle reference photos <span>Open a source for more details</span></p>
            <div className={`advisor-chat-media-grid${media.length === 1 ? ' single' : ''}`}>{media.slice(0, 2).map((item) => <figure key={item.image_url} className="advisor-media-card">
              <a href={item.source_url} target="_blank" rel="noreferrer" aria-label={`Open image source: ${item.source_name || 'vehicle source'}`}>
                <img src={item.thumbnail_url || item.image_url} alt={item.alt || 'Vehicle reference'} loading="lazy" onError={(event) => {
                  const image = event.currentTarget;
                  if (image.src !== item.image_url) image.src = item.image_url;
                  else image.closest('figure')?.classList.add('image-unavailable');
                }} />
                <figcaption>{item.source_name || 'Automotive source'} <span>View source ↗</span></figcaption>
              </a>
              <span className="advisor-image-unavailable">Image preview unavailable · open source</span>
            </figure>)}</div>
          </section>}
          {draft && Object.keys(draft).length > 0 && (guidedStep === null || guidedStep === 'review' || guidedStep === 'complete' || published) && <section className="ai-result-card request-preview">
            <div className="result-card-head">
              <div><span className="eyebrow">{published ? 'Shared with dealers' : 'Request summary'}</span><h3>{draft.brand} {draft.model && draft.model !== 'Open to recommendations' ? draft.model : 'Buying request'}</h3></div>
              <button className="button button-secondary button-sm" onClick={() => setEditing(!editing)} disabled={published}><Pencil size={14} /> {published ? 'Posted' : editing ? 'Done' : 'Edit'}</button>
            </div>
            {guidedStep === 'review' && imageLoading && <p className="guided-image-loading" aria-live="polite"><ActivityStatus label="Finding a reference image" /></p>}
            {media.length > 0 && (guidedStep === 'review' || guidedStep === 'complete' || published) && <section className="advisor-media-grid" aria-label="Vehicle reference images">
              <p className="advisor-media-intro">{media[0]?.source_name?.includes('Wikimedia Commons') ? 'Community reference photo · confirm model details at the source' : 'A visual reference for this vehicle'}</p>
              {media.slice(0, 1).map((item) => <figure key={item.image_url} className="advisor-media-card">
                <a href={item.source_url} target="_blank" rel="noreferrer"><img src={item.image_url} alt={item.alt || 'Vehicle reference'} width="320" height="180" loading="lazy" onError={() => { setMedia([]); setImageSearchStatus('not_found'); }} /><figcaption>{item.source_name || 'Source'} · View source</figcaption></a>
              </figure>)}
            </section>}
            {guidedStep === 'review' && !imageLoading && imageSearchStatus === 'not_found' && draft.brand && draft.model && draft.model !== 'Open to recommendations' && <div className="guided-image-fallback" role="status"><span>No usable reference photo turned up for this vehicle. You can continue without one.</span><button type="button" className="guided-back" onClick={() => setImageAttempt((attempt) => attempt + 1)}>Try again</button></div>}
            {guidedStep === 'review' && !imageLoading && imageSearchStatus === 'unavailable' && <div className="guided-image-fallback" role="status"><span>Image search is temporarily unavailable. You can continue with your request.</span><button type="button" className="guided-back" onClick={() => setImageAttempt((attempt) => attempt + 1)}>Retry search</button></div>}
            <div className="request-preview-grid">{Object.entries(draft).filter(([key]) => !HIDDEN_DRAFT_FIELDS.has(key)).map(([key, value]) => <label key={key}><span>{DRAFT_LABELS[key] ?? key.replace(/([A-Z])/g, ' $1')}</span>{editing ? <input value={value} onChange={(event) => setDraft({ ...draft, [key]: event.target.value })} /> : <strong>{value || 'No preference'}</strong>}</label>)}</div>
            {postBlocked && <UpgradePrompt reason={postGate?.reason ?? 'request_limit_reached'} role="buyer" />}
            {guidedStep === 'complete' || published ? <div className="result-card-actions"><p><CheckCircle2 size={16} /> Request sent to matching dealers.</p><Link className="button button-primary button-sm" to={publishedRequestId ? `/requests/${publishedRequestId}` : '/requests'}>Track Request</Link></div> : <div className="result-card-actions"><p><CheckCircle2 size={16} /> Nothing is posted until you confirm.</p><button className="button button-primary button-sm" onClick={() => void publishDraftRequest()} disabled={published || publishingRequest || postBlocked}><FileCheck2 size={16} /> {publishingRequest ? 'Publishing…' : 'Send to matching dealers'}</button></div>}
            {publishError && <p className="inline-warning" role="alert">{publishError}</p>}
          </section>}
          {compare && <ComparisonCard compare={compare} selected={selected} selectedQuoteIds={selectedQuoteIds} quotes={quotes} requests={requests} />}
          <div ref={endRef} />
        </div>
        <div className="advisor-dock">
          {compareOpen && createPortal(<div className="modal-backdrop compare-backdrop" onMouseDown={() => setCompareOpen(false)}>
            <section ref={compareDrawerRef} tabIndex={-1} className="compare-drawer" role="dialog" aria-modal="true" aria-labelledby="compare-drawer-title" onMouseDown={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === 'Enter' && event.target instanceof HTMLInputElement && canCompare) { event.preventDefault(); runComparison(); } }}>
              <button type="button" className="modal-close compare-drawer-close" onClick={() => setCompareOpen(false)} aria-label="Close compare"><X /></button>
              <header className="compare-drawer-head"><span className="eyebrow">Ask Sera</span><h2 id="compare-drawer-title">Compare offers</h2><p>{compareMode === 'dealers' ? 'Choose at least two dealer offers from one request.' : 'Choose at least two vehicle requests to compare their best offers.'}</p></header>
            <div className="compare-mode-tabs" role="tablist" aria-label="Comparison type">
              <button type="button" role="tab" aria-selected={compareMode === 'dealers'} className={compareMode === 'dealers' ? 'active' : ''} onClick={() => setCompareMode('dealers')}>Dealers on one request</button>
              <button type="button" role="tab" aria-selected={compareMode === 'requests'} className={compareMode === 'requests' ? 'active' : ''} onClick={() => setCompareMode('requests')}>Different vehicle requests</button>
            </div>
            <div className="compare-picker-body">
              {compareMode === 'requests' ? <>
                {requestGroups.length ? requestGroups.map(({ request, quotes: groupQuotes }) => { const best = [...groupQuotes].sort((a, b) => Number(a.finalPrice) - Number(b.finalPrice))[0]; return <label className={`compare-request-option ${selected.includes(request.id) ? 'selected' : ''}`} key={request.id}><input type="checkbox" checked={selected.includes(request.id)} onChange={() => toggleRequest(request.id)} /><span><strong>{request.brand} {request.model}</strong><small>{groupQuotes.length} dealer {groupQuotes.length === 1 ? 'offer' : 'offers'} · best {best ? formatMoney(best.finalPrice) : 'not reported'}</small></span></label>; }) : <p className="muted">Requests appear here after at least one dealer responds.</p>}
              </> : <>
                {dealerGroups.length ? <>
                  <div className="compare-request-selector">{dealerGroups.map(({ request, quotes: groupQuotes }) => <button type="button" key={request.id} className={request.id === activeDealerRequestId ? 'active' : ''} onClick={() => { setDealerRequestId(request.id); setSelectedQuoteIds([]); }}><strong>{request.brand} {request.model}</strong><small>{groupQuotes.length} offers</small></button>)}</div>
                  <div className="compare-offer-list">{activeDealerGroup?.quotes.map((quote) => <label className={`compare-request-option ${selectedQuoteIds.includes(quote.id) ? 'selected' : ''}`} key={quote.id}><input type="checkbox" checked={selectedQuoteIds.includes(quote.id)} onChange={() => toggleQuote(quote.id)} /><span><strong>{quote.dealerName}</strong><small>{formatMoney(quote.finalPrice)} out the door · {quote.rating}★</small></span></label>)}</div>
                </> : <p className="muted">A request needs at least two dealer offers before you can compare dealers.</p>}
              </>}
            </div>
            <div className="compare-drawer-note"><CompareIcon size={16} /><span>Sera compares price, equipment and delivery timing, and points out what each offer leaves unclear.</span></div><footer className="compare-drawer-foot"><span><strong>{compareCount}</strong> {compareMode === 'requests' ? (compareCount === 1 ? 'request' : 'requests') : (compareCount === 1 ? 'offer' : 'offers')} selected</span><button type="button" className="button button-primary" disabled={!canCompare || streaming} onClick={runComparison}>{compareMode === 'requests' ? 'Compare requests' : 'Compare dealer offers'}</button></footer>
            </section>
          </div>, document.body)}
          {card.question ? <QuestionCard key={`${card.question.id}-${card.question.index}`} question={card.question} busy={card.busy} error={card.error} canGoBack={card.canGoBack} canGoForward={card.canGoForward} onAnswer={card.answer} onOther={card.other} onSkip={card.skip} onBack={() => void card.back()} onForward={() => void card.forward()} onClose={closeCard} /> : <div className="advisor-dock-bar">
            {showSuggestedPrompts && <div className="advisor-prompts advisor-followups">{prompts.map((prompt) => <button type="button" key={prompt} onClick={() => handlePrompt(prompt)}>{prompt}</button>)}</div>}
          </div>}
        {showComposer && <form className="advisor-composer" onSubmit={(event) => { event.preventDefault(); if (input.trim()) void send(); else runComparison(); }}><div className="composer-input"><textarea ref={composerRef} value={input} onChange={(event) => setInput(event.target.value)} rows={1} aria-label={card.active ? 'Reply to Sera' : 'Message Sera'} placeholder={card.active ? 'Or reply directly…' : compareOpen && canCompare ? 'Press Enter or Send to compare your selections' : 'Ask Sera about cars, offers, or ownership…'} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); if (input.trim()) void send(); else runComparison(); } }} /><div className="composer-actions">{streaming && streamingThreadId === threadId && <button type="button" className="button composer-stop" onClick={() => cancelActiveResponse(true)} aria-label="Stop generating" title="Stop generating"><Square size={12} fill="currentColor" /></button>}<button className="button button-primary" disabled={streaming || (!input.trim() && !(compareOpen && canCompare))} aria-label={compareOpen && canCompare && !input.trim() ? 'Compare selected offers' : 'Send message'}><ArrowUp size={18} /></button></div></div><small>{card.active ? 'Pick an option above, type your own answer, or ask Sera anything.' : streaming && streamingThreadId !== threadId ? 'Sera is replying in another chat…' : 'Sera can make mistakes. Review prices and availability before deciding.'}</small></form>}
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

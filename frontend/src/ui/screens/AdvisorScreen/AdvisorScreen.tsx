/* eslint-disable react-refresh/only-export-components -- response formatting helpers are exported for focused tests */
import { ArrowUp, CheckCircle2, FileCheck2, History, Menu, MoreHorizontal, Pencil, Plus, Sparkles, Square, Trash2, Trophy, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
interface VehicleMedia { image_url: string; source_url: string; source_name?: string; alt?: string }
interface VehicleSource { url: string; title: string }
type CompareMode = 'requests' | 'dealers';
type CompareSelection = { requestIds?: string[]; quoteIds?: string[] };
type GuidedStep = 'start' | 'card' | 'review' | 'complete';
const START_OPTIONS = ['I know the car I want', 'Help me choose', 'Ask Sera a question'];
const HIDDEN_DRAFT_FIELDS = new Set(['stateId', 'brandId']);
const DRAFT_LABELS: Record<string, string> = { mustHaves: 'Must-haves', fuelType: 'Fuel', transmission: 'Transmission', drivetrain: 'Drivetrain', additionalInformation: 'Additional details', bodyType: 'Body style', budgetMin: 'Budget from', budgetMax: 'Budget up to', years: 'Model year' };

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
  const [imageAttempt, setImageAttempt] = useState(0);
  const [publishedRequestId, setPublishedRequestId] = useState<string | null>(null);
  const postBlocked = postGate?.allowed === false;
  const [threadMenuId, setThreadMenuId] = useState<string | null>(null);
  const [deletingThreadId, setDeletingThreadId] = useState<string | null>(null);
  const [threadActionError, setThreadActionError] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const activeRunRef = useRef(0);
  const activeAssistantIdRef = useRef<string | null>(null);
  const guidedSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const initialThreadIdRef = useRef<string | null>(null);
  const guidedOwnedThreadRef = useRef(false);
  const completedCompareRef = useRef(false);
  const greetingRunRef = useRef(0);
  const compareDrawerRef = useRef<HTMLElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const sendRef = useRef<(text: string) => void>(() => undefined);
  const appendTranscript = useCallback((lines: Array<{ role: 'assistant' | 'user'; body: string }>) => {
    setMessages((items) => [...items, ...lines.map((line) => ({ id: createId(), ...line }))]);
  }, []);
  const showDraft = useCallback((result: Record<string, string>) => {
    setDraft(result);
    setPublished(false);
    setGuidedStep('review');
    setMessages((items) => [...items, { id: createId(), role: 'assistant', body: 'Here’s your request. Check the details, edit anything, then send it to matching dealers.' }]);
  }, []);
  const card = useGuidedCard({ onTranscript: appendTranscript, onDraft: showDraft, onUnresolved: (text) => sendRef.current(text) });
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
    cancelActiveResponse(false);
    ++greetingRunRef.current;
    setStatus('');
    setDraft(null);
    setMedia([]); setSources([]);
    setPostGate(null);
    setPublished(false); setPublishedRequestId(null); setEditing(false); card.close();
    setCompare(null);
    setThreadLoading(true);
    try {
      const thread = await client.ai.thread(id);
      guidedOwnedThreadRef.current = Boolean(thread.guidedState);
      setThreadId(thread.id);
      setMessages(thread.messages);
      if (thread.guidedState) {
        const step = normalizeGuidedStep(thread.guidedState.guidedStep);
        setGuidedStep(step);
        setDraft((thread.requestContext as RequestDraft | null) ?? null);
        const cardAnswers = thread.guidedState.cardAnswers as GuidedAnswers | null | undefined;
        if (step === 'card' && cardAnswers) void card.restore(cardAnswers);
        setPublishedRequestId((thread.guidedState.publishedRequestId as string | null) ?? null);
        setPublished(Boolean(thread.guidedState.publishedRequestId));
      } else restoreGuidedFlow(thread.id);
      setSidebarOpen(false);
      setParams({ thread: thread.id }, { replace: true });
    } catch {
      setThreadId(id);
      const saved = session?.id ? window.localStorage.getItem(`sera-guided-${session.id}-${id}`) : null;
      guidedOwnedThreadRef.current = Boolean(saved);
      if (saved) restoreGuidedFlow(id);
      else { streamGreeting(); setGuidedStep('start'); }
    } finally {
      setThreadLoading(false);
    }
  }, [cancelActiveResponse, card, restoreGuidedFlow, session, setParams, streamGreeting]);

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
    if (!session?.id || !guidedOwnedThreadRef.current || !threadId || !messages.length || streaming || (guidedStep === null && !draft) || completedCompareRef.current) return;
    const snapshot = {
      threadId,
      messages: messages.slice(-200),
      guidedState: { guidedStep, cardAnswers: card.answers, publishedRequestId },
      requestContext: draft,
    };
    const timer = window.setTimeout(() => {
      guidedSaveQueueRef.current = guidedSaveQueueRef.current
        .then(() => client.ai.saveGuidedCheckpoint(snapshot))
        .then(() => {
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
    if (!draft?.brand || !draft.model || draft.model === 'Vehicle') return;
    let active = true;
    // Start the UI loading state with the request lifecycle; the image search runs asynchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setImageLoading(true);
    setMedia([]);
    const year = draft.years ? `${draft.years} ` : '';
    if (draft.model === 'Open to recommendations') { setImageLoading(false); return; }
    const model = `${draft.brand} ${draft.model}`;
    void client.ai.vehicleImages(`${year}${model}`.trim()).then((items) => {
      if (active) setMedia(items);
    }).catch(() => { if (active) setMedia([]); }).finally(() => { if (active) setImageLoading(false); });
    return () => { active = false; };
  }, [draft?.brand, draft?.model, draft?.years, draft?.bodyType, imageAttempt]);
  useEffect(() => () => { activeRunRef.current += 1; abortControllerRef.current?.abort(); }, []);

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
    cancelActiveResponse(false);
    ++greetingRunRef.current;
    const id = createId();
    guidedOwnedThreadRef.current = true;
    completedCompareRef.current = false;
    setDraft(null); setMedia([]); setSources([]); setPostGate(null); setCompare(null); setSelected([]); setSelectedQuoteIds([]); setThreadId(id); setPublished(false); setEditing(false); card.close(); setGuidedStep('start'); setPublishedRequestId(null); setSidebarOpen(false); setParams({ thread: id }, { replace: true });
    streamGreeting();
  }

  function beginGuidedFlow(mode: 'known' | 'explore') {
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
    ++greetingRunRef.current;
    const run = ++activeRunRef.current;
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setInput(''); setStopped(false); setCompare(null); setMedia([]); setSources([]); setStreaming(true); setStatus(activity.classifying);
    const assistantId = createId();
    activeAssistantIdRef.current = assistantId;
    setActiveAssistantId(assistantId);
    setMessages((items) => [...items, { id: createId(), role: 'user', body: text }, { id: assistantId, role: 'assistant', body: '' }]);
    // Only a confirmed picker selection invokes the saved-offer comparison agent. Natural questions such as
    // "compare BMW and Audi" stay in Sera's normal knowledge-backed conversation, even if old selections exist.
    const isCompare = Boolean(comparison) || (compareOpen && canCompare);
    completedCompareRef.current = isCompare;
    if (isCompare && guidedStep) { card.close(); setGuidedStep(null); }
    const requestIds = comparison?.requestIds ?? (isCompare && compareMode === 'requests' ? selected : []);
    const quoteIds = comparison?.quoteIds ?? (isCompare && compareMode === 'dealers' ? selectedQuoteIds : []);
    try {
      for await (const event of client.ai.chat({ message: text, ...(threadId ? { threadId } : {}), agent: isCompare ? 'compare-agent' : 'sera-agent', requestIds, quoteIds, ...(!isCompare && draft ? { requestContext: draft } : {}), signal: controller.signal })) {
        if (controller.signal.aborted || activeRunRef.current !== run) break;
        if (event.type === 'status') setStatus(activity[event.phase]);
        if (event.type === 'token') { setStatus(''); setMessages((items) => items.map((item) => item.id === assistantId ? { ...item, body: item.body + event.text } : item)); }
        if (event.type === 'card' && event.kind === 'requestPreview') {
          setDraft(normalizeRequestDraft(event.payload));
          setPostGate(postingGate(event.payload));
          if (event.payload && typeof event.payload === 'object' && (event.payload as Record<string, unknown>).status === 'open') setPublished(true);
        }
        if (event.type === 'card' && event.kind === 'compare') setCompare(event.payload as CompareDraft);
        if (event.type === 'card' && event.kind === 'question') {
          guidedOwnedThreadRef.current = true;
          setDraft(null); setPublished(false); setPublishedRequestId(null);
          if (session?.subscription) setPostGate({ allowed: session.subscription.canCreate, reason: session.subscription.canCreate ? null : gateReasonFor(session.subscription) });
          setGuidedStep('card');
          card.open(event.payload);
        }
        if (event.type === 'media') setMedia(event.items as VehicleMedia[]);
        if (event.type === 'sources') setSources(event.items as VehicleSource[]);
        if (event.type === 'error') {
          setStatus('');
          setMessages((items) => items.map((item) => item.id === assistantId ? { ...item, body: item.body || `## I hit a problem\n${event.message || 'Please try sending that message again.'}` } : item));
        }
        if (event.type === 'done') {
          setStatus('');
          setThreadId(event.threadId);
          if (session?.id && draft) {
            try { window.localStorage.setItem(`sera-guided-${session.id}-${event.threadId}`, JSON.stringify({ guidedStep, draft, messages, publishedRequestId, cardAnswers: card.answers })); } catch { /* Ignore blocked browser storage. */ }
          }
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

  // Keep the card's hand-off to Sera pointing at the latest send(); it closes over current state.
  useEffect(() => { sendRef.current = (text: string) => { void send(text, undefined, true); }; });
  const showComposer = guidedStep === null || guidedStep === 'card' || guidedStep === 'complete';

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
        <header className="advisor-chat-head"><button className="button button-ghost advisor-mobile-menu" onClick={() => setSidebarOpen(true)} aria-label="Open chat list"><Menu size={19} /></button><div className="serra-avatar"><SerraLogo size={40} title={null} /></div><span><strong>Sera</strong><small><i /> Online · remembers this chat</small></span><button type="button" className={`compare-toggle ${compareOpen ? 'open' : ''}`} onClick={() => setCompareOpen((value) => !value)} aria-haspopup="dialog" aria-expanded={compareOpen}><CompareIcon size={17} /><span>Compare</span>{compareCount > 0 && <b className="compare-toggle-count">{compareCount}</b>}</button></header>
        <div className="advisor-scroll" aria-live="polite">
          <div className="advisor-day">Today</div>
          {threadLoading ? <div className="advisor-loading"><SerraLoader size={56} label="Opening this chat" /></div> : messages.map((message) => {
            const showStatus = message.id === activeAssistantId && !message.body && Boolean(status);
            if (!message.body && !showStatus) return null;
            return <article key={message.id} className={`advisor-message ${message.role}`}>
              <div className="message-content">
                <div className={`message-bubble${showStatus ? ' is-status' : ''}`}>{message.body ? <Answer body={message.body} /> : <ActivityStatus label={status} />}</div>
                {message.role === 'assistant' && message.options?.length && guidedStep !== 'start' && <div className="guided-history-options" aria-label="Options Sera offered">{message.options.map((option) => <span key={option}>{option}</span>)}</div>}
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
          {card.error && <p className="inline-warning" role="alert">{card.error}</p>}
          {imageLoading && guidedStep === 'review' && <p className="guided-image-loading"><ActivityStatus label="Finding a reference image" /></p>}
          {media.length > 0 && (guidedStep === 'review' || guidedStep === 'complete') && <section className="advisor-media-grid" aria-label="Vehicle reference images"><p className="advisor-media-intro">A visual reference for the vehicle you selected</p>{media.map((item) => <figure key={item.image_url} className="advisor-media-card"><a href={item.source_url} target="_blank" rel="noreferrer"><img src={item.image_url} alt={item.alt || 'Vehicle image'} loading="lazy" onError={() => setMedia((items) => items.filter((image) => image.image_url !== item.image_url))} /><figcaption>{item.source_name || 'Source'} · View source</figcaption></a></figure>)}</section>}
          {guidedStep === 'review' && !imageLoading && !media.length && draft?.brand && draft.model && draft.model !== 'Open to recommendations' && <div className="guided-image-fallback"><span>I couldn’t find a verified photo of this exact model. You can still review your request.</span><button type="button" className="guided-back" onClick={() => setImageAttempt((attempt) => attempt + 1)}>Try image search again</button></div>}
          {sources.length > 0 && <section className="advisor-sources" aria-label="Research sources"><span>Sources</span>{sources.slice(0, 5).map((item) => <a key={item.url} href={item.url} target="_blank" rel="noreferrer">{item.title || item.url}</a>)}</section>}
          {draft && Object.keys(draft).length > 0 && (guidedStep === null || guidedStep === 'review' || guidedStep === 'complete') && <section className="ai-result-card request-preview"><div className="result-card-head"><div><span className="eyebrow">Dealer-ready draft</span><h3>Your buying request</h3></div><button className="button button-secondary button-sm" onClick={() => setEditing(!editing)} disabled={published}><Pencil size={14} /> {published ? 'Published' : editing ? 'Done' : 'Edit'}</button></div><div className="request-preview-grid">{Object.entries(draft).filter(([key]) => !HIDDEN_DRAFT_FIELDS.has(key)).map(([key, value]) => <label key={key}><span>{DRAFT_LABELS[key] ?? key.replace(/([A-Z])/g, ' $1')}</span>{editing ? <input value={value} onChange={(event) => setDraft({ ...draft, [key]: event.target.value })} /> : <strong>{value || 'No preference'}</strong>}</label>)}</div>{postBlocked && <UpgradePrompt reason={postGate?.reason ?? 'request_limit_reached'} role="buyer" />}{guidedStep === 'complete' ? <div className="result-card-actions"><p><CheckCircle2 size={16} /> Request sent to matching dealers.</p><Link className="button button-primary" to={publishedRequestId ? `/requests/${publishedRequestId}` : '/requests'}>Track in My Requests</Link></div> : <div className="result-card-actions"><p><CheckCircle2 size={16} /> Nothing is posted until you confirm.</p><button className="button button-primary" onClick={() => void publishDraftRequest()} disabled={published || publishingRequest || postBlocked}><FileCheck2 size={17} /> {publishingRequest ? 'Publishing…' : 'Send to matching dealers'}</button></div>}{publishError && <p className="inline-warning" role="alert">{publishError}</p>}</section>}
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
          {card.question ? <QuestionCard key={`${card.question.id}-${card.question.index}`} question={card.question} busy={card.busy} canGoBack={card.canGoBack} canGoForward={card.canGoForward} onAnswer={card.answer} onOther={card.other} onSkip={card.skip} onBack={() => void card.back()} onForward={() => void card.forward()} onClose={closeCard} /> : <div className="advisor-dock-bar">
            <div className="advisor-prompts advisor-followups">{!streaming && !guidedStep && prompts.map((prompt) => <button type="button" key={prompt} onClick={() => handlePrompt(prompt)}>{prompt}</button>)}</div>
          </div>}
        {showComposer && <form className="advisor-composer" onSubmit={(event) => { event.preventDefault(); if (input.trim()) void send(); else runComparison(); }}><div className="composer-input"><textarea ref={composerRef} value={input} onChange={(event) => setInput(event.target.value)} rows={1} aria-label={card.active ? 'Reply to Sera' : 'Message Sera'} placeholder={card.active ? 'Or reply directly…' : compareOpen && canCompare ? 'Press Enter or Send to compare your selections' : 'Ask Sera about cars, offers, or ownership…'} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); if (input.trim()) void send(); else runComparison(); } }} /><div className="composer-actions">{streaming && <button type="button" className="button composer-stop" onClick={() => cancelActiveResponse(true)} aria-label="Stop generating" title="Stop generating"><Square size={12} fill="currentColor" /></button>}<button className="button button-primary" disabled={streaming || (!input.trim() && !(compareOpen && canCompare))} aria-label={compareOpen && canCompare && !input.trim() ? 'Compare selected offers' : 'Send message'}><ArrowUp size={18} /></button></div></div><small>{card.active ? 'Pick an option above, type your own answer, or ask Sera anything.' : 'Sera can make mistakes. Review prices and availability before deciding.'}</small></form>}
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

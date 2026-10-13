/* eslint-disable react-refresh/only-export-components -- response formatting helpers are exported for focused tests */
import { ArrowUp, Check, CheckCircle2, FileCheck2, History, Menu, MoreHorizontal, Pencil, Plus, Sparkles, Square, Trash2, Trophy, X } from 'lucide-react';
import { Children, cloneElement, isValidElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentProps, ReactElement, ReactNode } from 'react';
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
import type { AiMessage, AiThread, BuyerRequest, GuidedAnswers, Quote, VehicleMedia, VehicleSource } from '@/types/domain';
import { useGuidedCard } from './useGuidedCard';

type RequestDraft = Record<string, string>;
interface CompareDraft { leader?: string; total?: string; difference?: string; requestIds?: string[]; quoteIds?: string[] }
interface ThreadResponseUi { draft?: RequestDraft | null; compare?: CompareDraft | null; media?: VehicleMedia[]; sources?: VehicleSource[]; questionPayload?: unknown; preferenceQuestion?: import('@/types/domain').GuidedQuestion | null; preferenceStage?: PreferenceStage; preferenceEdit?: PreferenceEdit | null; preferenceValue?: string; selectedPreferenceValues?: string[]; preferenceSnapshot?: Record<string, unknown>; preferenceUpdated?: boolean; published?: boolean; postGate?: ReturnType<typeof postingGate> }
type CompareMode = 'requests' | 'dealers';
type CompareSelection = { requestIds?: string[]; quoteIds?: string[] };
type GuidedStep = 'start' | 'card' | 'review' | 'complete';

/** The composer hides while Sera waits on a card (a guided step or a saved-preferences choice); cards carry their own text box. */
export function shouldShowAdvisorComposer(step: GuidedStep | null, awaitingChoice = false): boolean {
  return !awaitingChoice && (step === null || step === 'complete');
}

type AdvisorResponseAction = { label: string; prompt: string };

export function advisorResponseActions(body: string): AdvisorResponseAction[] {
  const normalized = body.toLocaleLowerCase();
  const missingPhotos = /still missing(?: photos)? for|couldn’t verify matching photos|couldn't verify matching photos|couldn’t find reliable photos|couldn't find reliable photos/.test(normalized);
  if (missingPhotos) {
    return [
      { label: 'Try the missing photos again', prompt: 'Please try finding photos for the remaining cars in that shortlist.' },
      { label: 'Compare these cars', prompt: 'Compare the cars in that shortlist for performance, value, and everyday comfort.' },
    ];
  }
  const numberedVehicles = [...body.matchAll(/^\s*\d+[.)]\s+\*\*([^*]+)\*\*/gm)];
  if (numberedVehicles.length < 3 || !/\b(car|cars|vehicle|vehicles|coupe|sports|suv|sedan|roadster)\b/.test(normalized)) return [];
  return [
    { label: 'Show photos', prompt: 'Show me a photo of each car in that shortlist.' },
    { label: 'Compare the shortlist', prompt: 'Compare those cars for performance, value, and everyday comfort.' },
    { label: 'Find the best value', prompt: 'Which car in that shortlist is the best value? Use current sourced prices if available.' },
  ];
}

function isVehicleRecommendation(body: string): boolean {
  return [...body.matchAll(/^\s*\d+[.)]\s+\*\*([^*]+)\*\*/gm)].length >= 3
    && /\b(car|cars|vehicle|vehicles|coupe|sports|suv|sedan|roadster)\b/i.test(body);
}
type PreferenceStage = 'choice' | 'customize' | 'field' | 'update-field' | 'value' | 'remove-select' | 'confirm';
type PreferenceEdit = 'must-add' | 'avoid-add' | 'must-remove' | 'avoid-remove' | 'remove-saved' | 'body-type' | 'fuel-type' | 'budget-max';
const START_OPTIONS = ['I know the car I want', 'Help me choose', 'Ask Sera a question'];
const HIDDEN_DRAFT_FIELDS = new Set(['stateId', 'brandId']);
const DRAFT_LABELS: Record<string, string> = { mustHaves: 'Must-haves', fuelType: 'Fuel', transmission: 'Transmission', drivetrain: 'Drivetrain', additionalInformation: 'Additional details', bodyType: 'Body style', budgetMin: 'Budget from', budgetMax: 'Budget up to', years: 'Model year' };
const IMAGE_CACHE_PREFIX = 'sera-vehicle-image:';

function preferenceQuestion(id: string, title: string, labels: Array<[string, string, string?]>, allowOther = false, placeholder = 'Type a preference', multiSelect = false, emptyMessage?: string): import('@/types/domain').GuidedQuestion {
  return { id, title, options: labels.map(([value, label, description]) => ({ value, label, ...(description ? { description } : {}) })), allowOther, otherPlaceholder: placeholder, multiSelect, skippable: false, index: 1, total: 1, ...(emptyMessage ? { emptyMessage } : {}) };
}

function preferenceSummary(raw: unknown): string {
  if (!raw || typeof raw !== 'object') return '';
  const prefs = raw as Record<string, unknown>;
  const labels: Record<string, string> = { body_type: 'Body style', bodyType: 'Body style', budget_max: 'Budget up to', budgetMax: 'Budget up to', must_have_features: 'Must-haves', mustHaveFeatures: 'Must-haves', never_want_features: 'Avoid', neverWantFeatures: 'Avoid', fuel_type: 'Fuel', fuelType: 'Fuel', drivetrain: 'Drivetrain', condition: 'Condition', transmission: 'Transmission', seater_count: 'Seats', seaterCount: 'Seats' };
  return Object.entries(prefs).filter(([key, value]) => labels[key] && value !== null && value !== undefined && value !== '' && (!Array.isArray(value) || value.length > 0)).map(([key, value]) => `${labels[key]}: ${Array.isArray(value) ? value.join(', ') : value}`).join(' · ');
}

function preferenceChoiceQuestion(raw: unknown, updated = false): import('@/types/domain').GuidedQuestion {
  const fullSummary = preferenceSummary(raw);
  const summary = fullSummary.length > 120 ? `${fullSummary.slice(0, 117)}…` : fullSummary;
  return preferenceQuestion(updated ? 'preference-choice-updated' : 'preference-choice', `${updated ? 'Updated preferences' : 'You’ve saved preferences'}${summary ? ` (${summary})` : ''}. Should I use them for this request?`, [
    ['use_saved', updated ? 'Use updated preferences' : 'Use saved preferences'], ['customize', 'Customize for this chat'], ...(!updated ? [['update_saved', 'Update saved preferences'] as [string, string]] : []), ['skip', 'Skip'],
  ]);
}

function preferenceEditQuestion(raw: unknown): import('@/types/domain').GuidedQuestion {
  const prefs = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const hasSavedItems = ['mustHaveFeatures', 'must_have_features', 'neverWantFeatures', 'never_want_features']
    .some((key) => Array.isArray(prefs[key]) && (prefs[key] as unknown[]).length > 0);
  const hasSavedFields = ['bodyType', 'body_type', 'fuelType', 'fuel_type', 'budgetMax', 'budget_max']
    .some((key) => prefs[key] !== null && prefs[key] !== undefined && prefs[key] !== '');
  const options: Array<[string, string]> = [['must-add', 'Add a must-have'], ['avoid-add', 'Add something to avoid']];
  if (hasSavedItems) options.push(['remove-saved', 'Remove saved preferences']);
  if (hasSavedFields) options.push(['update-fields', 'Change a saved detail']);
  return preferenceQuestion('preference-field', 'What would you like to change?', options);
}

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

function markdownText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  return Children.toArray(node).map((child) => isValidElement<{ children?: ReactNode }>(child) ? markdownText(child.props.children) : '').join('');
}

function AnswerTable({ children, ...props }: ComponentProps<'table'>) {
  const sections = Children.toArray(children);
  const head = sections.find((section) => isValidElement<{ children?: ReactNode }>(section) && section.type === 'thead');
  const body = sections.find((section) => isValidElement<{ children?: ReactNode }>(section) && section.type === 'tbody');
  const headerRow = head && isValidElement<{ children?: ReactNode }>(head)
    ? Children.toArray(head.props.children).find((row) => isValidElement<{ children?: ReactNode }>(row) && row.type === 'tr')
    : null;
  const labels = headerRow && isValidElement<{ children?: ReactNode }>(headerRow)
    ? Children.toArray(headerRow.props.children).map((cell) => markdownText(isValidElement<{ children?: ReactNode }>(cell) ? cell.props.children : null))
    : [];
  const rows = body && isValidElement<{ children?: ReactNode }>(body)
    ? Children.toArray(body.props.children).map((row) => {
      if (!isValidElement<{ children?: ReactNode }>(row) || row.type !== 'tr') return row;
      let cellIndex = 0;
      const cells = Children.map(row.props.children, (cell) => {
        if (!isValidElement(cell) || cell.type !== 'td') return cell;
        const label = labels[cellIndex++] ?? '';
        return cloneElement(cell as ReactElement<Record<string, unknown>>, { 'data-label': label });
      });
      return cloneElement(row, { children: cells });
    })
    : [];
  return <div className="answer-table-wrap" role="region" aria-label="Vehicle comparison table"><table {...props}>{head}{body && <tbody>{rows}</tbody>}</table></div>;
}

function Answer({ body }: { body: string }) {
  return <div className={`answer-markdown${isVehicleRecommendation(body) ? ' answer-recommendation' : ''}`}><Markdown remarkPlugins={[remarkGfm]} components={{
    a: ({ children, ...props }) => <a {...props} target="_blank" rel="noreferrer">{children}</a>,
    p: ({ children, ...props }) => {
      const first = Children.toArray(children)[0];
      const label = isValidElement<{ children?: ReactNode }>(first) ? Children.toArray(first.props.children).join('') : '';
      return <p {...props} className={label.toLowerCase().startsWith('bottom line') ? 'answer-takeaway' : undefined}>{children}</p>;
    },
    table: ({ children, ...props }) => <AnswerTable {...props}>{children}</AnswerTable>,
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

/**
 * The messages to show for a chat the server already has. The browser's local copy is only a recovery backup and can be
 * stale (it is not updated while Sera is replying), so it never replaces the server's conversation: only its opening
 * greeting, which the server does not store, is kept in front of the server's messages.
 */
export function mergeLocalGreeting(local: AiMessage[] | undefined, server: AiMessage[]): AiMessage[] {
  if (!server.length) return local ?? [];
  const firstBuyerMessage = (local ?? []).findIndex((message) => message.role === 'user');
  const opening = (firstBuyerMessage === -1 ? local ?? [] : (local ?? []).slice(0, firstBuyerMessage))
    .filter((message) => message.role === 'assistant' && !server.some((item) => item.id === message.id || item.body === message.body));
  return [...opening, ...server];
}

export function hasGuidedHistoryOptions(options: string[] | undefined): boolean {
  return (options?.length ?? 0) > 0;
}

/**
 * Which offered option the buyer picked, read from the message they sent next ("Help me choose a car" for "Help me choose"),
 * so the choice still shows after a chat is reopened. Falls back to a choice remembered on this screen.
 */
export function chosenGuidedOption(options: string[] | undefined, nextUserMessage: string | undefined, remembered?: string | null): string | null {
  if (!options?.length) return null;
  const reply = nextUserMessage?.trim().toLowerCase();
  const matched = reply ? options.find((option) => reply === option.toLowerCase() || reply.startsWith(option.toLowerCase())) : undefined;
  return matched ?? (remembered && options.includes(remembered) ? remembered : null);
}

/** The pieces of a mounted Ask Sera screen that a reply in flight updates. */
interface LiveView {
  setStatus: (label: string) => void;
  setMessages: (messages: AiMessage[]) => void;
  setStreaming: (streaming: boolean) => void;
  setStreamingThreadId: (id: string | null) => void;
  setActiveAssistantId: (id: string | null) => void;
  setThreadId: (id: string) => void;
  showThreadInUrl: (id: string) => void;
  refreshThreads: () => Promise<void>;
  setDraft: (draft: RequestDraft | null) => void;
  setPostGate: (gate: ReturnType<typeof postingGate>) => void;
  setPublished: (published: boolean) => void;
  setPublishedRequestId: (id: string | null) => void;
  setCompare: (compare: CompareDraft | null) => void;
  setSources: (sources: VehicleSource[]) => void;
  setMedia: (media: VehicleMedia[]) => void;
  setGuidedStep: (step: GuidedStep | null) => void;
  openCard: (payload: unknown) => void;
  closeCard: () => void;
  askPreference: (question: import('@/types/domain').GuidedQuestion) => void;
  subscription: { canCreate: boolean } | null | undefined;
}

/**
 * Sera's reply in flight, kept outside the screen so it survives leaving Ask Sera: the request keeps running, and when
 * the buyer comes back the screen picks up the status, the partial answer and Stop. While no Ask Sera screen is mounted
 * (`liveViewRef` is null) the reply only updates these holders, so it never touches another page or changes the address.
 */
const liveRunHolders = {
  abortControllerRef: { current: null as AbortController | null },
  activeRunRef: { current: 0 },
  streamingThreadIdRef: { current: null as string | null },
  activeAssistantIdRef: { current: null as string | null },
  liveStatusRef: { current: '' },
  streamedMessagesByThreadRef: { current: {} as Record<string, AiMessage[]> },
  responseUiByThreadRef: { current: {} as Record<string, ThreadResponseUi> },
  /** The chat the mounted screen is showing; undefined when Ask Sera is not on screen. */
  threadIdRef: { current: undefined as string | undefined },
  liveViewRef: { current: null as LiveView | null },
};

/** The same holders for every Ask Sera screen instance, so a reply in flight is shared across visits. */
function useLiveRun() {
  return liveRunHolders;
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
  const [streaming, setStreaming] = useState(() => liveRunHolders.streamingThreadIdRef.current !== null);
  const [activeAssistantId, setActiveAssistantId] = useState<string | null>(null);
  const [stopped, setStopped] = useState(false);
  const [threadId, setThreadId] = useState<string>();
  const [streamingThreadId, setStreamingThreadId] = useState<string | null>(() => liveRunHolders.streamingThreadIdRef.current);
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
  // The start option clicked on this screen; "Ask Sera a question" sends no message, so it is remembered here.
  const [startChoice, setStartChoice] = useState<string | null>(null);
  // How the open chat was started, sent with each message. The server stores it with the thread and only offers
  // the saved-preferences card in chats started with "Ask Sera a question".
  const entryModeRef = useRef<'ask' | 'guided' | undefined>(undefined);
  const [preferenceQuestionCard, setPreferenceQuestionCard] = useState<import('@/types/domain').GuidedQuestion | null>(null);
  const [preferenceStage, setPreferenceStage] = useState<PreferenceStage>('choice');
  const [preferenceEdit, setPreferenceEdit] = useState<PreferenceEdit | null>(null);
  const [preferenceValue, setPreferenceValue] = useState('');
  const [selectedPreferenceValues, setSelectedPreferenceValues] = useState<string[]>([]);
  const [preferenceError, setPreferenceError] = useState('');
  const [preferenceSaving, setPreferenceSaving] = useState(false);
  const [imageLoading, setImageLoading] = useState(false);
  const [imageSearchStatus, setImageSearchStatus] = useState<'idle' | 'loading' | 'found' | 'not_found' | 'unavailable'>('idle');
  const [imageAttempt, setImageAttempt] = useState(0);
  const [publishedRequestId, setPublishedRequestId] = useState<string | null>(null);
  const postBlocked = postGate?.allowed === false;
  const [threadMenuId, setThreadMenuId] = useState<string | null>(null);
  const [deletingThreadId, setDeletingThreadId] = useState<string | null>(null);
  const [threadActionError, setThreadActionError] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  // Shared across visits (see useLiveRun), so a reply started before leaving Ask Sera is still tracked on return.
  const { abortControllerRef, activeRunRef, streamingThreadIdRef, activeAssistantIdRef, liveStatusRef, streamedMessagesByThreadRef, responseUiByThreadRef, threadIdRef, liveViewRef } = useLiveRun();
  const displayedMessagesRef = useRef(messages);
  const threadOpenRunRef = useRef(0);
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
    if (threadIdRef.current === id) liveViewRef.current?.setMessages(next);
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
  }, [abortControllerRef, activeAssistantIdRef, activeRunRef, streamingThreadIdRef]);

  const streamGreeting = useCallback(() => {
    ++greetingRunRef.current;
    const id = createId();
    setMessages([{ id, role: 'assistant', body: greeting, guidedStep: 'start', options: START_OPTIONS }]);
  }, []);

  // `serverMessages` is the conversation the server returned, when it did; the local copy then only adds the greeting.
  const restoreGuidedFlow = useCallback((id: string, serverMessages: AiMessage[] = []) => {
    try {
      const saved = window.localStorage.getItem(`sera-guided-${session?.id}-${id}`);
      if (!saved) { setGuidedStep(null); setPublishedRequestId(null); setPublished(false); return; }
      const flow = JSON.parse(saved) as { guidedStep?: unknown; draft?: RequestDraft | null; messages?: AiMessage[]; publishedRequestId?: string | null; cardAnswers?: GuidedAnswers | null };
      if (serverMessages.length) {
        setMessages(mergeLocalGreeting(flow.messages, serverMessages));
        setGuidedStep(null);
        setDraft(flow.draft ?? null);
        setPublishedRequestId(flow.publishedRequestId ?? null);
        setPublished(Boolean(flow.publishedRequestId));
        return;
      }
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
    entryModeRef.current = undefined;
    setImageAttempt(0);
    threadIdRef.current = id;
    if (!isGeneratingThisThread) {
      setDraft(null);
      setMedia([]); setSources([]);
      setPostGate(null);
      setPublished(false); setPublishedRequestId(null); setEditing(false); card.close(); setGuidedStep(null); setPreferenceQuestionCard(null); setSelectedPreferenceValues([]);
      setCompare(null);
    }
    setThreadLoading(true);
    try {
      if (isGeneratingThisThread) {
        guidedOwnedThreadRef.current = true;
        setThreadId(id);
        setMessages(streamedMessagesByThreadRef.current[id] ?? []);
        setStreaming(true);
        setStreamingThreadId(id);
        setActiveAssistantId(activeAssistantIdRef.current);
        setStatus(liveStatusRef.current);
        const responseUi = responseUiByThreadRef.current[id];
        setDraft(responseUi?.draft ?? null);
        setCompare(responseUi?.compare ?? null);
        setMedia(responseUi?.media ?? []);
        setSources(responseUi?.sources ?? []);
        setPreferenceQuestionCard((responseUi as ThreadResponseUi | undefined)?.preferenceQuestion ?? null);
        setPreferenceStage(responseUi?.preferenceStage ?? 'choice');
        setPreferenceEdit(responseUi?.preferenceEdit ?? null);
        setPreferenceValue(responseUi?.preferenceValue ?? '');
        setSelectedPreferenceValues(responseUi?.selectedPreferenceValues ?? []);
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
          restoreGuidedFlow(thread.id, thread.messages);
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
          setPreferenceQuestionCard(responseUi.preferenceQuestion ?? (thread.preferenceCard ? preferenceChoiceQuestion(thread.preferenceCard.preferences, Boolean(thread.preferenceCard.updated)) : null));
          setPreferenceStage(responseUi.preferenceStage ?? 'choice');
          setPreferenceEdit(responseUi.preferenceEdit ?? null);
          setPreferenceValue(responseUi.preferenceValue ?? '');
          setSelectedPreferenceValues(responseUi.selectedPreferenceValues ?? []);
          setPostGate(responseUi.postGate ?? null);
          setDraft(responseUi.draft ?? (thread.requestContext as RequestDraft | null) ?? null);
          if (responseUi.published) setPublished(true);
          if (responseUi.questionPayload) { setGuidedStep('card'); card.open(responseUi.questionPayload); }
        } else if (thread.preferenceCard) {
          setPreferenceQuestionCard(preferenceChoiceQuestion(thread.preferenceCard.preferences, Boolean(thread.preferenceCard.updated)));
          setPreferenceStage('choice');
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
  }, [activeAssistantIdRef, card, liveStatusRef, responseUiByThreadRef, restoreGuidedFlow, session, setParams, streamGreeting, streamedMessagesByThreadRef, streamingThreadIdRef, threadIdRef]);

  // This is an intentional mount-only bootstrap; each function owns cancellation/error handling.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshThreads();
    void client.requests.list().then(setRequests).catch(() => setRequests([]));
    void client.quotes.list().then(setQuotes).catch(() => setQuotes([]));
    const initialThread = params.get('thread') ?? streamingThreadIdRef.current;
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
  }, [draft, imageAttempt, responseUiByThreadRef, session?.id, threadId, threadIdRef]);
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
    entryModeRef.current = undefined;
    setImageAttempt(0);
    guidedOwnedThreadRef.current = true;
    completedCompareRef.current = false;
    setDraft(null); setMedia([]); setSources([]); setPostGate(null); setCompare(null); setSelected([]); setSelectedQuoteIds([]); setThreadId(id); setPublished(false); setEditing(false); card.close(); setPreferenceQuestionCard(null); setPreferenceEdit(null); setPreferenceValue(''); setSelectedPreferenceValues([]); setPreferenceError(''); setGuidedStep('start'); setPublishedRequestId(null); setSidebarOpen(false); setParams({ thread: id }, { replace: true });
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
    setStartChoice(value);
    entryModeRef.current = value === 'Ask Sera a question' ? 'ask' : 'guided';
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

  function beginPreferenceQuestion(stage: PreferenceStage, question: import('@/types/domain').GuidedQuestion, edit: PreferenceEdit | null = preferenceEdit, value = preferenceValue, selectedValues = selectedPreferenceValues) {
    setPreferenceStage(stage);
    setPreferenceError('');
    setPreferenceQuestionCard(question);
    setSelectedPreferenceValues(selectedValues);
    if (threadIdRef.current) responseUiByThreadRef.current[threadIdRef.current] = {
      ...responseUiByThreadRef.current[threadIdRef.current], preferenceQuestion: question, preferenceStage: stage,
      preferenceEdit: edit, preferenceValue: value, selectedPreferenceValues: selectedValues,
    };
  }

  function closePreferenceQuestion() {
    setPreferenceQuestionCard(null);
    setPreferenceEdit(null);
    setPreferenceValue('');
    setSelectedPreferenceValues([]);
    setPreferenceError('');
    if (threadIdRef.current) responseUiByThreadRef.current[threadIdRef.current] = {
      ...responseUiByThreadRef.current[threadIdRef.current], preferenceQuestion: null, preferenceStage: 'choice', preferenceEdit: null, preferenceValue: '', selectedPreferenceValues: [],
    };
  }

  async function backPreferenceQuestion() {
    if (streaming || preferenceSaving) return;
    if (preferenceStage === 'field' || preferenceStage === 'customize') {
      const ui = responseUiByThreadRef.current[threadIdRef.current ?? ''];
      beginPreferenceQuestion('choice', preferenceChoiceQuestion(ui?.preferenceSnapshot, Boolean(ui?.preferenceUpdated)));
    } else if (preferenceStage === 'update-field') {
      const ui = responseUiByThreadRef.current[threadIdRef.current ?? ''];
      beginPreferenceQuestion('field', preferenceEditQuestion(ui?.preferenceSnapshot));
    } else if (preferenceStage === 'value' && ['body-type', 'fuel-type', 'budget-max'].includes(preferenceEdit ?? '')) {
      const ui = responseUiByThreadRef.current[threadIdRef.current ?? ''];
      const prefs = ui?.preferenceSnapshot ?? {};
      const fields: Array<[string, string]> = [];
      if (prefs.bodyType || prefs.body_type) fields.push(['body-type', 'Body style']);
      if (prefs.fuelType || prefs.fuel_type) fields.push(['fuel-type', 'Fuel type']);
      if (prefs.budgetMax || prefs.budget_max) fields.push(['budget-max', 'Maximum budget']);
      beginPreferenceQuestion('update-field', preferenceQuestion('preference-update-field', 'Which saved detail should I change?', fields), preferenceEdit, preferenceValue, selectedPreferenceValues);
    } else if (preferenceStage === 'value' || preferenceStage === 'remove-select') {
      const ui = responseUiByThreadRef.current[threadIdRef.current ?? ''];
      beginPreferenceQuestion('field', preferenceEditQuestion(ui?.preferenceSnapshot), preferenceEdit, preferenceValue, selectedPreferenceValues);
    } else if (preferenceStage === 'confirm') {
      if (preferenceEdit === 'must-remove' || preferenceEdit === 'avoid-remove' || preferenceEdit === 'remove-saved') {
        setPreferenceSaving(true);
        try {
          const current = await client.profiles.getPreferences();
          const must = current.mustHaveFeatures ?? [];
          const avoid = current.neverWantFeatures ?? [];
          const items: Array<[string, string]> = preferenceEdit === 'must-remove'
            ? must.map((item): [string, string] => [`must:${item}`, `Must-have · ${item}`])
            : preferenceEdit === 'avoid-remove'
              ? avoid.map((item): [string, string] => [`avoid:${item}`, `Avoid · ${item}`])
              : [...must.map((item) => [`must:${item}`, `Must-have · ${item}`] as [string, string]), ...avoid.map((item) => [`avoid:${item}`, `Avoid · ${item}`] as [string, string])];
          beginPreferenceQuestion('remove-select', preferenceQuestion('preference-remove-select', 'Select what to remove', items, false, '', true), preferenceEdit, '', selectedPreferenceValues);
        } catch (error) {
          setPreferenceError(error instanceof Error ? error.message : 'Could not reload your saved preferences.');
        } finally {
          setPreferenceSaving(false);
        }
      } else {
        const actionLabel = preferenceEdit === 'must-add' ? 'What feature should I add as a must-have?' : preferenceEdit === 'avoid-add' ? 'What should I add to your avoid list?' : preferenceEdit === 'body-type' ? 'What body style should I save?' : preferenceEdit === 'fuel-type' ? 'What fuel type should I save?' : 'What maximum budget should I save?';
        const placeholder = preferenceEdit === 'budget-max' ? 'For example: $45,000' : preferenceEdit === 'must-add' || preferenceEdit === 'avoid-add' ? 'Separate multiple items with commas' : 'Enter a preference';
        beginPreferenceQuestion('value', preferenceQuestion('preference-value', actionLabel, [], true, placeholder), preferenceEdit, preferenceValue);
      }
    }
  }

  function dismissPreferenceQuestion() {
    if (streaming || preferenceSaving) return;
    closePreferenceQuestion();
    void send('Skip saved preferences for this chat.', undefined, true, { action: 'skip' }, true);
  }

  async function handlePreferenceText(value: string) {
    const text = value.trim();
    if (!text) return;
    if (preferenceStage === 'customize') {
      closePreferenceQuestion();
      void send(`Use these priorities for this chat: ${text}`, undefined, true, { action: 'customize', chatPreferences: text }, true);
      return;
    }
    if (preferenceStage === 'value') {
      setPreferenceValue(text);
      beginPreferenceQuestion('confirm', preferenceQuestion('preference-confirm', `Save this preference change? “${text}”`, [['save', 'Save change'], ['cancel', 'Cancel']]), preferenceEdit ?? null, text);
    }
  }

  async function savePreferenceChange() {
    const isRemoving = preferenceEdit === 'must-remove' || preferenceEdit === 'avoid-remove' || preferenceEdit === 'remove-saved';
    if (!preferenceEdit || preferenceSaving || (isRemoving ? !selectedPreferenceValues.length : !preferenceValue.trim())) return;
    setPreferenceSaving(true);
    setPreferenceError('');
    try {
      const current = await client.profiles.getPreferences();
      const value = preferenceValue.trim();
      const normalize = (items: string[]) => [...new Map(items.map((item) => item.trim()).filter(Boolean).map((item) => [item.toLocaleLowerCase(), item])).values()];
      const splitPreferences = (input: string) => [...new Map(input.split(',').map((item) => item.trim()).filter(Boolean).map((item) => [item.toLocaleLowerCase(), item])).values()];
      const remove = (items: string[]) => {
        const selected = new Set(selectedPreferenceValues.map((item) => item.trim().toLocaleLowerCase()));
        const remaining = items.filter((item) => !selected.has(item.trim().toLocaleLowerCase()));
        if (!selected.size || items.length - remaining.length < selected.size) throw new Error('One or more selected preferences are no longer saved. Refresh the list and try again.');
        return remaining;
      };
      const updated = { ...current };
      if (preferenceEdit === 'must-add') {
        const additions = splitPreferences(value);
        if (!additions.length) throw new Error('Enter at least one must-have preference.');
        updated.mustHaveFeatures = normalize([...(current.mustHaveFeatures ?? []), ...additions]);
      }
      else if (preferenceEdit === 'avoid-add') {
        const additions = splitPreferences(value);
        if (!additions.length) throw new Error('Enter at least one preference to avoid.');
        updated.neverWantFeatures = normalize([...(current.neverWantFeatures ?? []), ...additions]);
      }
      else if (preferenceEdit === 'must-remove') updated.mustHaveFeatures = remove(current.mustHaveFeatures ?? []);
      else if (preferenceEdit === 'avoid-remove') updated.neverWantFeatures = remove(current.neverWantFeatures ?? []);
      else if (preferenceEdit === 'remove-saved') {
        const selectedMust = new Set(selectedPreferenceValues.filter((item) => item.startsWith('must:')).map((item) => item.slice(5).trim().toLocaleLowerCase()));
        const selectedAvoid = new Set(selectedPreferenceValues.filter((item) => item.startsWith('avoid:')).map((item) => item.slice(6).trim().toLocaleLowerCase()));
        const nextMust = (current.mustHaveFeatures ?? []).filter((item) => !selectedMust.has(item.trim().toLocaleLowerCase()));
        const nextAvoid = (current.neverWantFeatures ?? []).filter((item) => !selectedAvoid.has(item.trim().toLocaleLowerCase()));
        const removed = (current.mustHaveFeatures ?? []).length + (current.neverWantFeatures ?? []).length - nextMust.length - nextAvoid.length;
        if (removed !== selectedPreferenceValues.length) throw new Error('One or more selected preferences are no longer saved. Reload the list and try again.');
        updated.mustHaveFeatures = nextMust;
        updated.neverWantFeatures = nextAvoid;
      }
      else if (preferenceEdit === 'body-type') updated.bodyType = value;
      else if (preferenceEdit === 'fuel-type') updated.fuelType = value;
      else {
        const amount = Number(value.replace(/[$,]/g, '').replace(/k$/i, '000'));
        if (!Number.isFinite(amount) || amount <= 0) throw new Error('Enter a positive maximum budget, such as $45,000.');
        updated.budgetMax = amount;
      }
      await client.profiles.savePreferences(updated);
      closePreferenceQuestion();
      void send('Save this preference change.', undefined, true, { action: 'update_saved' }, true);
    } catch (error) {
      setPreferenceError(error instanceof Error ? error.message : 'Could not save that preference. Please try again.');
    } finally {
      setPreferenceSaving(false);
    }
  }

  async function handlePreferenceAnswer(values: string[]) {
    const value = values[0];
    if (!value) return;
    if (preferenceStage === 'choice') {
      if (value === 'use_saved') {
        closePreferenceQuestion();
        void send('Use my saved preferences for this chat.', undefined, true, { action: 'use_saved' }, true);
      } else if (value === 'customize') {
        beginPreferenceQuestion('customize', preferenceQuestion('preference-customize', 'What should I prioritize for this chat only?', [], true, 'For example: sports cars under $60,000'));
      } else if (value === 'update_saved') {
        const ui = responseUiByThreadRef.current[threadIdRef.current ?? ''];
        beginPreferenceQuestion('field', preferenceEditQuestion(ui?.preferenceSnapshot));
      } else {
        closePreferenceQuestion();
        void send('Skip saved preferences for this chat.', undefined, true, { action: 'skip' }, true);
      }
      return;
    }
    if (preferenceStage === 'field') {
      if (value === 'update-fields') {
        const ui = responseUiByThreadRef.current[threadIdRef.current ?? ''];
        const prefs = ui?.preferenceSnapshot ?? {};
        const fields: Array<[string, string]> = [];
        if (prefs.bodyType || prefs.body_type) fields.push(['body-type', 'Body style']);
        if (prefs.fuelType || prefs.fuel_type) fields.push(['fuel-type', 'Fuel type']);
        if (prefs.budgetMax || prefs.budget_max) fields.push(['budget-max', 'Maximum budget']);
        beginPreferenceQuestion('update-field', preferenceQuestion('preference-update-field', 'Which saved detail should I change?', fields));
        return;
      }
      setPreferenceEdit(value as PreferenceEdit);
      if (value === 'remove-saved') {
        setPreferenceSaving(true);
        try {
          const current = await client.profiles.getPreferences();
          const must = [...new Set((current.mustHaveFeatures ?? []).map((item) => item.trim()).filter(Boolean))];
          const avoid = [...new Set((current.neverWantFeatures ?? []).map((item) => item.trim()).filter(Boolean))];
          const items: Array<[string, string]> = [
            ...must.map((item) => [`must:${item}`, `Must-have · ${item}`] as [string, string]),
            ...avoid.map((item) => [`avoid:${item}`, `Avoid · ${item}`] as [string, string]),
          ];
          beginPreferenceQuestion('remove-select', preferenceQuestion(
            'preference-remove-select', 'Select what to remove', items, false, '', true,
            items.length ? undefined : 'You don’t have saved feature preferences to remove yet.',
          ), 'remove-saved', '', []);
        } catch (error) {
          setPreferenceError(error instanceof Error ? error.message : 'Could not load your saved preferences. Please try again.');
        } finally {
          setPreferenceSaving(false);
        }
        return;
      }
      if (value === 'must-remove' || value === 'avoid-remove') {
        setPreferenceSaving(true);
        try {
          const current = await client.profiles.getPreferences();
          const existingRaw = value === 'must-remove' ? current.mustHaveFeatures ?? [] : current.neverWantFeatures ?? [];
          const existing = [...new Map(existingRaw.map((item) => item.trim()).filter(Boolean).map((item) => [item.toLocaleLowerCase(), item])).values()];
          const title = value === 'must-remove' ? 'Select the must-haves to remove' : 'Select the preferences to remove from your avoid list';
          beginPreferenceQuestion('remove-select', preferenceQuestion(
            'preference-remove-select', title, existing.map((item): [string, string] => [item, item]), false, '', true,
            existing.length ? undefined : 'There are no saved preferences in this list yet.',
          ), value as PreferenceEdit, '', []);
        } catch (error) {
          setPreferenceError(error instanceof Error ? error.message : 'Could not load your saved preferences. Please try again.');
        } finally {
          setPreferenceSaving(false);
        }
        return;
      }
      const actionLabel = value === 'must-add' ? 'What feature should I add as a must-have?' : value === 'avoid-add' ? 'What should I add to your avoid list?' : value === 'body-type' ? 'What body style should I save?' : value === 'fuel-type' ? 'What fuel type should I save?' : 'What maximum budget should I save?';
      const placeholder = value === 'budget-max' ? 'For example: $45,000' : value === 'must-add' || value === 'avoid-add' ? 'Separate multiple items with commas' : 'Enter a preference';
      beginPreferenceQuestion('value', preferenceQuestion('preference-value', actionLabel, [], true, placeholder), value as PreferenceEdit, '');
      return;
    }
    if (preferenceStage === 'update-field') {
      setPreferenceEdit(value as PreferenceEdit);
      const actionLabel = value === 'body-type' ? 'What body style should I save?' : value === 'fuel-type' ? 'What fuel type should I save?' : 'What maximum budget should I save?';
      const placeholder = value === 'budget-max' ? 'For example: $45,000' : 'Enter a preference';
      beginPreferenceQuestion('value', preferenceQuestion('preference-value', actionLabel, [], true, placeholder), value as PreferenceEdit, '');
      return;
    }
    if (preferenceStage === 'remove-select') {
      if (!values.length) return;
      const selectedLabels = preferenceQuestionCard?.options.filter((option) => values.includes(option.value)).map((option) => option.label) ?? values;
      setSelectedPreferenceValues(values);
      const title = `Remove ${selectedLabels.length === 1 ? 'this saved preference' : 'these saved preferences'}? ${selectedLabels.join(', ')}`;
      beginPreferenceQuestion('confirm', preferenceQuestion('preference-confirm-remove', title, [['save', 'Remove selected'], ['cancel', 'Cancel']]), preferenceEdit, '', values);
      return;
    }
    if (preferenceStage === 'confirm') {
      if (value === 'save') void savePreferenceChange();
      else backPreferenceQuestion();
    }
  }

  async function send(value = input, comparison?: CompareSelection, bypassCard = false, preference?: { action: 'use_saved' | 'customize' | 'update_saved' | 'skip' | 'continue_without_saved'; chatPreferences?: string }, hideUserMessage = false) {
    const text = value.trim();
    if (!text || streaming) return;
    let resolvedPreference = preference;
    if (preferenceQuestionCard && !bypassCard && (preferenceStage === 'customize' || preferenceStage === 'value')) {
      setInput('');
      await handlePreferenceText(text);
      return;
    }
    if (preferenceQuestionCard && !bypassCard) {
      closePreferenceQuestion();
      resolvedPreference ??= { action: 'continue_without_saved' };
    }
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
    // Show a new chat at the top of the list straight away; the server's list replaces it once Sera finishes.
    setThreads((items) => items.some((item) => item.id === runThreadId) ? items : [{ id: runThreadId, type: 'sera', title: text.slice(0, 72), updatedAt: new Date().toISOString(), messages: [] }, ...items]);
    const run = ++activeRunRef.current;
    const controller = new AbortController();
    abortControllerRef.current = controller;
    streamingThreadIdRef.current = runThreadId;
    setStreamingThreadId(runThreadId);
    setInput(''); setStopped(false); setCompare(null); setMedia([]); setSources([]); setStreaming(true); setStatus(activity.classifying);
    const assistantId = createId();
    activeAssistantIdRef.current = assistantId;
    setActiveAssistantId(assistantId);
    const transcript = [...(streamedMessagesByThreadRef.current[runThreadId] ?? displayedMessagesRef.current), ...(hideUserMessage ? [] : [{ id: createId(), role: 'user' as const, body: text }]), { id: assistantId, role: 'assistant' as const, body: '' }];
    streamedMessagesByThreadRef.current[runThreadId] = transcript;
    responseUiByThreadRef.current[runThreadId] = { draft, compare: null, media: [], sources: [] };
    if (threadIdRef.current === runThreadId) setMessages(transcript);
    // Only a confirmed picker selection invokes the saved-offer comparison agent. Natural questions such as
    // "compare BMW and Audi" stay in Sera's normal knowledge-backed conversation, even if old selections exist.
    // The loop below can outlive this screen: it updates the mounted Ask Sera screen, if any, never this closure's.
    const view = () => liveViewRef.current;
    const showStatus = (label: string) => { liveStatusRef.current = label; view()?.setStatus(label); };
    const isCompare = Boolean(comparison) || (compareOpen && canCompare);
    completedCompareRef.current = isCompare;
    if (isCompare && guidedStep) { card.close(); setGuidedStep(null); }
    const requestIds = comparison?.requestIds ?? (isCompare && compareMode === 'requests' ? selected : []);
    const quoteIds = comparison?.quoteIds ?? (isCompare && compareMode === 'dealers' ? selectedQuoteIds : []);
    try {
    const requestContext = !isCompare && draft
      ? { ...draft, ...(publishedRequestId ? { publishedRequestId } : {}) }
      : undefined;
    for await (const event of client.ai.chat({ message: text, threadId: runThreadId, agent: isCompare ? 'compare-agent' : 'sera-agent', requestIds, quoteIds, ...(requestContext ? { requestContext } : {}), ...(resolvedPreference ? { preferenceAction: resolvedPreference.action, ...(resolvedPreference.chatPreferences ? { chatPreferences: resolvedPreference.chatPreferences } : {}) } : {}), ...(entryModeRef.current ? { entryMode: entryModeRef.current } : {}), signal: controller.signal })) {
        if (controller.signal.aborted || activeRunRef.current !== run) break;
        if (event.type === 'status') showStatus(event.label || activity[event.phase]);
        if (event.type === 'token') { showStatus(''); updateStreamTranscript(runThreadId, (items) => items.map((item) => item.id === assistantId ? { ...item, body: item.body + event.text } : item)); }
        if (event.type === 'card' && event.kind === 'requestPreview') {
          const nextDraft = normalizeRequestDraft(event.payload);
          const responseUi: ThreadResponseUi = responseUiByThreadRef.current[runThreadId] ?? {};
          const nextGate = postingGate(event.payload);
          responseUiByThreadRef.current[runThreadId] = { ...responseUi, draft: nextDraft, postGate: nextGate, published: Boolean(event.payload && typeof event.payload === 'object' && (event.payload as Record<string, unknown>).status === 'open') };
          if (threadIdRef.current === runThreadId) {
            view()?.setDraft(nextDraft);
            view()?.setPostGate(nextGate);
            if (responseUiByThreadRef.current[runThreadId]?.published) view()?.setPublished(true);
          }
        }
        if (event.type === 'card' && event.kind === 'compare') {
          responseUiByThreadRef.current[runThreadId] = { ...responseUiByThreadRef.current[runThreadId], compare: event.payload as CompareDraft };
          if (threadIdRef.current === runThreadId) view()?.setCompare(event.payload as CompareDraft);
        }
        if (event.type === 'card' && event.kind === 'preference') {
          const preferencePayload = (event.payload as Record<string, unknown> | null) ?? {};
          const question = preferenceChoiceQuestion(preferencePayload.preferences, Boolean(preferencePayload.updated));
          responseUiByThreadRef.current[runThreadId] = { ...responseUiByThreadRef.current[runThreadId], preferenceQuestion: question, preferenceSnapshot: (preferencePayload.preferences as Record<string, unknown>) ?? {}, preferenceUpdated: Boolean(preferencePayload.updated), sources: [], media: [] };
          if (threadIdRef.current === runThreadId) { view()?.setSources([]); view()?.setMedia([]); view()?.askPreference(question); }
        }
        if (event.type === 'card' && event.kind === 'question') {
          if (dismissedGuidedQueryRef.current === text) {
            view()?.closeCard();
            view()?.setGuidedStep(null);
            continue;
          }
          const existingUi: ThreadResponseUi = responseUiByThreadRef.current[runThreadId] ?? {};
          responseUiByThreadRef.current[runThreadId] = { ...existingUi, questionPayload: event.payload, draft: published ? existingUi.draft ?? null : null };
          if (threadIdRef.current === runThreadId) {
            activeGuidedQueryRef.current = text;
            guidedCancelledRef.current = false;
            guidedOwnedThreadRef.current = true;
            if (!published) { view()?.setDraft(null); view()?.setPublishedRequestId(null); }
            if (session?.subscription) view()?.setPostGate({ allowed: session.subscription.canCreate, reason: session.subscription.canCreate ? null : gateReasonFor(session.subscription) });
            view()?.setGuidedStep('card');
            view()?.openCard(event.payload);
          }
        }
        if (event.type === 'media') {
          const items = event.items as VehicleMedia[];
          responseUiByThreadRef.current[runThreadId] = { ...responseUiByThreadRef.current[runThreadId], media: items };
          updateStreamTranscript(runThreadId, (messages) => messages.map((item) => item.id === assistantId ? { ...item, media: items } : item));
          if (threadIdRef.current === runThreadId) view()?.setMedia(items);
        }
        if (event.type === 'sources') {
          const items = event.items as VehicleSource[];
          responseUiByThreadRef.current[runThreadId] = { ...responseUiByThreadRef.current[runThreadId], sources: items };
          updateStreamTranscript(runThreadId, (messages) => messages.map((item) => item.id === assistantId ? { ...item, sources: items } : item));
          if (threadIdRef.current === runThreadId) view()?.setSources(items);
        }
        if (event.type === 'error') {
          showStatus('');
          updateStreamTranscript(runThreadId, (items) => items.map((item) => item.id === assistantId ? { ...item, body: item.body || `## I hit a problem\n${event.message || 'Please try sending that message again.'}` } : item));
        }
        if (event.type === 'done') {
          showStatus('');
          // Only a mounted Ask Sera screen showing this chat follows it in the address; elsewhere nothing moves.
          if (threadIdRef.current === runThreadId) { view()?.setThreadId(event.threadId); view()?.showThreadInUrl(event.threadId); }
          await view()?.refreshThreads();
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
        showStatus('');
        view()?.setActiveAssistantId(null);
        view()?.setStreamingThreadId(null);
        view()?.setStreaming(false);
        // Reopen the finished chat from the server if the buyer is looking at it again after leaving Ask Sera.
        if (!view()) delete streamedMessagesByThreadRef.current[runThreadId];
      }
    }
  }

  // This screen is the one a reply in flight updates, with its current closures; leaving Ask Sera hands back to none.
  // Re-registered after every render on purpose, so the reply always calls this screen's latest closures.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    liveViewRef.current = {
      setStatus, setMessages, setStreaming, setStreamingThreadId, setActiveAssistantId, setThreadId,
      showThreadInUrl: (id) => setParams({ thread: id }, { replace: true }),
      refreshThreads, setDraft, setPostGate, setPublished, setPublishedRequestId, setCompare, setSources, setMedia, setGuidedStep,
      openCard: (payload) => card.open(payload),
      closeCard: () => card.close(),
      askPreference: (question) => beginPreferenceQuestion('choice', question),
      subscription: session?.subscription,
    };
  });
  useEffect(() => () => { liveViewRef.current = null; threadIdRef.current = undefined; }, [liveViewRef, threadIdRef]);

  // Keep the card's hand-off to Sera pointing at the latest send(); it closes over current state.
  useEffect(() => { sendRef.current = (text: string) => { void send(text, undefined, true); }; });
  // The guided question card is the only input while HITL is active. Its own
  // “Something else” field handles free text; showing the general composer here
  // creates two competing reply paths. The composer returns after publish or
  // when the user explicitly chooses Ask Sera a question (guidedStep === null).
  const showComposer = shouldShowAdvisorComposer(guidedStep, Boolean(preferenceQuestionCard));
  const showSuggestedPrompts = !streaming && !guidedStep && messages.length === 0;
  const latestAssistantId = [...messages].reverse().find((message) => message.role === 'assistant')?.id;

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
          {threadLoading ? <div className="advisor-loading"><SerraLoader size={32} label="Opening this chat" /></div> : messages.map((message, messageIndex) => {
            const showStatus = message.id === activeAssistantId && !message.body && Boolean(status);
            const messageMedia = message.media ?? (message.id === latestAssistantId ? media : []);
            const vehicleImages = [...new Map(messageMedia.map((item) => [
              (item.vehicle_name || item.image_url).trim().toLocaleLowerCase(), item,
            ])).values()].slice(0, 6);
            if (!message.body && !showStatus) return null;
            return <article key={message.id} className={`advisor-message ${message.role}`}>
              <div className="message-content">
                <div className={`message-bubble${showStatus ? ' is-status' : ''}`}>{message.body ? <Answer body={message.body} /> : <ActivityStatus label={status} />}</div>
                {message.role === 'assistant' && (message.sources?.length ?? (message.id === latestAssistantId ? sources.length : 0)) > 0 && (message.media?.length ?? (message.id === latestAssistantId ? media.length : 0)) === 0 && <section className="advisor-sources" aria-label="Research sources"><span>Sources</span>{(message.sources ?? (message.id === latestAssistantId ? sources : [])).slice(0, 5).map((item) => <a key={item.url} href={item.url} target="_blank" rel="noreferrer" title={item.title || item.url}>{item.title || item.url}</a>)}</section>}
                {message.role === 'assistant' && vehicleImages.length > 0 && <section className="advisor-chat-media" aria-label="Vehicle images">
                  <p>Photos <span>{vehicleImages.length} matching {vehicleImages.length === 1 ? 'car' : 'cars'} · source links included</span></p>
                  <div className="advisor-chat-media-grid">{vehicleImages.map((item) => <figure key={item.image_url} className="advisor-media-card">
                    <a href={item.source_url} target="_blank" rel="noreferrer" aria-label={`Open ${item.vehicle_name || item.source_name || 'vehicle'} image source`}>
                      <img src={item.thumbnail_url || item.image_url} alt={item.vehicle_name || item.alt || 'Vehicle reference'} width="320" height="200" loading="lazy" onError={(event) => {
                        const image = event.currentTarget;
                        if (image.src !== item.image_url) image.src = item.image_url;
                        else image.closest('figure')?.classList.add('image-unavailable');
                      }} />
                      <figcaption><strong className="advisor-media-caption">{item.vehicle_name || item.source_name || 'Vehicle reference'}</strong><span className="advisor-media-source">{item.source_name || 'Photo source'} · View source ↗</span></figcaption>
                    </a>
                    <span className="advisor-image-unavailable">Image preview unavailable · open source</span>
                  </figure>)}</div>
                </section>}
                {message.role === 'assistant' && message.id === latestAssistantId && !streaming && advisorResponseActions(message.body).length > 0 && <nav className="advisor-response-actions" aria-label="Suggested follow-up questions">
                  {advisorResponseActions(message.body).map((action) => <button type="button" key={action.label} onClick={() => void send(action.prompt)}>{action.label}</button>)}
                </nav>}
                {message.role === 'assistant' && hasGuidedHistoryOptions(message.options) && guidedStep !== 'start' && (() => {
                  const chosen = chosenGuidedOption(message.options, messages.slice(messageIndex + 1).find((item) => item.role === 'user')?.body, startChoice);
                  return <div className="guided-history-options" aria-label="Options Sera offered">{message.options?.map((option) => <span key={option} className={option === chosen ? 'is-chosen' : undefined}>{option === chosen && <Check size={12} aria-hidden="true" />}{option}{option === chosen && <span className="sr-only"> (your choice)</span>}</span>)}</div>;
                })()}
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
          {preferenceQuestionCard ? <QuestionCard key={`${preferenceStage}-${preferenceEdit ?? ''}-${preferenceQuestionCard.id}`} compact showNavigation={false} showBackButton={preferenceStage !== 'choice'} progressText={preferenceStage === 'choice' ? '' : `${({ customize: 'Chat only', field: 'Step 1 of 3', 'update-field': 'Step 2 of 3', value: 'Step 2 of 3', 'remove-select': 'Step 2 of 3', confirm: 'Step 3 of 3' } as Record<PreferenceStage, string>)[preferenceStage]}`} initialSelectedValues={preferenceStage === 'remove-select' ? selectedPreferenceValues : []} question={preferenceQuestionCard} busy={streaming || preferenceSaving} error={preferenceError} canGoBack={false} canGoForward={false} onAnswer={(values) => void handlePreferenceAnswer(values)} onOther={(text) => void handlePreferenceText(text)} onSkip={dismissPreferenceQuestion} onBack={backPreferenceQuestion} onForward={() => undefined} onClose={dismissPreferenceQuestion} /> : card.question ? <QuestionCard key={`${card.question.id}-${card.question.index}`} question={card.question} busy={card.busy} error={card.error} canGoBack={card.canGoBack} canGoForward={card.canGoForward} onAnswer={card.answer} onOther={card.other} onSkip={card.skip} onBack={() => void card.back()} onForward={() => void card.forward()} onClose={closeCard} /> : <div className="advisor-dock-bar">
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

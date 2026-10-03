import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  type Connection,
  type Edge,
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  Activity,
  AlertTriangle,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Clock3,
  Code2,
  Cpu,
  Download,
  Eye,
  GitBranch,
  History,
  LayoutGrid,
  Palette,
  Play,
  Plus,
  Redo2,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Send,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Star,
  TerminalSquare,
  Timer,
  Undo2,
  Users,
  X,
  Zap,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { client } from '@/services/platform/client';
import { useDemoStore } from '@/services/platform/demoStore';
import { applyTheme, refreshActiveTheme, themeHex } from '@/services/platform/theme';
import { PageLoading } from '@/ui/reusables/PageLoading/PageLoading';
import type {
  AdministrationAuditEvent,
  AdminCatalog,
  AdminConfigBundle,
  AdminConfigType,
  AdminPromptBundle,
  AiTraceSpan,
  AiTrace,
  PromptDefinition,
  SupportMember,
  ThemeDefinition,
  WorkflowDefinition,
  WorkflowPreview,
} from '@/types/domain';
import './AdministrationScreen.css';

type Tab = 'overview' | 'workflow' | 'prompts' | 'runtime' | 'theme' | 'team' | 'logs' | 'audit';
type Notice = { kind: 'success' | 'error' | 'info'; text: string } | null;
type ThemeColorKey = 'primary_rgb' | 'background_rgb' | 'surface_rgb' | 'text_rgb' | 'navigation_rgb';
type PreviewPage = 'landing' | 'login' | 'buyer' | 'dealer' | 'support';
type PreviewThreadMode = 'new' | 'continue';

const tabs: Array<{ id: Tab; label: string; icon: typeof Activity }> = [
  { id: 'overview', label: 'Overview', icon: Activity },
  { id: 'workflow', label: 'Workflow', icon: GitBranch },
  { id: 'prompts', label: 'Agents & prompts', icon: Bot },
  { id: 'runtime', label: 'Models & runtime', icon: SlidersHorizontal },
  { id: 'theme', label: 'Brand theme', icon: Palette },
  { id: 'team', label: 'Team & access', icon: Users },
  { id: 'logs', label: 'AI logs & traces', icon: TerminalSquare },
  { id: 'audit', label: 'Versions & audit', icon: History },
];

const conditions: Record<string, string[]> = {
  start: ['always'], triage: ['small_talk', 'web_search', 'default'], classifier: ['off_topic', 'default'],
  orchestrator: ['compare', 'web_direct', 'default'], kb_agent: ['web_per_car', 'default'],
  web_search_agent: ['always'], persist_cars: ['always'], compose: ['always'], small_talk: ['always'],
};

const themeColorLabels: Array<{ key: ThemeColorKey; label: string; description: string }> = [
  { key: 'primary_rgb', label: 'Primary', description: 'Buttons, links and active states' },
  { key: 'background_rgb', label: 'Page background', description: 'The outer application canvas' },
  { key: 'surface_rgb', label: 'Cards and surfaces', description: 'Panels, dialogs and inputs' },
  { key: 'navigation_rgb', label: 'Navigation', description: 'Headers and navigation bars' },
  { key: 'text_rgb', label: 'Text', description: 'Primary readable foreground' },
];

const coreAgentKeys = ['main_agent', 'web_search_agent', 'compare'];
const coreAgentCopy: Record<string, { label: string; description: string }> = {
  main_agent: { label: 'Sera advisor', description: 'Understands the request and coordinates the response.' },
  web_search_agent: { label: 'Trusted research', description: 'Finds and extracts current vehicle evidence.' },
  compare: { label: 'Offer comparison', description: 'Evaluates vehicles and dealer offers side by side.' },
};

const presets = ['#1456b8', '#0b6b57', '#6b3fa0', '#9b3d2f', '#2e485e', '#111827', '#f2f5f8', '#fffdf8'];
const pretty = (value: string) => value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
const clone = <T,>(value: T): T => structuredClone(value);

const arrangedPositions: Record<string, { x: number; y: number }> = {
  triage: { x: 220, y: 235 }, classifier: { x: 440, y: 85 }, orchestrator: { x: 660, y: 85 },
  kb_agent: { x: 880, y: 35 }, web_search_agent: { x: 880, y: 285 }, persist_cars: { x: 1100, y: 285 },
  compose: { x: 1320, y: 160 }, small_talk: { x: 440, y: 405 },
};

function arrangeWorkflow(workflow: WorkflowDefinition): WorkflowDefinition {
  return {
    ...workflow,
    nodes: workflow.nodes.map((node) => ({ ...node, position: arrangedPositions[node.id] ?? node.position })),
  };
}

function hexToRgb(hex: string): number[] | null {
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim());
  return match ? [Number.parseInt(match[1]!, 16), Number.parseInt(match[2]!, 16), Number.parseInt(match[3]!, 16)] : null;
}

function useUndoable<T>(initial: T | null) {
  const [present, setPresent] = useState<T | null>(initial);
  const [past, setPast] = useState<T[]>([]);
  const [future, setFuture] = useState<T[]>([]);
  const reset = useCallback((value: T) => { setPresent(clone(value)); setPast([]); setFuture([]); }, []);
  const change = useCallback((updater: T | ((current: T) => T)) => {
    setPresent((current) => {
      if (current === null) return current;
      const next = typeof updater === 'function' ? (updater as (current: T) => T)(clone(current)) : updater;
      setPast((items) => [...items.slice(-49), clone(current)]);
      setFuture([]);
      return clone(next);
    });
  }, []);
  const undo = useCallback(() => {
    setPast((items) => {
      if (!items.length) return items;
      const previous = items[items.length - 1]!;
      setPresent((current) => { if (current !== null) setFuture((next) => [clone(current), ...next]); return clone(previous); });
      return items.slice(0, -1);
    });
  }, []);
  const redo = useCallback(() => {
    setFuture((items) => {
      if (!items.length) return items;
      const next = items[0]!;
      setPresent((current) => { if (current !== null) setPast((previous) => [...previous, clone(current)]); return clone(next); });
      return items.slice(1);
    });
  }, []);
  return { present, change, reset, undo, redo, canUndo: past.length > 0, canRedo: future.length > 0 };
}

function flowNodes(workflow: WorkflowDefinition, executed: string[] = [], active?: string): Node[] {
  const stateClass = (id: string) => active === id ? ' executing' : executed.includes(id) ? ' executed' : '';
  return [
    { id: 'start', position: { x: 45, y: 235 }, sourcePosition: Position.Right, data: { label: 'Start' }, draggable: false, className: `admin-flow-node start${stateClass('start')}` },
    ...workflow.nodes.map((node) => ({ id: node.id, position: node.position, sourcePosition: Position.Right, targetPosition: Position.Left, data: { label: <span><small>{node.type}</small>{node.label}</span> }, className: `admin-flow-node ${node.type}${stateClass(node.id)}` })),
    { id: 'end', position: { x: 1535, y: 160 }, targetPosition: Position.Left, data: { label: 'End' }, draggable: false, className: `admin-flow-node end${stateClass('end')}` },
  ];
}

function flowEdges(workflow: WorkflowDefinition, executed: string[] = [], active?: string): Edge[] {
  return workflow.edges.map((edge) => {
    const index = executed.indexOf(edge.source);
    const used = index >= 0 && executed[index + 1] === edge.target;
    const running = active === edge.target && executed.at(-1) === edge.source;
    return {
      id: edge.id, source: edge.source, target: edge.target,
      label: edge.condition === 'always' ? undefined : pretty(edge.condition), markerEnd: { type: MarkerType.ArrowClosed },
      reconnectable: true, animated: false, type: 'smoothstep', className: running ? 'executing-edge' : used ? 'executed-edge' : '',
      style: { stroke: used || running ? 'var(--accent)' : 'var(--border-strong)', strokeWidth: used || running ? 2.6 : 1.45 },
      labelStyle: { fill: 'var(--muted)', fontSize: 11, fontWeight: 650 },
      labelShowBg: true,
      labelBgStyle: { fill: 'var(--raised)', fillOpacity: .94 },
      labelBgPadding: [6, 3] as [number, number],
      labelBgBorderRadius: 6,
    };
  });
}

function WorkflowGraph({ workflow, executed, active, running, onConnect, onReconnect, onNodeMoved }: {
  workflow: WorkflowDefinition; executed: string[]; active: string | undefined; running: boolean;
  onConnect: (connection: Connection) => void;
  onReconnect: (oldEdge: Edge, connection: Connection) => void;
  onNodeMoved: (node: Node) => void;
}) {
  const nodes = useMemo(() => flowNodes(workflow, executed, active), [active, executed, workflow]);
  const edges = useMemo(() => flowEdges(workflow, executed, active), [active, executed, workflow]);
  return <div className="workflow-canvas" aria-label="Sera workflow diagram"><ReactFlow
    nodes={nodes}
    edges={edges}
    onConnect={onConnect}
    onReconnect={onReconnect}
    onNodeDragStop={(_, node) => onNodeMoved(node)}
    nodesDraggable={!running}
    fitView
    fitViewOptions={{ padding: .16, duration: 0 }}
    minZoom={0.42}
    maxZoom={1.5}
    edgesReconnectable={!running}
    proOptions={{ hideAttribution: true }}
  ><Background gap={24} size={1} color="var(--border-strong)" /><Controls showInteractive={false} /><MiniMap pannable zoomable nodeColor="var(--accent-soft)" maskColor="rgba(250,249,246,.72)" /></ReactFlow></div>;
}

function RevisionControls<T>({ bundle, type, configKey, busy, onLoad, onChanged }: {
  bundle: AdminConfigBundle<T>; type: AdminConfigType; configKey: string; busy: boolean;
  onLoad: (payload: T) => void; onChanged: (message: string) => Promise<void>;
}) {
  const options = bundle.history.length ? bundle.history : [bundle.active];
  const [selection, setSelection] = useState<number | null>(null);
  const selected = selection != null && options.some((item) => item.version === selection) ? selection : bundle.active.version;
  const revision = options.find((item) => item.version === selected) ?? bundle.active;
  const label = revision.createdBy === 'developer:startup' ? `Developer v${revision.version}` : `Administrator v${revision.version}`;
  return <div className="revision-controls"><div><History size={15} /><select value={selected} onChange={(event) => setSelection(Number(event.target.value))}>{options.map((item) => <option key={item.id} value={item.version}>{item.createdBy === 'developer:startup' ? 'Developer' : 'Administrator'} v{item.version} · {pretty(item.status)}</option>)}</select></div><span>{label}{bundle.defaultVersion === selected ? ' · Default' : ''}</span><button className="button button-secondary button-sm" onClick={() => onLoad(clone(revision.payload))}><Eye size={14} /> Load</button><button className="button button-secondary button-sm" disabled={busy} onClick={() => void client.administration.setDefault(type, configKey, selected).then(() => onChanged(`${label} is now the recovery default.`))}><Star size={14} /> Set default</button><button className="button button-secondary button-sm" disabled={busy} onClick={() => void client.administration.rollback(type, configKey, selected).then(() => onChanged(`${label} was restored as the active version.`))}><RotateCcw size={14} /> Activate</button><button className="button button-ghost button-sm" disabled={busy} onClick={() => void client.administration.reset(type, configKey).then(() => onChanged('The configured default was restored.'))}>Reset to default</button></div>;
}

function HistoryButtons({ canUndo, canRedo, undo, redo }: { canUndo: boolean; canRedo: boolean; undo: () => void; redo: () => void }) {
  return <div className="history-buttons" aria-label="Edit history"><button className="button button-secondary button-sm" disabled={!canUndo} onClick={undo} title="Undo (Ctrl+Z)"><Undo2 size={15} /> Undo</button><button className="button button-secondary button-sm" disabled={!canRedo} onClick={redo} title="Redo (Ctrl+Shift+Z)"><Redo2 size={15} /> Redo</button></div>;
}

export default function AdministrationScreen() {
  const session = useDemoStore((state) => state.session);
  const [tab, setTab] = useState<Tab>('overview');
  const [catalog, setCatalog] = useState<AdminCatalog | null>(null);
  const [workflowBundle, setWorkflowBundle] = useState<AdminConfigBundle<WorkflowDefinition> | null>(null);
  const [themeBundle, setThemeBundle] = useState<AdminConfigBundle<ThemeDefinition> | null>(null);
  const [prompts, setPrompts] = useState<AdminPromptBundle[]>([]);
  const [members, setMembers] = useState<SupportMember[]>([]);
  const [audit, setAudit] = useState<AdministrationAuditEvent[]>([]);
  const [traces, setTraces] = useState<AiTrace[]>([]);
  const workflowHistory = useUndoable<WorkflowDefinition>(null);
  const themeHistory = useUndoable<ThemeDefinition>(null);
  const promptHistory = useUndoable<PromptDefinition>(null);
  const resetWorkflowHistory = workflowHistory.reset;
  const resetThemeHistory = themeHistory.reset;
  const resetPromptHistory = promptHistory.reset;
  const [selectedPromptKey, setSelectedPromptKey] = useState('main_agent');
  const [previewMessage, setPreviewMessage] = useState('Search current Tesla models and explain the main differences.');
  const [preview, setPreview] = useState<WorkflowPreview | null>(null);
  const [streamedAnswer, setStreamedAnswer] = useState('');
  const [liveSpans, setLiveSpans] = useState<AiTraceSpan[]>([]);
  const [liveTraceId, setLiveTraceId] = useState<string | null>(null);
  const [previewThreadMode, setPreviewThreadMode] = useState<PreviewThreadMode>('new');
  const [previewThreadId, setPreviewThreadId] = useState('');
  const [workflowDirty, setWorkflowDirty] = useState(false);
  const [promptDirty, setPromptDirty] = useState(false);
  const [themeDirty, setThemeDirty] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [teamQuery, setTeamQuery] = useState('');

  const load = useCallback(async () => {
    const [nextCatalog, nextWorkflow, nextTheme, nextPrompts, nextAudit, nextMembers, nextTraces] = await Promise.all([
      client.administration.catalog(), client.administration.getConfig<WorkflowDefinition>('workflow', 'sera-main'),
      client.administration.getConfig<ThemeDefinition>('theme', 'global'), client.administration.prompts(),
      client.administration.audit(), client.support.members(), client.administration.traces(),
    ]);
    setCatalog(nextCatalog); setWorkflowBundle(nextWorkflow); setThemeBundle(nextTheme); setPrompts(nextPrompts);
    setAudit(nextAudit); setMembers(nextMembers); setTraces(nextTraces);
    resetWorkflowHistory(nextWorkflow.draft?.payload ?? nextWorkflow.active.payload);
    resetThemeHistory(nextTheme.draft?.payload ?? nextTheme.active.payload);
    setWorkflowDirty(false); setPromptDirty(false); setThemeDirty(false); setLoaded(true);
  }, [resetThemeHistory, resetWorkflowHistory]);

  // The administrator workspace intentionally loads its external API state once on mount.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load().catch((error: Error) => { setNotice({ kind: 'error', text: error.message }); setLoaded(true); }); }, [load]);
  const selectedPrompt = prompts.find((item) => item.key === selectedPromptKey) ?? prompts[0];
  // Selecting a versioned prompt replaces the editor document by design.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (selectedPrompt) { resetPromptHistory(selectedPrompt.draft?.payload ?? selectedPrompt.active.payload); setPromptDirty(false); } }, [resetPromptHistory, selectedPrompt]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'z') return;
      event.preventDefault(); const redo = event.shiftKey;
      if (tab === 'workflow') {
        if (redo) workflowHistory.redo(); else workflowHistory.undo();
      }
      if (tab === 'prompts' || tab === 'runtime') {
        if (redo) promptHistory.redo(); else promptHistory.undo();
      }
      if (tab === 'theme') {
        if (redo) themeHistory.redo(); else themeHistory.undo();
      }
    };
    window.addEventListener('keydown', onKeyDown); return () => window.removeEventListener('keydown', onKeyDown);
  }, [promptHistory, tab, themeHistory, workflowHistory]);

  const runAction = async (key: string, action: () => Promise<void>) => { setBusy(key); setNotice(null); try { await action(); } catch (error) { setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'The change could not be completed.' }); } finally { setBusy(null); } };
  if (!loaded) return <PageLoading label="Opening administration workspace" />;
  const workflow = workflowHistory.present; const theme = themeHistory.present; const prompt = promptHistory.present;
  if (!catalog || !workflowBundle || !themeBundle || !workflow || !theme || !prompt) return <main className="shell page-content"><section className="card card-pad" role="alert"><h1>Administration is unavailable</h1><p className="muted">{notice?.text ?? 'The configuration service did not return a complete workspace.'}</p><button className="button button-secondary" onClick={() => { setLoaded(false); void load(); }}><RefreshCw size={16} /> Retry</button></section></main>;

  const announceReload = async (message: string) => { setNotice({ kind: 'success', text: message }); await load(); };
  const saveWorkflow = async () => { const revision = await client.administration.saveDraft('workflow', catalog.workflowKey, workflow, workflowBundle.active.version); setWorkflowBundle((current) => current ? { ...current, draft: revision, history: [revision, ...current.history.map((item) => item.status === 'draft' ? { ...item, status: 'archived' as const } : item)] } : current); setWorkflowDirty(false); setNotice({ kind: 'success', text: `Workflow draft v${revision.version} saved.` }); };
  const savePrompt = async () => { if (!selectedPrompt) return; const revision = await client.administration.saveDraft<PromptDefinition>('prompt', selectedPrompt.key, prompt, selectedPrompt.active.version); setPrompts((items) => items.map((item) => item.key === selectedPrompt.key ? { ...item, draft: revision, history: [revision, ...item.history.map((entry) => entry.status === 'draft' ? { ...entry, status: 'archived' as const } : entry)] } : item)); setPromptDirty(false); setNotice({ kind: 'success', text: `${selectedPrompt.label} draft v${revision.version} saved.` }); };
  const saveTheme = async () => { const revision = await client.administration.saveDraft<ThemeDefinition>('theme', catalog.themeKey, theme, themeBundle.active.version); setThemeBundle((current) => current ? { ...current, draft: revision, history: [revision, ...current.history.map((item) => item.status === 'draft' ? { ...item, status: 'archived' as const } : item)] } : current); setThemeDirty(false); setNotice({ kind: 'success', text: `Theme draft v${revision.version} saved.` }); };
  const runPreview = async (promptTest = false, forceNewThread = false) => {
    const requestedThread = !forceNewThread && previewThreadMode === 'continue' ? previewThreadId.trim() : undefined;
    if (!forceNewThread && previewThreadMode === 'continue' && !requestedThread) throw new Error('Choose a previous test thread or enter its ID.');
    const previous = { preview, streamedAnswer, liveSpans, liveTraceId };
    let started = false;
    try {
      for await (const event of client.administration.previewStream(previewMessage, { ...(requestedThread ? { threadId: requestedThread } : {}), workflow, ...(promptTest && selectedPrompt ? { promptKey: selectedPrompt.key, prompt } : {}) })) {
        if (event.type === 'started') {
          started = true;
          setPreview(null); setStreamedAnswer(''); setLiveSpans([]);
          setLiveTraceId(event.trace_id);
          if (!forceNewThread) { setPreviewThreadId(event.thread_id); setPreviewThreadMode('continue'); }
        }
        if (event.type === 'step') setLiveSpans((items) => [...items.filter((item) => item.id !== event.span.id), event.span].sort((a, b) => a.sequence - b.sequence));
        if (event.type === 'token') setStreamedAnswer((answer) => answer + event.text);
        if (event.type === 'complete') {
          setPreview(event.result);
          setLiveSpans(event.result.execution_flow);
          if (!forceNewThread) setPreviewThreadId(event.result.thread_id);
          setStreamedAnswer((answer) => answer || event.result.answer || '');
        }
      }
    } catch (error) {
      if (started) {
        setPreview(previous.preview); setStreamedAnswer(previous.streamedAnswer);
        setLiveSpans(previous.liveSpans); setLiveTraceId(previous.liveTraceId);
      }
      throw error;
    }
    setTraces(await client.administration.traces());
  };

  const executionFlow = liveSpans.length ? liveSpans : preview?.execution_flow ?? [];
  const workflowNodeNames = new Set(['start', 'end', ...workflow.nodes.map((node) => node.id)]);
  const completedNames = executionFlow.filter((span) => span.status !== 'running').map((span) => span.name).filter((name) => workflowNodeNames.has(name)).filter((name, index, items) => index === 0 || items[index - 1] !== name);
  const activeExecution = [...executionFlow].reverse().find((span) => span.status === 'running' && workflowNodeNames.has(span.name))?.name;
  const executedNames = completedNames.length ? ['start', ...completedNames, ...(preview && !activeExecution ? ['end'] : [])] : ['start'];
  const recentPreviewThreads = [...new Set(traces.filter((trace) => trace.is_test && trace.thread_id).map((trace) => trace.thread_id!))].slice(0, 8);
  const filteredMembers = members.filter((member) => `${member.name} ${member.email}`.toLowerCase().includes(teamQuery.trim().toLowerCase()));

  return <main className="admin-page"><header className="admin-hero shell"><div><div className="admin-kicker"><ShieldCheck size={15} /> Administrator control plane</div><h1>Operate Sera with guardrails.</h1><p>Configure, test, observe, version and recover every AI control surface.</p></div><div className="admin-runtime-status"><i /><span><strong>Runtime healthy</strong><small>Workflow v{workflowBundle.active.version} · 3 core agents</small></span></div></header><div className="admin-tabs-wrap"><nav className="admin-tabs shell" aria-label="Administration sections">{tabs.map(({ id, label, icon: Icon }) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => { setTab(id); setNotice(null); }}><Icon size={16} />{label}</button>)}</nav></div><div className="shell admin-workspace">
    {notice && <div className={`admin-notice ${notice.kind}`} role="status">{notice.kind === 'success' ? <Check size={17} /> : notice.kind === 'error' ? <X size={17} /> : <CircleDot size={17} />}<span>{notice.text}</span><button onClick={() => setNotice(null)} aria-label="Dismiss message"><X size={15} /></button></div>}
    {tab === 'overview' && <Overview workflowBundle={workflowBundle} themeBundle={themeBundle} prompts={prompts} members={members} audit={audit} traces={traces} onOpen={setTab} />}
    {tab === 'workflow' && <section className="admin-section"><div className="admin-section-head"><div><h2>Sera workflow</h2><p>Reconnect approved nodes, validate the graph, and watch the exact execution route.</p></div><div className="admin-actions"><HistoryButtons {...workflowHistory} /><button className="button button-secondary button-sm" disabled={!!busy} onClick={() => { workflowHistory.change(arrangeWorkflow); setWorkflowDirty(true); }}><LayoutGrid size={15} /> Arrange</button><button className="button button-secondary button-sm" disabled={!!busy} onClick={() => void runAction('validate', async () => { const result = await client.administration.validate('workflow', catalog.workflowKey, workflow as unknown as Record<string, unknown>); setNotice(result.valid ? { kind: 'success', text: 'Workflow is valid and safe to publish.' } : { kind: 'error', text: result.errors.join(' ') }); })}><ShieldCheck size={15} /> Validate</button><button className="button button-secondary button-sm" disabled={!!busy || !workflowDirty} onClick={() => void runAction('save-workflow', saveWorkflow)}><Save size={15} /> Save draft</button><button className="button button-primary button-sm" disabled={!!busy || !workflowBundle.draft || workflowDirty} onClick={() => void runAction('publish-workflow', async () => { await client.administration.publish('workflow', catalog.workflowKey, workflowBundle.draft!.id); await announceReload('The workflow is active for new Sera requests.'); })}><Send size={15} /> Publish</button></div></div><RevisionControls bundle={workflowBundle} type="workflow" configKey={catalog.workflowKey} busy={!!busy} onLoad={(value) => { workflowHistory.reset(value); setWorkflowDirty(true); }} onChanged={announceReload} /><div className="workflow-layout"><aside className="workflow-palette"><h3>Safe node registry</h3><p>Connections are configurable. Executable code is fixed.</p>{catalog.nodes.map((node) => <div key={node.id} className={`palette-node ${node.type}`}><span><Code2 size={14} /></span><div><strong>{node.label}</strong><small>{node.description}</small></div></div>)}</aside><WorkflowGraph workflow={workflow} executed={executedNames} active={activeExecution} running={busy === 'workflow-preview'} onConnect={(connection) => { if (!connection.source || !connection.target || connection.source === 'end' || connection.target === 'start') return; const condition = conditions[connection.source]?.includes('default') ? 'default' : 'always'; workflowHistory.change((current) => ({ ...current, edges: [...current.edges.filter((edge) => !(edge.source === connection.source && edge.condition === condition)), { id: `${connection.source}-${condition}-${connection.target}`, source: connection.source!, target: connection.target!, condition }] })); setWorkflowDirty(true); }} onReconnect={(oldEdge, connection) => { workflowHistory.change((current) => ({ ...current, edges: current.edges.map((edge) => edge.id === oldEdge.id ? { ...edge, source: connection.source ?? edge.source, target: connection.target ?? edge.target, condition: connection.source && connection.source !== edge.source ? (conditions[connection.source]?.includes('default') ? 'default' : 'always') : edge.condition } : edge) })); setWorkflowDirty(true); }} onNodeMoved={(node) => { if (node.id === 'start' || node.id === 'end') return; workflowHistory.change((current) => ({ ...current, nodes: current.nodes.map((item) => item.id === node.id ? { ...item, position: node.position } : item) })); setWorkflowDirty(true); }} /></div><div className="connection-editor"><div className="admin-subhead"><div><h3>Connection rules</h3><p>Keyboard and mobile editor for the same diagram.</p></div><span>{workflow.edges.length} routes</span></div><div className="connection-list">{workflow.edges.map((edge) => <div className="connection-row" key={edge.id}><span className="connection-source">{pretty(edge.source)}</span><select value={edge.condition} onChange={(event) => { workflowHistory.change((current) => ({ ...current, edges: current.edges.map((item) => item.id === edge.id ? { ...item, condition: event.target.value } : item) })); setWorkflowDirty(true); }}>{(conditions[edge.source] ?? [edge.condition]).map((condition) => <option key={condition}>{condition}</option>)}</select><ChevronRight size={15} /><select value={edge.target} onChange={(event) => { workflowHistory.change((current) => ({ ...current, edges: current.edges.map((item) => item.id === edge.id ? { ...item, target: event.target.value } : item) })); setWorkflowDirty(true); }}>{[...workflow.nodes.map((node) => node.id), 'end'].filter((target) => target !== edge.source).map((target) => <option key={target}>{target}</option>)}</select></div>)}</div></div><TestConsole message={previewMessage} setMessage={setPreviewMessage} busy={busy === 'workflow-preview'} onRun={() => void runAction('workflow-preview', () => runPreview(false))} preview={preview} streamedAnswer={streamedAnswer} executionFlow={executionFlow} traceId={liveTraceId} threadMode={previewThreadMode} setThreadMode={setPreviewThreadMode} threadId={previewThreadId} setThreadId={setPreviewThreadId} recentThreadIds={recentPreviewThreads} /></section>}
    {(tab === 'prompts' || tab === 'runtime') && <PromptStudio runtime={tab === 'runtime'} prompts={prompts} selectedPrompt={selectedPrompt!} selectedPromptKey={selectedPromptKey} setSelectedPromptKey={setSelectedPromptKey} prompt={prompt} history={promptHistory} dirty={promptDirty} setDirty={setPromptDirty} catalog={catalog} busy={!!busy} save={() => void runAction('save-prompt', savePrompt)} publish={() => void runAction('publish-prompt', async () => { await client.administration.publish('prompt', selectedPrompt!.key, selectedPrompt!.draft!.id); await announceReload(`${selectedPrompt!.label} is active for new requests.`); })} reload={announceReload} previewMessage={previewMessage} setPreviewMessage={setPreviewMessage} previewBusy={busy === 'prompt-preview'} runPreview={() => void runAction('prompt-preview', () => runPreview(true, true))} preview={preview} streamedAnswer={streamedAnswer} executionFlow={executionFlow} traceId={liveTraceId} />}
    {tab === 'theme' && <ThemeStudio theme={theme} bundle={themeBundle} catalog={catalog} busy={!!busy} history={themeHistory} dirty={themeDirty} setDirty={setThemeDirty} save={() => void runAction('save-theme', saveTheme)} publish={() => void runAction('publish-theme', async () => { await client.administration.publish('theme', catalog.themeKey, themeBundle.draft!.id); await refreshActiveTheme(); await announceReload('The shared theme is active for every visitor.'); })} reload={announceReload} />}
    {tab === 'team' && <section className="admin-section"><div className="admin-section-head"><div><h2>Team & access</h2><p>Administrator access is managed only in this protected workspace.</p></div><span className="admin-count">{filteredMembers.length} members</span></div><label className="admin-search"><Search size={16} /><input value={teamQuery} onChange={(event) => setTeamQuery(event.target.value)} placeholder="Search by name or email" /></label><div className="team-table"><div className="team-row team-head"><span>Member</span><span>Access</span><span>Status</span><span>Last active</span></div>{filteredMembers.map((member) => <div className="team-row" key={member.id}><div className="team-person"><span>{member.name.split(' ').map((part) => part[0]).join('').slice(0, 2)}</span><div><strong>{member.name}</strong><small>{member.email}</small></div></div><div className="role-select-wrap"><select value={member.role} disabled={member.id === session?.id || busy === `member-${member.id}`} onChange={(event) => void runAction(`member-${member.id}`, async () => { const updated = await client.support.updateMemberRole(member.id, event.target.value as SupportMember['role']); setMembers((items) => items.map((item) => item.id === member.id ? updated : item)); setNotice({ kind: 'success', text: `${member.name}'s access was updated.` }); })}><option value="support">Support</option><option value="support-admin">Support administrator</option></select><ChevronDown size={14} /></div><span className={`status ${member.status === 'active' ? 'status-live' : 'status-draft'}`}>{pretty(member.status)}</span><span>{member.lastLoginAt ? new Date(member.lastLoginAt).toLocaleString() : 'Never'}</span></div>)}</div></section>}
    {tab === 'logs' && <TraceDashboard traces={traces} refresh={() => void runAction('refresh-traces', async () => setTraces(await client.administration.traces()))} />}
    {tab === 'audit' && <VersionsAudit workflow={workflowBundle} theme={themeBundle} prompts={prompts} audit={audit} busy={!!busy} reload={announceReload} />}
  </div></main>;
}

function PromptStudio({ runtime, prompts, selectedPrompt, selectedPromptKey, setSelectedPromptKey, prompt, history, dirty, setDirty, catalog, busy, save, publish, reload, previewMessage, setPreviewMessage, previewBusy, runPreview, preview, streamedAnswer, executionFlow, traceId }: {
  runtime: boolean; prompts: AdminPromptBundle[]; selectedPrompt: AdminPromptBundle; selectedPromptKey: string; setSelectedPromptKey: (key: string) => void;
  prompt: PromptDefinition; history: ReturnType<typeof useUndoable<PromptDefinition>>; dirty: boolean; setDirty: (dirty: boolean) => void;
  catalog: AdminCatalog; busy: boolean; save: () => void; publish: () => void; reload: (message: string) => Promise<void>;
  previewMessage: string; setPreviewMessage: (message: string) => void; previewBusy: boolean; runPreview: () => void; preview: WorkflowPreview | null;
  streamedAnswer: string; executionFlow: AiTraceSpan[]; traceId: string | null;
}) {
  const core = prompts.filter((item) => coreAgentKeys.includes(item.key));
  const pipeline = prompts.filter((item) => !coreAgentKeys.includes(item.key));
  const navButton = (item: AdminPromptBundle) => {
    const copy = coreAgentCopy[item.key];
    return <button key={item.key} className={selectedPromptKey === item.key ? 'active' : ''} onClick={() => setSelectedPromptKey(item.key)}><span><Bot size={16} /></span><div><strong>{copy?.label ?? item.label}</strong><small>{copy?.description ?? item.description}</small></div>{item.draft && <i />}</button>;
  };
  return <section className="admin-section"><div className="admin-section-head"><div><h2>{runtime ? 'Models & runtime' : 'Agents & prompts'}</h2><p>{runtime ? 'Choose the model, reasoning level and response budget independently from prompt content.' : 'Three core agents power Sera. Advanced pipeline instructions remain available for precise control.'}</p></div><div className="admin-actions"><HistoryButtons {...history} /><button className="button button-secondary button-sm" disabled={busy || !dirty} onClick={save}><Save size={15} /> Save draft</button><button className="button button-primary button-sm" disabled={busy || !selectedPrompt.draft || dirty} onClick={publish}><Send size={15} /> Publish</button></div></div><RevisionControls bundle={selectedPrompt} type="prompt" configKey={selectedPrompt.key} busy={busy} onLoad={(value) => { history.reset(value); setDirty(true); }} onChanged={reload} /><div className="prompt-layout"><nav className="prompt-list"><div className="prompt-group-label">Core agents</div>{core.map(navButton)}<div className="prompt-group-label">Advanced pipeline</div>{pipeline.map(navButton)}</nav><div className="prompt-editor"><div className="prompt-editor-meta"><div><span>{selectedPrompt.file}</span><strong>{coreAgentCopy[selectedPrompt.key]?.label ?? selectedPrompt.label}</strong></div><div><span className="status status-live">Active v{selectedPrompt.active.version}</span>{selectedPrompt.draft && <span className="status status-draft">Draft v{selectedPrompt.draft.version}</span>}</div></div>{runtime ? <><div className="runtime-explainer"><Cpu size={18} /><div><strong>Runtime settings</strong><p>These settings are versioned with this profile. Publishing changes new requests immediately and keeps earlier versions available for rollback.</p></div></div><div className="agent-runtime-fields runtime-fields-large"><label><span>Model</span><select value={prompt.model} onChange={(event) => { history.change({ ...prompt, model: event.target.value }); setDirty(true); }}>{catalog.models.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}</select><small>{catalog.models.find((model) => model.id === prompt.model)?.description}</small></label><label><span>Reasoning</span><select value={prompt.reasoning_effort} onChange={(event) => { history.change({ ...prompt, reasoning_effort: event.target.value as PromptDefinition['reasoning_effort'] }); setDirty(true); }}>{['minimal', 'low', 'medium', 'high', 'xhigh'].map((effort) => <option key={effort}>{effort}</option>)}</select><small>Higher levels can improve complex decisions but take longer.</small></label><label><span>Max output tokens</span><input type="number" min="128" max="32000" value={prompt.max_output_tokens} onChange={(event) => { history.change({ ...prompt, max_output_tokens: Number(event.target.value) }); setDirty(true); }} /><small>Hard response ceiling for this profile.</small></label></div></> : <><textarea className="prompt-code" spellCheck={false} value={prompt.content} onChange={(event) => { history.change({ ...prompt, content: event.target.value }); setDirty(true); }} /><footer><span>{prompt.content.length.toLocaleString()} characters</span><span>Secrets remain server-managed.</span></footer></>}</div></div><TestConsole title={runtime ? 'Test this runtime profile' : 'Test this prompt'} description="Press Enter to run. Use Shift+Enter for a new line. The test never creates marketplace data." message={previewMessage} setMessage={setPreviewMessage} busy={previewBusy} onRun={runPreview} preview={preview} streamedAnswer={streamedAnswer} executionFlow={executionFlow} traceId={traceId} /></section>;
}

function TestConsole({ title = 'Run the workflow', description = 'Runs the current unpublished configuration without creating marketplace data.', message, setMessage, busy, onRun, preview, streamedAnswer, executionFlow, traceId, threadMode, setThreadMode, threadId, setThreadId, recentThreadIds = [] }: { title?: string; description?: string; message: string; setMessage: (value: string) => void; busy: boolean; onRun: () => void; preview: WorkflowPreview | null; streamedAnswer: string; executionFlow: AiTraceSpan[]; traceId: string | null; threadMode?: PreviewThreadMode; setThreadMode?: (mode: PreviewThreadMode) => void; threadId?: string; setThreadId?: (value: string) => void; recentThreadIds?: string[] }) {
  const showResult = busy || executionFlow.length > 0 || Boolean(preview);
  const submit = () => { if (!busy && message.trim() && (threadMode !== 'continue' || threadId?.trim())) onRun(); };
  return <div className="workflow-test"><div className="admin-subhead"><div><h3>{title}</h3><p>{description}</p></div>{(traceId || preview) && <code>Trace {(traceId ?? preview!.trace_id).slice(0, 8)}</code>}</div>{threadMode && setThreadMode && setThreadId && <div className="test-thread-bar"><div className="thread-mode-switch" aria-label="Test thread mode"><button type="button" className={threadMode === 'new' ? 'active' : ''} disabled={busy} onClick={() => { setThreadMode('new'); setThreadId(''); }}><Plus size={14} /> New thread</button><button type="button" className={threadMode === 'continue' ? 'active' : ''} disabled={busy} onClick={() => setThreadMode('continue')}><History size={14} /> Continue</button></div>{threadMode === 'continue' && <label className="thread-id-field"><span>Thread ID</span><input value={threadId} disabled={busy} list="workflow-preview-threads" onChange={(event) => setThreadId(event.target.value)} placeholder="Choose or paste a test thread ID" /><datalist id="workflow-preview-threads">{recentThreadIds.map((id) => <option key={id} value={id} />)}</datalist></label>}<span className="thread-context-note">{threadMode === 'new' ? 'Starts with clean context' : 'Uses the previous turns in this test thread'}</span></div>}<form className="workflow-test-form" onSubmit={(event) => { event.preventDefault(); submit(); }}><textarea value={message} onChange={(event) => setMessage(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} rows={1} placeholder="Enter a realistic user query" aria-label="Workflow test query" /><button type="submit" className="button button-primary button-sm workflow-run-button" disabled={busy || !message.trim() || (threadMode === 'continue' && !threadId?.trim())}><Play size={15} /> {busy ? 'Running' : 'Run'}</button></form>{showResult && <div className="test-result-grid"><div className="execution-timeline">{executionFlow.map((span, index) => <div key={span.id} className={`execution-step ${span.status === 'running' ? 'active' : ''}`}><span>{index + 1}</span><div><strong>{pretty(span.name)}</strong><small>{span.status === 'running' ? 'Running now' : `${pretty(span.kind)} · ${span.duration_ms.toLocaleString()} ms`}</small></div>{span.status === 'running' ? <i className="live-stage-indicator" /> : <Check size={14} />}</div>)}{executionFlow.length === 0 && busy && <div className="execution-awaiting"><span className="live-stage-indicator" /><div><strong>Connecting to workflow</strong><small>The diagram stays available while the stream starts</small></div></div>}</div><div className="stream-response"><div className="trace-metrics"><span><Timer size={14} /> {preview ? `${preview.duration_ms.toLocaleString()} ms` : 'Live'}</span><span><Cpu size={14} /> {preview?.model_name ?? (busy ? 'Model pending' : 'Fallback')}</span><span><Zap size={14} /> {preview ? `${(preview.input_tokens + preview.output_tokens).toLocaleString()} tokens` : 'Counting tokens'}</span>{(preview?.thread_id || threadId) && <span title={preview?.thread_id || threadId}>Thread {(preview?.thread_id || threadId)!.slice(-12)}</span>}</div><div className="admin-markdown" aria-live="polite">{streamedAnswer ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{streamedAnswer}</ReactMarkdown> : <div className="response-waiting"><span className="live-stage-indicator" /><span>{executionFlow.length ? 'Building the response from completed stages' : 'Preparing the configured route'}</span></div>}{busy && <span className="typing-caret" />}</div></div></div>}</div>;
}

function ThemeStudio({ theme, bundle, catalog, busy, history, dirty, setDirty, save, publish, reload }: { theme: ThemeDefinition; bundle: AdminConfigBundle<ThemeDefinition>; catalog: AdminCatalog; busy: boolean; history: ReturnType<typeof useUndoable<ThemeDefinition>>; dirty: boolean; setDirty: (value: boolean) => void; save: () => void; publish: () => void; reload: (message: string) => Promise<void> }) {
  const [colorKey, setColorKey] = useState<ThemeColorKey>('primary_rgb'); const [previewPage, setPreviewPage] = useState<PreviewPage>('landing');
  const previewRef = useRef<HTMLIFrameElement>(null);
  const activeTheme = useRef(bundle.active.payload);
  useEffect(() => { activeTheme.current = bundle.active.payload; }, [bundle.active.payload]);
  useEffect(() => { applyTheme(theme); }, [theme]);
  useEffect(() => () => applyTheme(activeTheme.current), []);
  const setColor = (rgb: number[]) => { history.change({ ...theme, [colorKey]: rgb }); setDirty(true); };
  const routes: Record<PreviewPage, string> = { landing: '/?themePreview=1', login: '/login?themePreview=1', buyer: '/home?themePreview=1&adminPreview=buyer', dealer: '/home?themePreview=1&adminPreview=dealer', support: '/support?themePreview=1&adminPreview=support' };
  const sendTheme = useCallback(() => previewRef.current?.contentWindow?.postMessage({ type: 'drivedeal-theme-preview', theme }, window.location.origin), [theme]);
  useEffect(() => { sendTheme(); }, [previewPage, sendTheme]);
  return <section className="admin-section"><div className="admin-section-head"><div><h2>Brand theme studio</h2><p>Control the semantic color system and inspect it inside the real Deal&amp;Drive interface.</p></div><div className="admin-actions"><HistoryButtons {...history} /><button className="button button-secondary button-sm" disabled={busy || !dirty} onClick={save}><Save size={15} /> Save draft</button><button className="button button-primary button-sm" disabled={busy || !bundle.draft || dirty} onClick={publish}><Send size={15} /> Publish globally</button></div></div><RevisionControls bundle={bundle} type="theme" configKey={catalog.themeKey} busy={busy} onLoad={(value) => { history.reset(value); setDirty(true); }} onChanged={reload} /><div className="theme-studio-layout"><div className="theme-token-list"><label><span>Theme name</span><input value={theme.name} onChange={(event) => { history.change({ ...theme, name: event.target.value }); setDirty(true); }} /></label>{themeColorLabels.map((item) => <button key={item.key} className={colorKey === item.key ? 'active' : ''} onClick={() => setColorKey(item.key)}><i style={{ background: themeHex(theme[item.key]) }} /><span><strong>{item.label}</strong><small>{item.description}</small></span><code>{themeHex(theme[item.key])}</code></button>)}</div><div className="color-studio"><div className="color-stage" style={{ backgroundColor: themeHex(theme[colorKey]) }}><input type="color" value={themeHex(theme[colorKey])} onChange={(event) => setColor(hexToRgb(event.target.value) ?? theme[colorKey])} aria-label={`Choose ${colorKey}`} /><span>Click to open the system color picker</span></div><div className="color-values"><label><span>HEX</span><input value={themeHex(theme[colorKey])} onChange={(event) => { const rgb = hexToRgb(event.target.value); if (rgb) setColor(rgb); }} /></label>{['R', 'G', 'B'].map((channel, index) => <label key={channel}><span>{channel}</span><input type="number" min="0" max="255" value={theme[colorKey][index]} onChange={(event) => { const values = [...theme[colorKey]]; values[index] = Math.max(0, Math.min(255, Number(event.target.value))); setColor(values); }} /></label>)}</div><div className="color-presets"><span>Presets</span>{presets.map((value) => <button key={value} style={{ background: value }} onClick={() => setColor(hexToRgb(value)!)} aria-label={`Use ${value}`} />)}</div><div className="theme-live-note"><Sparkles size={15} /><span>Changes are live in the preview. Undo restores every visible color.</span></div></div></div><div className="preview-workspace"><div className="preview-toolbar"><div><strong>Real application preview</strong><small>This is the actual frontend, isolated from production data while you edit.</small></div><label><span>Screen</span><select value={previewPage} onChange={(event) => setPreviewPage(event.target.value as PreviewPage)}>{(['landing', 'login', 'buyer', 'dealer', 'support'] as PreviewPage[]).map((page) => <option key={page} value={page}>{pretty(page)}</option>)}</select></label></div><div className="application-preview"><iframe key={previewPage} ref={previewRef} src={routes[previewPage]} title={`${pretty(previewPage)} theme preview`} onLoad={sendTheme} /></div></div></section>;
}

function TraceDashboard({ traces, refresh }: { traces: AiTrace[]; refresh: () => void }) {
  const [query, setQuery] = useState(''); const [selected, setSelected] = useState<AiTrace | null>(null); const [detail, setDetail] = useState<AiTrace | null>(null); const [detailError, setDetailError] = useState('');
  const filtered = traces.filter((trace) => `${trace.query} ${trace.route} ${trace.model_name} ${trace.status}`.toLowerCase().includes(query.toLowerCase()));
  const totalTokens = traces.reduce((sum, trace) => sum + trace.input_tokens + trace.output_tokens, 0); const averageDuration = traces.length ? Math.round(traces.reduce((sum, trace) => sum + trace.duration_ms, 0) / traces.length) : 0;
  const openTrace = (trace: AiTrace) => { setSelected(trace); setDetail(null); setDetailError(''); void client.administration.trace(trace.id).then(setDetail).catch((error: Error) => setDetailError(error.message)); };
  return <section className="admin-section"><div className="admin-section-head"><div><h2>AI logs & traces</h2><p>Inspect the complete handoff path, prompt, result, model usage, timing and token cost for every query.</p></div><button className="button button-secondary button-sm" onClick={refresh}><RefreshCw size={15} /> Refresh</button></div><div className="trace-summary"><article><Activity size={17} /><span><small>Total traces</small><strong>{traces.length}</strong></span></article><article><Timer size={17} /><span><small>Average duration</small><strong>{averageDuration.toLocaleString()} ms</strong></span></article><article><Zap size={17} /><span><small>Total tokens</small><strong>{totalTokens.toLocaleString()}</strong></span></article><article><X size={17} /><span><small>Failed</small><strong>{traces.filter((trace) => trace.status !== 'success').length}</strong></span></article></div><label className="admin-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search query, route, model or status" /></label><div className="trace-table"><div className="trace-row trace-head"><span>Query</span><span>Route / model</span><span>Tokens</span><span>Duration</span><span>Status</span></div>{filtered.map((trace) => <button type="button" className={`trace-row ${selected?.id === trace.id ? 'selected' : ''}`} key={trace.id} onClick={() => openTrace(trace)}><span><strong>{trace.query}</strong><small>{new Date(trace.created_at).toLocaleString()} {trace.is_test ? '· Test run' : ''}</small></span><span><strong>{pretty(trace.route ?? 'pending')}</strong><small>{trace.model_name ?? 'No model call'}</small></span><span>{(trace.input_tokens + trace.output_tokens).toLocaleString()}</span><span>{trace.duration_ms.toLocaleString()} ms</span><span className={`status ${trace.status === 'success' ? 'status-live' : 'status-draft'}`}>{pretty(trace.status)}</span></button>)}</div>{selected && <div className="trace-drawer-backdrop" onMouseDown={() => setSelected(null)}><aside className="trace-drawer" role="dialog" aria-modal="true" aria-label={`Trace details for ${selected.query}`} onMouseDown={(event) => event.stopPropagation()}><header><div><span>Trace {selected.id.slice(0, 8)}</span><h3>{selected.query}</h3></div><button onClick={() => setSelected(null)} aria-label="Close trace details"><X /></button></header>{detailError ? <div className="trace-detail-error"><AlertTriangle size={18} /><div><strong>Trace details could not be loaded</strong><p>{detailError}</p></div><button className="button button-secondary button-sm" onClick={() => openTrace(selected)}>Retry</button></div> : !detail ? <div className="trace-detail-loading"><span /><strong>Loading agent stages</strong></div> : <><div className="trace-detail-metrics"><span><Timer size={15} /> {detail.duration_ms.toLocaleString()} ms</span><span><Zap size={15} /> {(detail.input_tokens + detail.output_tokens).toLocaleString()} tokens</span><span><Cpu size={15} /> {detail.model_name ?? 'No model'}</span></div><div className="trace-flow verbose-trace-flow">{(detail.spans ?? []).map((span, index) => <TraceSpanCard key={span.id} span={span} index={index} />)}</div>{(detail.spans ?? []).length === 0 && <p className="muted">No agent spans were recorded for this trace.</p>}</>}</aside></div>}</section>;
}

function TraceSpanCard({ span, index }: { span: AiTraceSpan; index: number }) {
  const details = span.details ?? {};
  const formatValue = (value: unknown) => typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  const hasDetails = details.input != null || details.output != null || details.error != null;
  return <details className="trace-span-card" open={span.kind === 'llm'}><summary><span>{index + 1}</span><div><strong>{pretty(span.name)}</strong><small>{pretty(span.kind)} · {span.duration_ms.toLocaleString()} ms · {span.input_tokens.toLocaleString()} in / {span.output_tokens.toLocaleString()} out{span.model_name ? ` · ${span.model_name}` : ''}</small></div><span className={`trace-llm-flag ${details.llm_called ? 'yes' : ''}`}>{details.llm_called ? 'LLM' : 'No LLM'}</span><ChevronDown size={15} /></summary>{hasDetails && <div className="trace-span-body"><div className="trace-handoff"><span>Next handoff</span><strong>{pretty(String(details.next_step ?? 'response'))}</strong></div>{details.provider != null && <div className="trace-facts"><span>Provider <strong>{String(details.provider)}</strong></span><span>Prompt version <strong>{String(details.prompt_version ?? 'default')}</strong></span><span>Reasoning <strong>{String(details.reasoning_effort ?? 'default')}</strong></span><span>Attempts <strong>{String(details.attempt_count ?? 1)}</strong></span></div>}{details.input != null && <section><h4>{span.kind === 'llm' ? 'Prompt sent to model' : 'Stage input'}</h4><pre>{formatValue(details.input)}</pre></section>}{details.output != null && <section><h4>{span.kind === 'llm' ? 'Model output' : 'Stage output'}</h4><pre>{formatValue(details.output)}</pre></section>}{details.error != null && <section className="trace-error-block"><h4>Error</h4><pre>{formatValue(details.error)}</pre></section>}</div>}</details>;
}

function VersionsAudit({ workflow, theme, prompts, audit, busy, reload }: { workflow: AdminConfigBundle<WorkflowDefinition>; theme: AdminConfigBundle<ThemeDefinition>; prompts: AdminPromptBundle[]; audit: AdministrationAuditEvent[]; busy: boolean; reload: (message: string) => Promise<void> }) {
  const groups: Array<{ label: string; type: AdminConfigType; key: string; bundle: AdminConfigBundle<unknown> }> = [{ label: 'Workflow', type: 'workflow', key: 'sera-main', bundle: workflow }, { label: 'Brand theme', type: 'theme', key: 'global', bundle: theme }, ...prompts.map((item) => ({ label: item.label, type: 'prompt' as const, key: item.key, bundle: item as AdminConfigBundle<unknown> }))];
  return <section className="admin-section"><div className="admin-section-head"><div><h2>Versions & audit</h2><p>Developer and administrator versions remain immutable, attributable and recoverable.</p></div><div className="admin-actions"><button className="button button-secondary button-sm" disabled={busy} onClick={() => void client.administration.exportConfiguration('yaml')}><Download size={15} /> Export YAML</button><button className="button button-secondary button-sm" disabled={busy} onClick={() => void client.administration.exportConfiguration('json')}><Download size={15} /> Export JSON</button></div></div><div className="export-note"><Code2 size={17} /><div><strong>Repository-safe configuration snapshot</strong><p>Downloads every active workflow, prompt, model setting and theme token. Credentials, access tokens and passwords are excluded.</p></div></div><div className="all-version-grid">{groups.map((group) => <article key={`${group.type}-${group.key}`}><header><strong>{group.label}</strong><span>Default v{group.bundle.defaultVersion}</span></header>{group.bundle.history.slice(0, 6).map((revision) => <div key={revision.id}><span className={`version-dot ${revision.status}`} /><div><strong>{revision.createdBy === 'developer:startup' ? 'Developer' : 'Administrator'} v{revision.version}</strong><small>{pretty(revision.status)} · {revision.createdAt ? new Date(revision.createdAt).toLocaleString() : 'Built in'}</small></div>{group.bundle.defaultVersion === revision.version && <Star size={14} />}<button disabled={busy} onClick={() => void client.administration.rollback(group.type, group.key, revision.version).then(() => reload(`${group.label} v${revision.version} was activated.`))}>Activate</button></div>)}</article>)}</div><div className="admin-panel"><div className="admin-subhead"><div><h3>Administration activity</h3><p>Append-only privileged changes from administrators and deployments.</p></div></div><div className="audit-list">{audit.map((event) => <div key={event.uuid}><span><Clock3 size={15} /></span><div><strong>{pretty(event.action)} · {pretty(event.resourceKey)}</strong><small>{new Date(event.createdAt).toLocaleString()} · {event.actorId === 'developer:startup' ? 'Developer startup' : `Actor ${event.actorId.slice(0, 8)}`}</small></div><code>v{String(event.details.version ?? '')}</code></div>)}</div></div></section>;
}

function Overview({ workflowBundle, themeBundle, prompts, members, audit, traces, onOpen }: { workflowBundle: AdminConfigBundle<WorkflowDefinition>; themeBundle: AdminConfigBundle<ThemeDefinition>; prompts: AdminPromptBundle[]; members: SupportMember[]; audit: AdministrationAuditEvent[]; traces: AiTrace[]; onOpen: (tab: Tab) => void }) {
  const drafts = Number(Boolean(workflowBundle.draft)) + Number(Boolean(themeBundle.draft)) + prompts.filter((item) => item.draft).length;
  return <section className="admin-overview"><div className="admin-metrics"><article><span><GitBranch size={18} /></span><div><small>Active workflow</small><strong>Version {workflowBundle.active.version}</strong><p>{workflowBundle.active.payload.nodes.length} nodes · {workflowBundle.active.payload.edges.length} routes</p></div></article><article><span><Bot size={18} /></span><div><small>Core agents</small><strong>3</strong><p>{prompts.length} versioned instruction profiles</p></div></article><article><span><Save size={18} /></span><div><small>Unpublished work</small><strong>{drafts}</strong><p>{drafts ? 'Review before publishing' : 'Production aligned'}</p></div></article><article><span><TerminalSquare size={18} /></span><div><small>AI traces</small><strong>{traces.length}</strong><p>{traces.filter((trace) => trace.is_test).length} test runs</p></div></article></div><div className="admin-overview-grid"><div className="admin-panel"><div className="admin-subhead"><div><h2>Control surfaces</h2><p>Each surface has independent version and recovery controls.</p></div></div>{[{ tab: 'workflow' as Tab, icon: GitBranch, title: 'Workflow routing', note: 'Reconnect safe agents and tools' }, { tab: 'prompts' as Tab, icon: Bot, title: 'Agents & prompts', note: 'Core agents and advanced pipeline instructions' }, { tab: 'runtime' as Tab, icon: SlidersHorizontal, title: 'Models & runtime', note: 'Models, reasoning and response limits' }, { tab: 'theme' as Tab, icon: Palette, title: 'Semantic brand theme', note: `${themeHex(themeBundle.active.payload.primary_rgb)} primary` }, { tab: 'logs' as Tab, icon: Activity, title: 'AI observability', note: 'Tokens, latency and execution paths' }].map((item) => <button key={item.tab} onClick={() => onOpen(item.tab)}><span className="admin-panel-icon"><item.icon size={18} /></span><div><strong>{item.title}</strong><small>{item.note}</small></div><ChevronRight size={16} /></button>)}</div><div className="admin-panel"><div className="admin-subhead"><div><h2>Recent activity</h2><p>{members.length} support members · {Math.min(audit.length, 5)} latest changes</p></div><button onClick={() => onOpen('audit')}>View all</button></div><div className="overview-activity">{audit.slice(0, 5).map((event) => <button type="button" key={event.uuid} onClick={() => onOpen('audit')}><span><Clock3 size={14} /></span><div><strong>{pretty(event.action)}</strong><small>{pretty(event.resourceKey)} · {new Date(event.createdAt).toLocaleString()}</small></div><ChevronRight size={14} /></button>)}</div></div></div></section>;
}

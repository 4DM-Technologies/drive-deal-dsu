import { useCallback, useRef, useState } from 'react';
import { client } from '@/services/platform/client';
import type { GuidedActionInput, GuidedAnswers, GuidedQuestion, GuidedStepResult } from '@/types/domain';

export type GuidedEntry = 'button' | 'explore';

/** One answer the buyer gave, kept so "back" can be undone with "forward". */
interface Given { questionId: string; skipped: boolean; values: string[]; text?: string; label: string }

export interface GuidedCardCallbacks {
  /** Lines to add to the chat transcript: the question asked and the buyer's answer. */
  onTranscript: (lines: Array<{ role: 'assistant' | 'user'; body: string }>) => void;
  /** All questions answered: the finished request draft for the review card. */
  onDraft: (draft: Record<string, string>) => void;
  /** Typed text the card could not use, usually a question for Sera. */
  onUnresolved: (text: string) => void;
}

/**
 * State and actions of Sera's guided question card. The backend planner (POST /ai/guided/next) decides every
 * question; this hook keeps the current answers, a back/forward history and the chat transcript in sync.
 */
export function useGuidedCard({ onTranscript, onDraft, onUnresolved }: GuidedCardCallbacks) {
  const [answers, setAnswers] = useState<GuidedAnswers | null>(null);
  const [question, setQuestion] = useState<GuidedQuestion | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const historyRef = useRef<Given[]>([]);
  const redoRef = useRef<Given[]>([]);
  const [redoCount, setRedoCount] = useState(0);
  const requestRef = useRef(0);

  const resetStacks = useCallback(() => {
    historyRef.current = [];
    redoRef.current = [];
    setRedoCount(redoRef.current.length);
  }, []);

  const close = useCallback(() => {
    requestRef.current += 1;
    setAnswers(null);
    setQuestion(null);
    setBusy(false);
    setError('');
    resetStacks();
  }, [resetStacks]);

  const apply = useCallback((result: GuidedStepResult) => {
    setAnswers(result.answers);
    setQuestion(result.question);
    // Keep field validation next to the active question instead of repeating it in the chat transcript.
    setError(result.message ?? '');
    if (!result.question && result.draft) {
      onDraft(result.draft);
      setAnswers(null);
    }
  }, [onDraft]);

  const call = useCallback(async (base: GuidedAnswers, action: GuidedActionInput) => {
    const run = ++requestRef.current;
    setBusy(true);
    setError('');
    try {
      const result = await client.ai.guidedNext(base, action);
      return run === requestRef.current ? result : null;
    } catch (caught) {
      if (run === requestRef.current) setError(caught instanceof Error ? caught.message : 'Sera could not load the next question.');
      return null;
    } finally {
      if (run === requestRef.current) setBusy(false);
    }
  }, []);

  const begin = useCallback(async (base: GuidedAnswers) => {
    resetStacks();
    const result = await call(base, { type: 'resume' });
    if (result) apply(result);
  }, [apply, call, resetStacks]);

  /** Start from one of the greeting buttons. */
  const start = useCallback((entry: GuidedEntry) => begin({ entry }), [begin]);
  /** Show the card the chat stream opened ("I want a BMW M3"); its payload carries the planner's answers. */
  const open = useCallback((payload: unknown) => {
    const row = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
    void begin((row.answers as GuidedAnswers | undefined) ?? {});
  }, [begin]);
  /** Rebuild the current question after a reload, from the saved answers. */
  const restore = useCallback((saved: GuidedAnswers) => begin(saved), [begin]);

  const give = useCallback(async (given: Given, replay = false) => {
    if (!answers || !question || question.id !== given.questionId && !replay) return;
    const asked = question;
    const action: GuidedActionInput = given.skipped
      ? { type: 'skip', questionId: asked.id }
      : { type: 'answer', questionId: asked.id, values: given.values, ...(given.text ? { text: given.text } : {}) };
    const result = await call(answers, action);
    if (!result) return;
    if (result.unresolved) {
      close();
      onUnresolved(given.text ?? given.label);
      return;
    }
    historyRef.current = [...historyRef.current, { ...given, questionId: asked.id }];
    if (!replay) redoRef.current = [];
    setRedoCount(redoRef.current.length);
    onTranscript([{ role: 'assistant', body: asked.title }, { role: 'user', body: given.skipped ? 'Skipped' : given.label }]);
    apply(result);
  }, [answers, apply, call, close, onTranscript, onUnresolved, question]);

  const answer = useCallback((values: string[], labels: string[]) => {
    if (question) void give({ questionId: question.id, skipped: false, values, label: labels.join(', ') });
  }, [give, question]);
  const other = useCallback((text: string) => {
    if (question) void give({ questionId: question.id, skipped: false, values: [], text, label: text });
  }, [give, question]);
  const skip = useCallback(() => {
    if (question) void give({ questionId: question.id, skipped: true, values: [], label: 'Skipped' });
  }, [give, question]);

  const back = useCallback(async () => {
    if (!answers || !((answers.answered as string[] | undefined) ?? []).length) return;
    const result = await call(answers, { type: 'back' });
    if (!result) return;
    const undone = historyRef.current.at(-1);
    if (undone) {
      historyRef.current = historyRef.current.slice(0, -1);
      redoRef.current = [...redoRef.current, undone];
      setRedoCount(redoRef.current.length);
    }
    apply(result);
  }, [answers, apply, call]);

  /** Forward replays the answer that "back" undid. */
  const forward = useCallback(async () => {
    const next = redoRef.current.at(-1);
    if (!next) return;
    redoRef.current = redoRef.current.slice(0, -1);
    await give(next, true);
  }, [give]);

  return {
    answers,
    question,
    busy,
    error,
    active: Boolean(question),
    canGoBack: ((answers?.answered as string[] | undefined) ?? []).length > 0,
    canGoForward: redoCount > 0,
    start,
    open,
    restore,
    answer,
    other,
    skip,
    back,
    forward,
    close,
  };
}

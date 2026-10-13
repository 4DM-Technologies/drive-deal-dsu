import { useEffect, useRef, useState } from 'react';
import { BROWSER_STORAGE_KEYS } from '@/config/browser';
import { environment } from '@/config/environment';

/** Sent by the API when a conversation changes. It carries no message content: the screen refetches the thread. */
export interface ChatUpdatedEvent {
  type: 'chat.updated';
  quote_id: string;
  event: string;
}

type Listener = (event: ChatUpdatedEvent) => void;
type StatusListener = (live: boolean) => void;

const PING_EVERY_MS = 25_000;
const MAX_RETRY_MS = 30_000;
/** The API closes with this code when the access token is missing, expired or not an access token. */
const UNAUTHORISED_CLOSE = 4401;

const listeners = new Set<Listener>();
const statusListeners = new Set<StatusListener>();
let socket: WebSocket | null = null;
let live = false;
let retryMs = 1_000;
let retryTimer: number | undefined;
let pingTimer: number | undefined;

function setLive(next: boolean) {
  if (live === next) return;
  live = next;
  statusListeners.forEach((listener) => listener(next));
}

function scheduleReconnect() {
  window.clearTimeout(retryTimer);
  if (listeners.size === 0) return;
  retryTimer = window.setTimeout(connect, retryMs);
  retryMs = Math.min(retryMs * 2, MAX_RETRY_MS);
}

function connect() {
  if (socket || listeners.size === 0) return;
  const token = window.localStorage.getItem(BROWSER_STORAGE_KEYS.accessToken);
  if (!token) return;
  let opened: WebSocket;
  try {
    opened = new WebSocket(`${environment.websocketBaseUrl}?token=${encodeURIComponent(token)}`);
  } catch {
    scheduleReconnect();
    return;
  }
  socket = opened;
  opened.onopen = () => {
    retryMs = 1_000;
    setLive(true);
    window.clearInterval(pingTimer);
    pingTimer = window.setInterval(() => { if (opened.readyState === WebSocket.OPEN) opened.send(JSON.stringify({ type: 'ping' })); }, PING_EVERY_MS);
  };
  opened.onmessage = (message) => {
    try {
      const frame = JSON.parse(String(message.data)) as { type?: string };
      if (frame.type === 'chat.updated') listeners.forEach((listener) => listener(frame as ChatUpdatedEvent));
    } catch {
      // Not JSON; nothing we act on.
    }
  };
  opened.onclose = (event) => {
    window.clearInterval(pingTimer);
    if (socket === opened) socket = null;
    setLive(false);
    // A rejected token will not start working by retrying; the next screen that subscribes tries again.
    if (event.code !== UNAUTHORISED_CLOSE) scheduleReconnect();
  };
  opened.onerror = () => opened.close();
}

function disconnectIfUnused() {
  if (listeners.size > 0) return;
  window.clearTimeout(retryTimer);
  window.clearInterval(pingTimer);
  const closing = socket;
  socket = null;
  closing?.close();
  setLive(false);
}

/** Subscribes to live chat changes over one shared WebSocket, which reconnects on its own while anyone is listening. */
export function subscribeToChatUpdates(listener: Listener, onStatus?: StatusListener): () => void {
  listeners.add(listener);
  if (onStatus) { statusListeners.add(onStatus); onStatus(live); }
  retryMs = 1_000;
  connect();
  return () => {
    listeners.delete(listener);
    if (onStatus) statusListeners.delete(onStatus);
    disconnectIfUnused();
  };
}

/**
 * Calls `onUpdate` whenever a conversation changes, and reports whether the live connection is up so the screen can
 * fall back to polling when it is not (for example when the API runs on a host without WebSocket support).
 */
export function useChatUpdates(onUpdate: Listener): boolean {
  const [connected, setConnected] = useState(live);
  const handler = useRef(onUpdate);
  useEffect(() => { handler.current = onUpdate; });
  useEffect(() => subscribeToChatUpdates((event) => handler.current(event), setConnected), []);
  return connected;
}

import type { DriveDealClient, AiStreamEvent } from '@/services/generated/client';
import { useDemoStore } from '@/services/platform/demoStore';

const wait = (milliseconds: number) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));
const latency = () => wait(180 + Math.round(Math.random() * 260));

async function* streamReply(message: string, threadId: string = crypto.randomUUID(), requestIds: string[] = []): AsyncIterable<AiStreamEvent> {
  yield { type: 'status', phase: 'classifying', label: 'Understanding your question' };
  await wait(280);
  yield { type: 'status', phase: 'searching', label: 'Checking DriveDeal knowledge' };
  await wait(480);
  const lower = message.toLowerCase();
  if (lower.includes('latest') || lower.includes('market') || lower.includes('reliable')) {
    yield { type: 'status', phase: 'crawling', label: 'Looking this up online' };
    await wait(850);
  }
  yield { type: 'status', phase: 'composing', label: 'Preparing a useful answer' };
  const answer = lower.includes('compare')
    ? '## Quick read\nNavee Motors currently gives you the strongest out-the-door value.\n## What stands out\n- Lowest complete price among the selected requests\n- Strong dealer rating and a fast response\n- Delivery timing is reported, but equipment should still be confirmed\n## My recommendation\nOpen the top two offers side by side before deciding. I would verify the exact trim, mandatory accessories, and delivery date first.'
    : lower.includes('request') || lower.includes('car')
      ? '## Your request is taking shape\nI can turn your needs into a clear dealer brief without sharing your contact details.\n- Vehicle and model-year range\n- Search area and distance\n- Must-have equipment and timing\nWhen the details are complete, I’ll show an editable preview. Nothing is published until you confirm.'
      : '## I can help you decide faster\n- Shortlist the right type of vehicle\n- Explain ownership and feature trade-offs\n- Compare the best offer from each request\n- Prepare an editable dealer brief\nYou stay in control: I never post a request or accept an offer without your approval.';
  for (const piece of answer.split(/(\s+)/)) {
    await wait(12);
    yield { type: 'token', text: piece };
  }
  if (lower.includes('compare')) {
    yield { type: 'card', kind: 'compare', payload: { leader: 'Navee Motors', total: '70229.00', difference: '488.50', requestIds } };
  }
  if (lower.includes('request') || lower.includes('car')) {
    yield { type: 'card', kind: 'requestPreview', payload: { brand: 'Ford', model: 'Bronco', years: '2024–2026', budget: '$65,000–$72,000 OTD', area: 'Austin, TX · 75 miles', timeline: 'Within 2 weeks', mustHaves: '4WD, hard top, adaptive cruise' } };
  }
  yield { type: 'done', threadId, messagesUsed: 1, expandedUi: false };
}

export const mockClient: DriveDealClient = {
  auth: { me: async () => { await latency(); const session = useDemoStore.getState().session; if (!session) throw new Error('UNAUTHENTICATED'); return session; } },
  requests: {
    list: async () => { await latency(); return useDemoStore.getState().requests; },
    get: async (id) => { await latency(); const item = useDemoStore.getState().requests.find((request) => request.id === id); if (!item) throw new Error('REQUEST_NOT_FOUND'); return item; },
    create: async (input) => { await latency(); useDemoStore.getState().addRequest(input); return input; },
  },
  quotes: {
    list: async (requestId) => { await latency(); const items = useDemoStore.getState().quotes; return requestId ? items.filter((quote) => quote.requestId === requestId) : items; },
    get: async (id) => { await latency(); const item = useDemoStore.getState().quotes.find((quote) => quote.id === id); if (!item) throw new Error('QUOTE_NOT_FOUND'); return item; },
  },
  chats: { list: async (quoteId) => { await latency(); return useDemoStore.getState().messages.filter((message) => message.quoteId === quoteId); } },
  inventory: { list: async () => { await latency(); return useDemoStore.getState().inventory; } },
  support: { listTickets: async () => { await latency(); return useDemoStore.getState().tickets; } },
  verifications: { list: async () => { await latency(); return useDemoStore.getState().verifications; } },
  ai: { chat: ({ message, threadId, requestIds }) => streamReply(message, threadId, requestIds) },
};

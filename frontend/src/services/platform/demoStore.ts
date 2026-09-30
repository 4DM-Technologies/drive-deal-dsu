import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { initialInventory, initialMessages, initialQuotes, initialRequests, initialTickets, initialVerifications, personas } from '@/services/mocks/fixtures';
import type { AiMessage, AiThread, BuyerRequest, ChatMessage, InventoryCar, Quote, Role, Session, SupportMember, Ticket, Verification, VerificationStatus } from '@/types/domain';

interface DemoState {
  session: Session | null;
  requests: BuyerRequest[];
  quotes: Quote[];
  messages: ChatMessage[];
  inventory: InventoryCar[];
  tickets: Ticket[];
  verifications: Verification[];
  preferences: string[];
  aiThreads: AiThread[];
  supportMembers: SupportMember[];
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  setSession: (session: Session | null) => void;
  loginAs: (role: Role) => void;
  logout: () => void;
  addRequest: (request: BuyerRequest) => void;
  addQuote: (quote: Quote) => void;
  reviseQuote: (quoteId: string, vehiclePrice: string, finalPrice: string) => void;
  acceptQuote: (quoteId: string) => void;
  declineQuote: (quoteId: string) => void;
  requestChat: (quoteId: string, message: string) => void;
  acceptChatRequest: (quoteId: string) => void;
  declineChatRequest: (quoteId: string, reason: string) => void;
  sendMessage: (quoteId: string, body: string) => void;
  updateDealStatus: (quoteId: string, status: NonNullable<Quote['dealStatus']>) => void;
  decideVerification: (id: string, status: VerificationStatus, reason: string) => void;
  updateTicket: (id: string, status: Ticket['status'], note?: string, rca?: string) => void;
  updatePreferences: (preferences: string[]) => void;
  saveAiTurn: (threadId: string, user: string, assistant: string, type?: AiThread['type']) => void;
  setSupportMemberRole: (email: string, role: 'support' | 'support-admin') => void;
  resetDemo: () => void;
}

const defaults = () => ({
  requests: initialRequests,
  quotes: initialQuotes,
  messages: initialMessages,
  inventory: initialInventory,
  tickets: initialTickets,
  verifications: initialVerifications,
  preferences: ['SUVs', 'Automatic', 'Adaptive cruise', 'Under $75k', 'Low mileage'],
  aiThreads: [
    { id: 'thread-1', type: 'compare', title: 'Bronco offer comparison', updatedAt: new Date(Date.now() - 18 * 60_000).toISOString(), messages: [{ id: 't1u', role: 'user', body: 'Which Bronco quote gives me the best complete value?' }, { id: 't1a', role: 'assistant', body: '## Best current value\nNavee Motors is leading at $70,229 out the door.\n## Check before accepting\n- Confirm the exact trim and hard-top equipment\n- Verify the delivery date\n- Ask whether any accessories are mandatory' }] },
    { id: 'thread-2', type: 'sera', title: 'Family SUV shortlist', updatedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(), messages: [{ id: 't2u', role: 'user', body: 'Help me shortlist a comfortable family SUV.' }, { id: 't2a', role: 'assistant', body: 'I would start with space, safety, and running cost. Tell me how many seats you use regularly and whether hybrid fuel economy matters.' }] },
  ] satisfies AiThread[],
  supportMembers: [
    { id: 'support-maya', name: 'Maya Lewis', email: 'maya@drivedeal.demo', role: 'support', status: 'active', phone: '+1 214 555 0144', address: 'Dallas, TX', lastLoginAt: new Date(Date.now() - 42 * 60_000).toISOString(), createdAt: '2026-06-12T09:00:00Z' },
    { id: 'support-admin-priya', name: 'Priya Shah', email: 'priya@drivedeal.demo', role: 'support-admin', status: 'active', phone: '+1 214 555 0155', address: 'Dallas, TX', lastLoginAt: new Date(Date.now() - 8 * 60_000).toISOString(), createdAt: '2026-05-04T09:00:00Z' },
    { id: 'support-daniel', name: 'Daniel Kim', email: 'daniel@drivedeal.demo', role: 'support', status: 'suspended', phone: '+1 469 555 0198', address: 'Plano, TX', lastLoginAt: '2026-09-18T15:20:00Z', createdAt: '2026-07-22T09:00:00Z' },
  ] satisfies SupportMember[],
});

export const useDemoStore = create<DemoState>()(
  persist(
    (set) => ({
      session: null,
      ...defaults(),
      sidebarOpen: false,
      setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
      setSession: (session) => set({ session }),
      loginAs: (role) => set({ session: personas[role] ?? personas.buyer! }),
      logout: () => set({ session: null }),
      addRequest: (request) => set((state) => ({ requests: [request, ...state.requests] })),
      addQuote: (quote) => set((state) => ({ quotes: [quote, ...state.quotes], requests: state.requests.map((item) => item.id === quote.requestId ? { ...item, quoteCount: item.quoteCount + 1 } : item) })),
      reviseQuote: (quoteId, vehiclePrice, finalPrice) => set((state) => ({ quotes: state.quotes.map((item) => item.id === quoteId ? { ...item, vehiclePrice, finalPrice, status: 'pending', revisions: [...(item.revisions ?? []), { amount: finalPrice, at: new Date().toISOString() }] } : item) })),
      acceptQuote: (quoteId) => set((state) => {
        const quote = state.quotes.find((item) => item.id === quoteId);
        if (!quote) return state;
        return {
          quotes: state.quotes.map((item) => item.requestId === quote.requestId
            ? item.id === quoteId
              ? { ...item, status: 'accepted', dealStatus: 'paperwork_going_on', contactAvailable: true }
              : { ...item, status: item.status === 'pending' ? 'declined' : item.status }
            : item),
          requests: state.requests.map((item) => item.id === quote.requestId ? { ...item, status: 'fulfilled' } : item),
        };
      }),
      declineQuote: (quoteId) => set((state) => ({ quotes: state.quotes.map((item) => item.id === quoteId ? { ...item, status: 'declined' } : item) })),
      requestChat: (quoteId, message) => set((state) => ({ quotes: state.quotes.map((item) => item.id === quoteId ? { ...item, chatRequestStatus: 'pending', chatRequestMessage: message } : item) })),
      acceptChatRequest: (quoteId) => set((state) => ({
        quotes: state.quotes.map((item) => item.id === quoteId ? { ...item, chatRequestStatus: 'accepted', contactAvailable: true, status: item.status === 'pending' ? 'negotiating' : item.status } : item),
        messages: [...state.messages, { id: crypto.randomUUID(), quoteId, senderId: 'buyer-rahul', senderName: 'Rahul', body: state.quotes.find((item) => item.id === quoteId)?.chatRequestMessage ?? 'I would like to discuss this offer before deciding.', createdAt: new Date().toISOString(), read: false }],
      })),
      declineChatRequest: (quoteId, reason) => set((state) => ({ quotes: state.quotes.map((item) => item.id === quoteId ? { ...item, chatRequestStatus: 'declined', chatRequestMessage: reason } : item) })),
      sendMessage: (quoteId, body) => set((state) => ({ messages: [...state.messages, { id: crypto.randomUUID(), quoteId, senderId: state.session?.id ?? 'demo', senderName: state.session?.fullName ?? 'Demo user', body, createdAt: new Date().toISOString(), read: false }] })),
      updateDealStatus: (quoteId, dealStatus) => set((state) => ({ quotes: state.quotes.map((item) => item.id === quoteId ? { ...item, dealStatus } : item) })),
      decideVerification: (id, status, reason) => set((state) => ({ verifications: state.verifications.map((item) => item.id === id ? { ...item, status, decisionReason: reason } : item) })),
      updateTicket: (id, status, note, rca) => set((state) => ({ tickets: state.tickets.map((item) => item.id === id ? { ...item, status, ...(rca ? { rca } : {}), ...(note ? { notes: [...(item.notes ?? []), { at: new Date().toISOString(), author: state.session?.fullName ?? 'Support', body: note }] } : {}) } : item) })),
      updatePreferences: (preferences) => set({ preferences }),
      saveAiTurn: (threadId, user, assistant, type = 'sera') => set((state) => {
        const turn: AiMessage[] = [{ id: crypto.randomUUID(), role: 'user', body: user }, { id: crypto.randomUUID(), role: 'assistant', body: assistant }];
        const existing = state.aiThreads.find((thread) => thread.id === threadId);
        const next: AiThread = existing
          ? { ...existing, updatedAt: new Date().toISOString(), messages: [...existing.messages, ...turn] }
          : { id: threadId, type, title: user.slice(0, 58), updatedAt: new Date().toISOString(), messages: turn };
        return { aiThreads: [next, ...state.aiThreads.filter((thread) => thread.id !== threadId)] };
      }),
      setSupportMemberRole: (email, role) => set((state) => ({
        supportMembers: state.supportMembers.map((member) => member.email === email ? { ...member, role } : member),
        session: state.session?.email === email ? null : state.session,
      })),
      resetDemo: () => set({ ...defaults(), session: null }),
    }),
    { name: 'deal-and-drive-demo-v3', partialize: (state) => ({ session: state.session, requests: state.requests, quotes: state.quotes, messages: state.messages, inventory: state.inventory, tickets: state.tickets, verifications: state.verifications, preferences: state.preferences, aiThreads: state.aiThreads, supportMembers: state.supportMembers }) },
  ),
);

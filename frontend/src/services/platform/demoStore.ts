import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { initialInventory, initialMessages, initialQuotes, initialRequests, initialTickets, initialVerifications, personas } from '@/services/mocks/fixtures';
import type { BuyerRequest, ChatMessage, InventoryCar, Quote, Role, Session, Ticket, Verification, VerificationStatus } from '@/types/domain';

interface DemoState {
  session: Session | null;
  requests: BuyerRequest[];
  quotes: Quote[];
  messages: ChatMessage[];
  inventory: InventoryCar[];
  tickets: Ticket[];
  verifications: Verification[];
  preferences: string[];
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  loginAs: (role: Role) => void;
  logout: () => void;
  addRequest: (request: BuyerRequest) => void;
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
});

export const useDemoStore = create<DemoState>()(
  persist(
    (set) => ({
      session: null,
      ...defaults(),
      sidebarOpen: false,
      setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
      loginAs: (role) => set({ session: personas[role] ?? personas.buyer! }),
      logout: () => set({ session: null }),
      addRequest: (request) => set((state) => ({ requests: [request, ...state.requests] })),
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
      resetDemo: () => set({ ...defaults(), session: null }),
    }),
    { name: 'drivedeal-demo-v2', partialize: (state) => ({ session: state.session, requests: state.requests, quotes: state.quotes, messages: state.messages, inventory: state.inventory, tickets: state.tickets, verifications: state.verifications, preferences: state.preferences }) },
  ),
);

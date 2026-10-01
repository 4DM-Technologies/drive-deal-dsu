import type { AiThread, BuyerRequest, ChatMessage, DealDocument, InventoryCar, Quote, QuoteCreateInput, Session, SupportMember, SupportTicketCreate, Ticket, Verification } from '@/types/domain';

export type AiStreamEvent =
  | { type: 'status'; phase: 'classifying' | 'searching' | 'crawling' | 'composing'; label: string }
  | { type: 'token'; text: string }
  | { type: 'card'; kind: 'car' | 'compare' | 'requestPreview'; payload: unknown }
  | { type: 'sources'; items: Array<{ url: string; title: string }> }
  | { type: 'done'; threadId: string; messagesUsed: number; expandedUi: boolean };

export interface DriveDealClient {
  auth: { login(email: string, password: string): Promise<Session>; me(): Promise<Session> };
  requests: { list(): Promise<BuyerRequest[]>; get(id: string): Promise<BuyerRequest>; create(input: BuyerRequest): Promise<BuyerRequest> };
  quotes: { list(requestId?: string): Promise<Quote[]>; get(id: string): Promise<Quote>; create(input: QuoteCreateInput): Promise<Quote> };
  documents: { list(quoteId: string): Promise<DealDocument[]>; upload(quoteId: string, file: File, type: 'vehicle_image' | 'quote_document'): Promise<DealDocument> };
  chats: { list(quoteId: string): Promise<ChatMessage[]> };
  inventory: { list(): Promise<InventoryCar[]> };
  support: {
    listTickets(): Promise<Ticket[]>;
    createTicket(input: SupportTicketCreate): Promise<Ticket>;
    members(): Promise<SupportMember[]>;
    member(id: string): Promise<SupportMember>;
    updateMemberRole(id: string, role: 'support' | 'support-admin'): Promise<SupportMember>;
  };
  verifications: { list(): Promise<Verification[]> };
  ai: {
    chat(input: { message: string; threadId?: string; agent?: 'sera-agent' | 'compare-agent'; requestIds?: string[] }): AsyncIterable<AiStreamEvent>;
    threads(): Promise<AiThread[]>;
    thread(id: string): Promise<AiThread>;
  };
}

import type { GuidedActionInput, GuidedAnswers, GuidedStepResult, PaymentInput, PaymentReceipt, ActiveTheme, AdministrationAuditEvent, AdminCatalog, AdminConfigBundle, AdminConfigType, AdminPromptBundle, AdminRevision, AiThread, AiTrace, BrandRef, BuyerPreferences, BuyerRequest, CarCreateInput, ChatMessage, DealDocument, DealerSignupInput, InventoryCar, ProfileUpdateInput, PromptDefinition, Quote, QuoteCreateInput, RequestCreateInput, Session, StateRef, SignupInput, SupportMember, SupportSignupInput, SupportTicketCreate, Ticket, Verification, WorkflowDefinition, WorkflowPreview, WorkflowPreviewStreamEvent } from '@/types/domain';

export type AiStreamEvent =
  | { type: 'status'; phase: 'classifying' | 'searching' | 'crawling' | 'composing'; label: string }
  | { type: 'token'; text: string }
  | { type: 'card'; kind: 'car' | 'compare' | 'requestPreview' | 'question'; payload: unknown }
  | { type: 'sources'; items: Array<{ url: string; title: string }> }
  | { type: 'media'; items: Array<{ image_url: string; source_url: string; source_name?: string; alt?: string }> }
  | { type: 'done'; threadId: string; messagesUsed: number; expandedUi: boolean }
  | { type: 'error'; message: string };

export interface DriveDealClient {
  auth: {
    login(email: string, password: string): Promise<Session>;
    me(): Promise<Session>;
    signupBuyer(input: SignupInput): Promise<Session>;
    signupDealer(input: DealerSignupInput): Promise<{ pending: true }>;
    signupSupport(input: SupportSignupInput): Promise<{ pending: true }>;
    refresh(): Promise<Session>;
    logout(): Promise<void>;
  };
  profiles: {
    update(input: ProfileUpdateInput): Promise<Session>;
    getPreferences(): Promise<BuyerPreferences>;
    savePreferences(input: BuyerPreferences): Promise<BuyerPreferences>;
  };
  requests: {
    list(): Promise<BuyerRequest[]>;
    get(id: string): Promise<BuyerRequest>;
    create(input: RequestCreateInput): Promise<BuyerRequest>;
    publish(id: string): Promise<BuyerRequest>;
    close(id: string): Promise<BuyerRequest>;
  };
  feed: {
    list(): Promise<BuyerRequest[]>;
    get(id: string): Promise<BuyerRequest>;
  };
  quotes: {
    list(requestId?: string): Promise<Quote[]>;
    get(id: string): Promise<Quote>;
    create(input: QuoteCreateInput): Promise<Quote>;
    revise(id: string, input: Partial<QuoteCreateInput>): Promise<Quote>;
    accept(id: string): Promise<Quote>;
    decline(id: string): Promise<Quote>;
    withdraw(id: string): Promise<Quote>;
    dealerContact(id: string): Promise<{ name: string; email: string; phone: string | null }>;
  };
  payments: { create(input: PaymentInput): Promise<PaymentReceipt> };
  documents: { list(quoteId: string): Promise<DealDocument[]>; upload(quoteId: string, file: File, type: 'vehicle_image' | 'quote_document'): Promise<DealDocument>; replace(quoteId: string, file: File, previous: DealDocument | null): Promise<DealDocument> };
  chats: {
    list(quoteId: string): Promise<ChatMessage[]>;
    send(quoteId: string, body: string): Promise<ChatMessage>;
    edit(quoteId: string, messageId: string, body: string): Promise<ChatMessage>;
    unsend(quoteId: string, messageId: string): Promise<ChatMessage>;
    requestAccess(quoteId: string, message: string): Promise<Quote>;
    listRequests(): Promise<Quote[]>;
    acceptRequest(quoteId: string): Promise<Quote>;
    declineRequest(quoteId: string, reason?: string): Promise<Quote>;
    markRead(quoteId: string): Promise<void>;
  };
  deals: {
    list(): Promise<Quote[]>;
    get(quoteId: string): Promise<Quote>;
    updateStatus(quoteId: string, status: NonNullable<Quote['dealStatus']>): Promise<Quote>;
  };
  cars: {
    list(): Promise<InventoryCar[]>;
    create(input: CarCreateInput): Promise<InventoryCar>;
    update(id: string, input: CarCreateInput): Promise<InventoryCar>;
    updateStatus(id: string, status: InventoryCar['status']): Promise<InventoryCar>;
  };
  inventory: { list(): Promise<InventoryCar[]> };
  support: {
    listTickets(): Promise<Ticket[]>;
    createTicket(input: SupportTicketCreate): Promise<Ticket>;
    updateTicket(id: string, status?: Ticket['status'], note?: string, rca?: string): Promise<Ticket>;
    queue(): Promise<Ticket[]>;
    members(): Promise<SupportMember[]>;
    member(id: string): Promise<SupportMember>;
    updateMemberRole(id: string, role: 'support' | 'support-admin'): Promise<SupportMember>;
  };
  verifications: {
    list(): Promise<Verification[]>;
    decide(id: string, decision: 'approved' | 'denied' | 'rejected', reason: string): Promise<Verification>;
  };
  reference: {
    states(): Promise<StateRef[]>;
    brands(): Promise<BrandRef[]>;
    taxRate(stateCode: string): Promise<{ stateCode: string; rate: string }>;
  };
  ai: {
    chat(input: { message: string; threadId?: string; agent?: 'sera-agent' | 'compare-agent'; requestIds?: string[]; quoteIds?: string[]; requestContext?: Record<string, string>; signal?: AbortSignal }): AsyncIterable<AiStreamEvent>;
    guidedNext(answers: GuidedAnswers, action: GuidedActionInput): Promise<GuidedStepResult>;
    vehicleImages(query: string): Promise<Array<{ image_url: string; source_url: string; source_name?: string; alt?: string }>>;
    saveGuidedCheckpoint(input: { threadId: string; messages: Array<{ id: string; role: 'user' | 'assistant'; body: string; guidedStep?: string | undefined; options?: string[] | undefined }>; guidedState: Record<string, unknown>; requestContext: Record<string, string> | null }): Promise<void>;
    threads(): Promise<AiThread[]>;
    thread(id: string): Promise<AiThread>;
    deleteThread(id: string): Promise<void>;
  };
  theme: { active(): Promise<ActiveTheme> };
  administration: {
    catalog(): Promise<AdminCatalog>;
    getConfig<T = Record<string, unknown>>(type: AdminConfigType, key: string): Promise<AdminConfigBundle<T>>;
    validate(type: AdminConfigType, key: string, payload: Record<string, unknown>): Promise<{ valid: boolean; errors: string[] }>;
    saveDraft<T = Record<string, unknown>>(type: AdminConfigType, key: string, payload: T, baseVersion: number): Promise<AdminRevision<T>>;
    publish<T = Record<string, unknown>>(type: AdminConfigType, key: string, revisionId: string): Promise<AdminRevision<T>>;
    rollback<T = Record<string, unknown>>(type: AdminConfigType, key: string, version: number): Promise<AdminRevision<T>>;
    setDefault(type: AdminConfigType, key: string, version: number): Promise<void>;
    reset<T = Record<string, unknown>>(type: AdminConfigType, key: string): Promise<AdminRevision<T>>;
    prompts(): Promise<AdminPromptBundle[]>;
    audit(): Promise<AdministrationAuditEvent[]>;
    traces(): Promise<AiTrace[]>;
    trace(id: string): Promise<AiTrace>;
    exportConfiguration(format: 'yaml' | 'json'): Promise<{ filename: string; size: number }>;
    preview(message: string, options?: { threadId?: string; revisionId?: string; workflow?: WorkflowDefinition; promptKey?: string; prompt?: PromptDefinition }): Promise<WorkflowPreview>;
    previewStream(message: string, options?: { threadId?: string; revisionId?: string; workflow?: WorkflowDefinition; promptKey?: string; prompt?: PromptDefinition }): AsyncIterable<WorkflowPreviewStreamEvent>;
  };
}

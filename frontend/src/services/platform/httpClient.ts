import type { DriveDealClient, AiStreamEvent } from '@/services/generated/client';
import type { AiThread, BuyerRequest, ChatMessage, DealDocument, InventoryCar, Quote, Session, Ticket, Verification } from '@/types/domain';

const baseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000/api/v1';

const token = () => window.localStorage.getItem('drivedeal.accessToken');

const snake = <T>(value: Record<string, unknown>): T => value as T;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token() ? { authorization: `Bearer ${token()}` } : {}),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error?.message ?? `Request failed (${response.status})`);
  }
  return response.status === 204 ? (undefined as T) : response.json();
}

const profileToSession = (row: Record<string, unknown>): Session => ({
  id: String(row.id),
  fullName: String(row.full_name),
  email: String(row.email),
  role: row.role as Session['role'],
  avatarInitials: String(row.full_name).split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase(),
});

const requestToDomain = (row: Record<string, unknown>): BuyerRequest => ({
  id: String(row.id), buyerId: String(row.buyer_id), brand: String(row.brand_name ?? 'Vehicle'), model: String(row.model),
  bodyType: row.body_type as string | null, yearMin: row.year_min as number | null, yearMax: row.year_max as number | null,
  budgetMin: row.budget_min == null ? null : String(row.budget_min), budgetMax: row.budget_max == null ? null : String(row.budget_max),
  targetOtdPrice: row.target_otd_price == null ? null : String(row.target_otd_price), area: String(row.buyer_area),
  radiusMiles: Number(row.search_radius_miles), timeline: row.timeline as BuyerRequest['timeline'], status: row.status as BuyerRequest['status'],
  quoteCount: Number(row.quote_count ?? 0), createdAt: String(row.created_at), expiresAt: String(row.request_expire),
  image: '/src/assets/vehicles/studio-suv.png', mustHaves: (row.must_haves as string[]) ?? [],
});

const quoteToDomain = (row: Record<string, unknown>): Quote => ({
  id: String(row.id), requestId: String(row.buyer_request_id), dealerId: String(row.dealer_id), dealerName: String(row.dealer_name ?? 'Verified dealer'),
  dealerCity: String(row.dealer_city ?? 'Local dealer'), rating: Number(row.rating ?? 4.8), responseMinutes: Number(row.response_minutes ?? 20),
  vehiclePrice: String(row.vehicle_price), docFee: String(row.doc_fee), salesTax: String(row.sales_tax), titleReg: String(row.title_reg),
  tradeInCredit: String(row.trade_in_credit), finalPrice: String(row.final_price), status: row.status as Quote['status'], dealStatus: row.deal_status as Quote['dealStatus'],
  message: String(row.message ?? ''), createdAt: String(row.created_at), expiresAt: String(row.expires_at),
  contactAvailable: row.status === 'accepted' || row.chat_request_status === 'accepted', chatRequestStatus: row.chat_request_status as Quote['chatRequestStatus'],
});

async function* streamAi(input: { message: string; threadId?: string; agent?: 'sera-agent' | 'compare-agent'; requestIds?: string[] }): AsyncIterable<AiStreamEvent> {
  const response = await fetch(`${baseUrl}/ai/chat`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...(token() ? { authorization: `Bearer ${token()}` } : {}) },
    body: JSON.stringify({ message: input.message, thread_id: input.threadId, agent: input.agent ?? 'sera-agent', request_ids: input.requestIds ?? [] }),
  });
  if (!response.ok || !response.body) throw new Error('Serra is temporarily unavailable.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';
    for (const frame of frames) {
      const data = frame.split('\n').find((line) => line.startsWith('data: '));
      if (data) yield JSON.parse(data.slice(6)) as AiStreamEvent;
    }
  }
}

export const httpClient: DriveDealClient = {
  auth: { me: async () => profileToSession(await request('/auth/me')) },
  requests: {
    list: async () => (await request<Record<string, unknown>[]>('/requests')).map(requestToDomain),
    get: async (id) => requestToDomain(await request(`/requests/${id}`)),
    create: async (input) => requestToDomain(await request('/requests', { method: 'POST', body: JSON.stringify(snake(input as unknown as Record<string, unknown>)) })),
  },
  quotes: {
    list: async (requestId) => (await request<Record<string, unknown>[]>(`/quotes${requestId ? `?request_id=${requestId}` : ''}`)).map(quoteToDomain),
    get: async (id) => quoteToDomain(await request(`/quotes/${id}`)),
    create: async (input) => quoteToDomain(await request('/quotes', { method: 'POST', body: JSON.stringify({ buyer_request_id: input.buyerRequestId, vehicle_price: input.vehiclePrice, doc_fee: input.docFee, sales_tax: input.salesTax, title_reg: input.titleReg, trade_in_credit: input.tradeInCredit, message: input.message, expires_at: input.expiresAt }) })),
  },
  documents: {
    list: async (quoteId) => (await request<Record<string, unknown>[]>(`/documents/${quoteId}`)).map((row): DealDocument => ({ id: String(row.id), quoteId: String(row.quote_id), type: String(row.document_type), name: String(row.document_path).split('/').at(-1) ?? 'Attachment', status: String(row.status), downloadUrl: String(row.download_url) })),
    upload: async (quoteId, file, type) => {
      const presigned = await request<{ url: string; key: string; headers: Record<string, string> }>('/documents/presign', { method: 'POST', body: JSON.stringify({ filename: file.name, content_type: file.type || 'application/octet-stream', quote_id: quoteId }) });
      const upload = await fetch(presigned.url, { method: 'PUT', headers: presigned.headers, body: file });
      if (!upload.ok) throw new Error(`Upload failed (${upload.status})`);
      const documentId = crypto.randomUUID();
      const row = await request<Record<string, unknown>>(`/documents/${documentId}/confirm`, { method: 'POST', body: JSON.stringify({ quote_id: quoteId, document_type: type, object_key: presigned.key }) });
      const confirmed = (await request<Record<string, unknown>[]>(`/documents/${quoteId}`)).find((item) => String(item.id) === String(row.id));
      return { id: String(row.id), quoteId: String(row.quote_id), type: String(row.document_type), name: file.name, status: String(row.status), downloadUrl: String(confirmed?.download_url ?? '') };
    },
  },
  chats: { list: async (quoteId) => (await request<Record<string, unknown>[]>(`/chats/${quoteId}`)).map((row): ChatMessage => ({ id: String(row.id), quoteId: String(row.quote_id), senderId: String(row.sender_id), senderName: String(row.sender_name ?? 'Member'), body: String(row.message), createdAt: String(row.created_at), read: Boolean(row.read_at) })) },
  inventory: { list: async () => (await request<Record<string, unknown>[]>('/cars')).map((row): InventoryCar => ({ id: String(row.id), title: String(row.title), brand: String(row.brand_name ?? 'Vehicle'), model: String(row.model), year: Number(row.model_year), bodyType: String(row.body_type ?? ''), fuel: String(row.fuel ?? ''), transmission: String(row.transmission ?? ''), mileage: Number(row.mileage), price: String(row.price), status: row.status as InventoryCar['status'], image: '/src/assets/vehicles/studio-sedan.png' })) },
  support: { listTickets: async () => (await request<Record<string, unknown>[]>('/support/tickets')).map((row): Ticket => ({ id: String(row.id), publicId: String(row.ticket_id), callerName: String(row.caller_name ?? 'Member'), category: row.category as Ticket['category'], summary: String(row.issue_summary), status: row.status as Ticket['status'], priority: row.priority as Ticket['priority'], createdAt: String(row.created_at) })) },
  verifications: { list: async () => (await request<Record<string, unknown>[]>('/verifications')).map((row): Verification => ({ id: String(row.id), ticketId: String(row.ticket_id), category: row.category as Verification['category'], profileName: String(row.profile_name ?? 'Applicant'), businessName: row.business_name as string | null, state: String(row.state ?? ''), status: row.status as Verification['status'], submittedAt: String(row.created_at) })) },
  ai: {
    chat: streamAi,
    threads: async () => (await request<Array<Record<string, unknown>>>('/ai/threads')).map((row): AiThread => ({ id: String(row.id), type: row.type as AiThread['type'], title: String(row.title), updatedAt: String(row.updated_at), messages: [] })),
    thread: async (id) => {
      const row = await request<{ id: string; checkpoints: Array<{ user?: string; assistant?: string }> }>(`/ai/threads/${id}`);
      return { id: row.id, type: 'sera', title: 'Conversation', updatedAt: new Date().toISOString(), messages: row.checkpoints.flatMap((checkpoint, index) => [{ id: `${id}-${index}-user`, role: 'user' as const, body: checkpoint.user ?? '' }, { id: `${id}-${index}-assistant`, role: 'assistant' as const, body: checkpoint.assistant ?? '' }]).filter((message) => message.body) };
    },
  },
};

import type { DriveDealClient, AiStreamEvent } from '@/services/generated/client';
import type { ActiveTheme, AdministrationAuditEvent, AdminCatalog, AdminConfigBundle, AdminConfigType, AdminPromptBundle, AdminRevision, AiThread, AiTrace, BrandRef, BuyerRequest, CarCreateInput, ChatMessage, DealDocument, InventoryCar, PromptDefinition, Quote, Session, StateRef, SupportMember, Ticket, Verification, WorkflowDefinition, WorkflowPreview, WorkflowPreviewStreamEvent, PaymentReceipt } from '@/types/domain';
import driveDealHero from '@/assets/vehicles/drivedeal-hero.png';
import { BROWSER_STORAGE_KEYS, WORKSPACE_VIEW_QUERY_PARAMETER } from '@/config/browser';
import { environment } from '@/config/environment';
import { createId } from '@/helpers/ids';
import { parseSubscription } from '@/helpers/subscription';
import { ApiError } from '@/services/platform/apiError';

const baseUrl = environment.apiBaseUrl;

const token = () => window.localStorage.getItem(BROWSER_STORAGE_KEYS.accessToken);
const clearTokens = () => {
  window.localStorage.removeItem(BROWSER_STORAGE_KEYS.accessToken);
  window.localStorage.removeItem(BROWSER_STORAGE_KEYS.refreshToken);
};
const workspaceView = () => {
  const value = new URLSearchParams(window.location.search).get(WORKSPACE_VIEW_QUERY_PARAMETER);
  return value === 'buyer' || value === 'dealer' ? value : null;
};
const activeRole = (): Session['role'] | null => {
  try {
    return JSON.parse(window.localStorage.getItem(BROWSER_STORAGE_KEYS.session) ?? '{}')?.state?.session?.role ?? null;
  } catch {
    return null;
  }
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? 'GET').toUpperCase();
  if (workspaceView() && !['GET', 'HEAD'].includes(method)) {
    throw new Error('This support workspace view is read-only. Return to Support operations to make account or marketplace changes.');
  }
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token() ? { authorization: `Bearer ${token()}` } : {}),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    if (response.status === 401) clearTokens();
    const body = await response.json().catch(() => null);
    throw ApiError.fromResponse(response.status, body);
  }
  return response.status === 204 ? (undefined as T) : response.json();
}

async function download(path: string, fallbackFilename: string): Promise<{ filename: string; size: number }> {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: token() ? { authorization: `Bearer ${token()}` } : {},
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error?.message ?? `Download failed (${response.status})`);
  }
  const disposition = response.headers.get('content-disposition') ?? '';
  const encodedFilename = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const filename = encodedFilename
    ? decodeURIComponent(encodedFilename)
    : disposition.match(/filename="?([^";]+)"?/i)?.[1] ?? fallbackFilename;
  const blob = await response.blob();
  if (!blob.size) throw new Error('The server returned an empty configuration file. Please try the export again.');
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return { filename, size: blob.size };
}

const profileToSession = (row: Record<string, unknown>): Session => ({
  id: String(row.id),
  fullName: String(row.full_name),
  email: String(row.email),
  role: row.role as Session['role'],
  avatarInitials: String(row.full_name).split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase(),
  phone: row.phone == null ? null : String(row.phone),
  address: row.address == null ? null : String(row.address),
  stateId: row.state_id == null ? null : String(row.state_id),
  dealershipName: row.dealership_name == null ? null : String(row.dealership_name),
  branchName: row.branch_name == null ? null : String(row.branch_name),
  dealerLicense: row.dealer_license == null ? null : String(row.dealer_license),
  website: row.website == null ? null : String(row.website),
  supportedBrands: (row.supported_brands as string[]) ?? [],
  subscription: parseSubscription(row.subscription),
});

const requestToDomain = (row: Record<string, unknown>): BuyerRequest => ({
  id: String(row.id), buyerId: String(row.buyer_id), brand: String(row.brand_name ?? 'Vehicle'), model: String(row.model),
  bodyType: row.body_type as string | null, yearMin: row.year_min as number | null, yearMax: row.year_max as number | null,
  budgetMin: row.budget_min == null ? null : String(row.budget_min), budgetMax: row.budget_max == null ? null : String(row.budget_max),
  targetOtdPrice: row.target_otd_price == null ? null : String(row.target_otd_price), area: String(row.buyer_area),
  radiusMiles: Number(row.search_radius_miles), timeline: row.timeline as BuyerRequest['timeline'], status: row.status as BuyerRequest['status'],
  quoteCount: Number(row.quote_count ?? 0), viewCount: Number(row.view_count ?? 0), createdAt: String(row.created_at), expiresAt: String(row.request_expire),
  image: '', mustHaves: (row.must_haves as string[]) ?? [],
  alreadyQuoted: Boolean(row.already_quoted),
});

const quoteToDomain = (row: Record<string, unknown>): Quote => ({
  id: String(row.id), requestId: String(row.buyer_request_id),
  brand: String(row.brand_name ?? ''), model: String(row.model ?? ''),
  yearMin: row.year_min as number | null, yearMax: row.year_max as number | null, bodyType: row.body_type as string | null,
  buyerArea: String(row.buyer_area ?? ''),
  dealerId: String(row.dealer_id), dealerName: String(row.dealer_name ?? 'Verified dealer'),
  dealerCity: String(row.dealer_city ?? 'Local dealer'), rating: Number(row.rating ?? 4.8), responseMinutes: Number(row.response_minutes ?? 20),
  vehiclePrice: String(row.vehicle_price), docFee: String(row.doc_fee), salesTax: String(row.sales_tax), titleReg: String(row.title_reg),
  tradeInCredit: String(row.trade_in_credit), finalPrice: String(row.final_price), status: row.status as Quote['status'], dealStatus: row.deal_status as Quote['dealStatus'],
  message: String(row.message ?? ''), createdAt: String(row.created_at), expiresAt: String(row.expires_at),
  contactAvailable: row.status === 'accepted' || row.chat_request_status === 'accepted', chatRequestStatus: row.chat_request_status as Quote['chatRequestStatus'],
});

const memberToDomain = (row: Record<string, unknown>): SupportMember => ({
  id: String(row.id),
  name: String(row.full_name),
  email: String(row.email),
  role: row.role as SupportMember['role'],
  status: row.is_active === false ? 'suspended' : 'active',
  phone: row.phone == null ? null : String(row.phone),
  address: row.address == null ? null : String(row.address),
  lastLoginAt: row.last_login_at == null ? null : String(row.last_login_at),
  createdAt: row.created_at == null ? null : String(row.created_at),
});

const ticketToDomain = (row: Record<string, unknown>): Ticket => ({
  id: String(row.id),
  publicId: String(row.ticket_id),
  callerName: String(row.caller_name ?? 'Member'),
  ...(row.caller_email == null ? {} : { callerEmail: String(row.caller_email) }),
  ...(row.caller_role == null ? {} : { callerRole: row.caller_role as NonNullable<Ticket['callerRole']> }),
  category: row.category as Ticket['category'],
  summary: String(row.issue_summary),
  ...(row.issue_type == null ? {} : { issueType: String(row.issue_type) }),
  ...(row.page_context == null ? {} : { pageContext: String(row.page_context) }),
  ...(row.issue_description == null ? {} : { description: String(row.issue_description) }),
  status: row.status as Ticket['status'],
  priority: row.priority as Ticket['priority'],
  createdAt: String(row.created_at),
  ...(row.notes ? { notes: (row.notes as Array<{ at?: string; ts?: string; actor_id?: string; agent?: string; note?: string; text?: string }>).map((entry) => ({
    at: entry.at ?? entry.ts ?? String(row.updated_at ?? row.created_at),
    author: entry.actor_id ?? entry.agent ?? 'Support team',
    body: entry.note ?? entry.text ?? 'Case updated.',
  })) } : {}),
  ...(row.rca == null ? {} : { rca: String(row.rca) }),
});

const verificationToDomain = (row: Record<string, unknown>): Verification => ({
  id: String(row.id), ticketId: String(row.ticket_id), category: row.category as Verification['category'],
  profileName: String(row.profile_name ?? 'Applicant'), businessName: row.business_name as string | null, state: String(row.state ?? ''),
  status: row.status as Verification['status'], submittedAt: String(row.created_at),
  ...(row.email == null ? {} : { email: String(row.email) }),
  ...(row.phone == null ? {} : { phone: String(row.phone) }),
  ...(row.role == null ? {} : { role: row.role as NonNullable<Verification['role']> }),
  ...(row.address == null ? {} : { address: String(row.address) }),
  ...(row.branch_name == null ? {} : { branchName: String(row.branch_name) }),
  ...(row.dealer_license == null ? {} : { dealerLicense: String(row.dealer_license) }),
  ...(row.website == null ? {} : { website: String(row.website) }),
  supportedBrands: (row.supported_brands as string[] | undefined) ?? [],
  proofDocuments: (row.proof_docs as string[] | undefined) ?? [],
  termsAccepted: Boolean(row.terms_accepted),
  ...(row.terms_version == null ? {} : { termsVersion: String(row.terms_version) }),
  ...(row.terms_accepted_at == null ? {} : { termsAcceptedAt: String(row.terms_accepted_at) }),
  ...(row.decided_at == null ? {} : { decidedAt: String(row.decided_at) }),
  ...(row.decided_by_name == null ? {} : { decidedByName: String(row.decided_by_name) }),
  history: ((row.notes as Array<{ at?: string; ts?: string; actor_id?: string; agent?: string; decision?: string; reason?: string; note?: string; text?: string }> | undefined) ?? []).map((entry) => ({
    at: entry.at ?? entry.ts ?? String(row.updated_at ?? row.created_at),
    ...(entry.actor_id || entry.agent ? { actorId: entry.actor_id ?? entry.agent } : {}),
    ...(entry.decision ? { decision: entry.decision } : {}),
    ...(entry.reason ? { reason: entry.reason } : {}),
    ...(entry.note || entry.text ? { note: entry.note ?? entry.text } : {}),
  })),
  ...((row.notes as Array<{ reason?: string }> | undefined)?.at(-1)?.reason ? { decisionReason: (row.notes as Array<{ reason?: string }>).at(-1)!.reason } : {}),
});

const carToDomain = (row: Record<string, unknown>): InventoryCar => ({
  id: String(row.id), title: String(row.title), brand: String(row.brand_name ?? 'Vehicle'), model: String(row.model), year: Number(row.model_year),
  bodyType: String(row.body_type ?? ''), fuel: String(row.fuel ?? ''), transmission: String(row.transmission ?? ''), mileage: Number(row.mileage),
  price: String(row.price), status: row.status as InventoryCar['status'], image: driveDealHero,
});

const carInputToBody = (input: CarCreateInput) => ({ brand_id: input.brandId, state_id: input.stateId, title: input.title, model: input.model, model_year: input.modelYear, body_type: input.bodyType ?? null, seating_capacity: input.seatingCapacity ?? null, condition: input.condition ?? 'new', mileage: input.mileage ?? 0, fuel: input.fuel ?? null, transmission: input.transmission ?? null, price: input.price, image_paths: input.imagePaths ?? [] });

const revisionToDomain = <T>(row: Record<string, unknown>): AdminRevision<T> => ({
  id: String(row.id),
  configType: row.config_type as AdminConfigType,
  configKey: String(row.config_key),
  version: Number(row.version),
  status: row.status as AdminRevision<T>['status'],
  payload: row.payload as T,
  checksum: String(row.checksum),
  publishedAt: row.published_at == null ? null : String(row.published_at),
  publishedBy: row.published_by == null ? null : String(row.published_by),
  createdAt: row.created_at == null ? null : String(row.created_at),
  createdBy: String(row.created_by),
});

const bundleToDomain = <T>(row: Record<string, unknown>): AdminConfigBundle<T> => ({
  active: revisionToDomain<T>(row.active as Record<string, unknown>),
  draft: row.draft ? revisionToDomain<T>(row.draft as Record<string, unknown>) : null,
  history: ((row.history as Record<string, unknown>[]) ?? []).map(revisionToDomain<T>),
  defaultVersion: Number(row.default_version ?? 0),
});

async function* streamAi(input: { message: string; threadId?: string; agent?: 'sera-agent' | 'compare-agent'; requestIds?: string[]; quoteIds?: string[]; signal?: AbortSignal }): AsyncIterable<AiStreamEvent> {
  const response = await fetch(`${baseUrl}/ai/chat`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...(token() ? { authorization: `Bearer ${token()}` } : {}) },
    body: JSON.stringify({ message: input.message, thread_id: input.threadId, agent: input.agent ?? 'sera-agent', request_ids: input.requestIds ?? [], quote_ids: input.quoteIds ?? [] }),
    ...(input.signal ? { signal: input.signal } : {}),
  });
  if (!response.ok || !response.body) throw new Error('Sera is temporarily unavailable.');
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

async function* streamWorkflowPreview(
  message: string,
  options?: { threadId?: string; revisionId?: string; workflow?: WorkflowDefinition; promptKey?: string; prompt?: PromptDefinition },
): AsyncIterable<WorkflowPreviewStreamEvent> {
  const response = await fetch(`${baseUrl}/administration/workflow/preview/stream`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token() ? { authorization: `Bearer ${token()}` } : {}) },
    body: JSON.stringify({ message, thread_id: options?.threadId ?? null, revision_id: options?.revisionId ?? null, workflow_payload: options?.workflow ?? null, prompt_key: options?.promptKey ?? null, prompt_payload: options?.prompt ?? null }),
  });
  if (!response.ok || !response.body) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error?.message ?? `Preview failed (${response.status})`);
  }
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
      if (!data) continue;
      const event = JSON.parse(data.slice(6)) as WorkflowPreviewStreamEvent;
      if (event.type === 'error') throw new Error(event.message || 'The workflow test failed.');
      yield event;
    }
  }
}

function storeTokens(response: { access_token: string; refresh_token: string }) {
  window.localStorage.setItem(BROWSER_STORAGE_KEYS.accessToken, response.access_token);
  window.localStorage.setItem(BROWSER_STORAGE_KEYS.refreshToken, response.refresh_token);
}

const signupBody = (input: Record<string, unknown>) => ({ full_name: input.fullName, email: input.email, phone: input.phone, password: input.password, state_id: input.stateId, address: input.address ?? null, terms_accepted: input.termsAccepted, terms_version: input.termsVersion });

export const httpClient: DriveDealClient = {
  auth: {
    login: async (email, password) => {
      const response = await request<{ access_token: string; refresh_token: string; profile: Record<string, unknown> }>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
      storeTokens(response);
      return profileToSession(response.profile);
    },
    me: async () => profileToSession(await request('/auth/me')),
    signupBuyer: async (input) => {
      const response = await request<{ access_token: string; refresh_token: string; profile: Record<string, unknown> }>('/auth/signup/buyer', { method: 'POST', body: JSON.stringify(signupBody(input as unknown as Record<string, unknown>)) });
      storeTokens(response);
      return profileToSession(response.profile);
    },
    signupDealer: async (input) => {
      await request('/auth/signup/dealer', { method: 'POST', body: JSON.stringify({ ...signupBody(input as unknown as Record<string, unknown>), dealership_name: input.dealershipName, branch_name: input.branchName, dealer_license: input.dealerLicense, website: input.website, supported_brand_ids: input.supportedBrandIds }) });
      return { pending: true as const };
    },
    signupSupport: async (input) => {
      await request('/auth/signup/support', { method: 'POST', body: JSON.stringify({ ...signupBody(input as unknown as Record<string, unknown>), extra_information: input.extraInformation ?? null }) });
      return { pending: true as const };
    },
    refresh: async () => {
      const refreshToken = window.localStorage.getItem(BROWSER_STORAGE_KEYS.refreshToken);
      if (!refreshToken) throw new Error('No refresh token available.');
      const response = await request<{ access_token: string; refresh_token: string; profile: Record<string, unknown> }>('/auth/refresh', { method: 'POST', body: JSON.stringify({ refresh_token: refreshToken }) });
      storeTokens(response);
      return profileToSession(response.profile);
    },
    logout: async () => {
      try { await request('/auth/logout', { method: 'POST' }); } finally { clearTokens(); }
    },
  },
  profiles: {
    update: async (input) => profileToSession(await request('/profiles/me', { method: 'PATCH', body: JSON.stringify({ full_name: input.fullName, phone: input.phone, address: input.address, state_id: input.stateId, website: input.website, branch_name: input.branchName }) })),
    getPreferences: async () => {
      const row = await request<Record<string, unknown>>('/profiles/me/preferences');
      return { brandId: row.brand_id as string | null, otherBrandIds: (row.other_brand_ids as string[]) ?? [], modelPreference: row.model_preference as string | null, bodyType: row.body_type as string | null, seaterCount: row.seater_count as number | null, transmission: row.transmission as string | null, drivetrain: row.drivetrain as string | null, fuelType: row.fuel_type as string | null, condition: row.condition as string | null, exteriorColor: row.exterior_color as string | null, minYear: row.min_year as number | null, maxMileage: row.max_mileage as number | null, budgetMin: row.budget_min as number | null, budgetMax: row.budget_max as number | null, mustHaveFeatures: (row.must_have_features as string[]) ?? [], neverWantFeatures: (row.never_want_features as string[]) ?? [] };
    },
    savePreferences: async (input) => {
      const row = await request<Record<string, unknown>>('/profiles/me/preferences', { method: 'PUT', body: JSON.stringify({ brand_id: input.brandId ?? null, other_brand_ids: input.otherBrandIds ?? [], model_preference: input.modelPreference ?? null, body_type: input.bodyType ?? null, seater_count: input.seaterCount ?? null, transmission: input.transmission ?? null, drivetrain: input.drivetrain ?? null, fuel_type: input.fuelType ?? null, condition: input.condition ?? null, exterior_color: input.exteriorColor ?? null, min_year: input.minYear ?? null, max_mileage: input.maxMileage ?? null, budget_min: input.budgetMin ?? null, budget_max: input.budgetMax ?? null, must_have_features: input.mustHaveFeatures ?? [], never_want_features: input.neverWantFeatures ?? [] }) });
      return { brandId: row.brand_id as string | null, otherBrandIds: (row.other_brand_ids as string[]) ?? [], modelPreference: row.model_preference as string | null, bodyType: row.body_type as string | null, seaterCount: row.seater_count as number | null, transmission: row.transmission as string | null, drivetrain: row.drivetrain as string | null, fuelType: row.fuel_type as string | null, condition: row.condition as string | null, exteriorColor: row.exterior_color as string | null, minYear: row.min_year as number | null, maxMileage: row.max_mileage as number | null, budgetMin: row.budget_min as number | null, budgetMax: row.budget_max as number | null, mustHaveFeatures: (row.must_have_features as string[]) ?? [], neverWantFeatures: (row.never_want_features as string[]) ?? [] };
    },
  },
  requests: {
    list: async () => (await request<Record<string, unknown>[]>(workspaceView() ? `/support/workspaces/${workspaceView()}/requests` : '/requests')).map(requestToDomain),
    get: async (id) => requestToDomain(await request(`/requests/${id}`)),
    create: async (input) => requestToDomain(await request('/requests', { method: 'POST', body: JSON.stringify({ brand_id: input.brandId, buyer_area_state_id: input.buyerAreaStateId, model: input.model, body_type: input.bodyType ?? null, fuel_type: input.fuelType ?? null, year_min: input.yearMin ?? null, year_max: input.yearMax ?? null, trim: input.trim ?? null, drivetrain: input.drivetrain ?? null, transmission: input.transmission ?? null, color: input.color ?? null, budget_min: input.budgetMin ?? null, budget_max: input.budgetMax ?? null, target_otd_price: input.targetOtdPrice ?? null, buyer_area: input.buyerArea, search_radius_miles: input.searchRadiusMiles, timeline: input.timeline, must_haves: input.mustHaves ?? [], request_expire: input.requestExpire, status: input.status ?? 'open' }) })),
    publish: async (id) => requestToDomain(await request(`/requests/${id}/publish`, { method: 'POST' })),
    close: async (id) => requestToDomain(await request(`/requests/${id}/close`, { method: 'POST' })),
  },
  feed: {
    list: async () => (await request<Record<string, unknown>[]>(workspaceView() ? `/support/workspaces/${workspaceView()}/requests` : '/feed/requests')).map(requestToDomain),
    get: async (id) => requestToDomain(await request(`/feed/requests/${id}`)),
  },
  quotes: {
    list: async (requestId) => (await request<Record<string, unknown>[]>(workspaceView() ? `/support/workspaces/${workspaceView()}/quotes` : requestId && activeRole() === 'buyer' ? `/requests/${requestId}/quotes` : `/quotes${requestId ? `?request_id=${requestId}` : ''}`)).map(quoteToDomain),
    get: async (id) => quoteToDomain(await request(`/quotes/${id}`)),
    create: async (input) => quoteToDomain(await request('/quotes', { method: 'POST', body: JSON.stringify({ buyer_request_id: input.buyerRequestId, vehicle_price: input.vehiclePrice, doc_fee: input.docFee, sales_tax: input.salesTax, title_reg: input.titleReg, trade_in_credit: input.tradeInCredit, message: input.message, expires_at: input.expiresAt }) })),
    revise: async (id, input) => quoteToDomain(await request(`/quotes/${id}/revise`, { method: 'PATCH', body: JSON.stringify({ vehicle_price: input.vehiclePrice, doc_fee: input.docFee, sales_tax: input.salesTax, title_reg: input.titleReg, trade_in_credit: input.tradeInCredit, message: input.message }) })),
    accept: async (id) => quoteToDomain(await request(`/quotes/${id}/accept`, { method: 'POST' })),
    decline: async (id) => quoteToDomain(await request(`/quotes/${id}/decline`, { method: 'POST' })),
    withdraw: async (id) => quoteToDomain(await request(`/quotes/${id}/withdraw`, { method: 'POST' })),
    dealerContact: async (id) => {
      const row = await request<{ dealer: { name: string; email: string; phone: string | null } }>(`/quotes/${id}/dealer-contact`);
      return row.dealer;
    },
  },
  payments: {
    create: async (input) => {
      const row = await request<Record<string, unknown>>('/payment', { method: 'POST', body: JSON.stringify({ payment_method: input.paymentMethod, card_number: input.cardNumber, cardholder_name: input.cardholderName, expiry_month: input.expiryMonth, expiry_year: input.expiryYear, cvv: input.cvv }) });
      return {
        paymentId: String(row.payment_id), status: String(row.status), plan: String(row.plan), amount: String(row.amount), currency: String(row.currency),
        paymentMethod: row.payment_method as PaymentReceipt['paymentMethod'], cardBrand: row.card_brand == null ? null : String(row.card_brand),
        cardLast4: row.card_last4 == null ? null : String(row.card_last4), premiumExpiresAt: String(row.premium_expires_at), subscription: parseSubscription(row.subscription),
      };
    },
  },
  documents: {
    list: async (quoteId) => (await request<Record<string, unknown>[]>(`/documents/${quoteId}`)).map((row): DealDocument => ({ id: String(row.id), quoteId: String(row.quote_id), type: String(row.document_type), name: String(row.file_name ?? 'Attachment'), status: String(row.status), downloadUrl: String(row.download_url) })),
    upload: async (quoteId, file, type) => {
      const presigned = await request<{ url: string; key: string; headers: Record<string, string> }>('/documents/presign', { method: 'POST', body: JSON.stringify({ filename: file.name, content_type: file.type || 'application/octet-stream', quote_id: quoteId, document_type: type, size_bytes: file.size }) });
      const upload = await fetch(presigned.url, { method: 'PUT', headers: presigned.headers, body: file });
      if (!upload.ok) throw new Error(`Upload failed (${upload.status})`);
      const documentId = createId();
      const row = await request<Record<string, unknown>>(`/documents/${documentId}/confirm`, { method: 'POST', body: JSON.stringify({ quote_id: quoteId, document_type: type, object_key: presigned.key }) });
      const confirmed = (await request<Record<string, unknown>[]>(`/documents/${quoteId}`)).find((item) => String(item.id) === String(row.id));
      return { id: String(row.id), quoteId: String(row.quote_id), type: String(row.document_type), name: file.name, status: String(row.status), downloadUrl: String(confirmed?.download_url ?? '') };
    },
  },
  chats: {
    list: async (quoteId) => (await request<Record<string, unknown>[]>(`/chats/${quoteId}`)).map((row): ChatMessage => ({ id: String(row.id), quoteId: String(row.quote_id), senderId: String(row.sender_id), senderName: String(row.sender_name ?? 'Account unavailable'), body: String(row.message), createdAt: String(row.created_at), read: Boolean(row.read_at) })),
    send: async (quoteId, body) => { const row = await request<Record<string, unknown>>(`/chats/${quoteId}`, { method: 'POST', body: JSON.stringify({ id: createId(), message: body }) }); return { id: String(row.id), quoteId: String(row.quote_id), senderId: String(row.sender_id), senderName: String(row.sender_name ?? 'Account unavailable'), body: String(row.message), createdAt: String(row.created_at), read: Boolean(row.read_at) }; },
    requestAccess: async (quoteId, message) => quoteToDomain(await request(`/chats/${quoteId}/request-access`, { method: 'POST', body: JSON.stringify({ message }) })),
    listRequests: async () => (await request<Record<string, unknown>[]>('/chats/requests')).map(quoteToDomain),
    acceptRequest: async (quoteId) => quoteToDomain(await request(`/chats/requests/${quoteId}/accept`, { method: 'POST' })),
    declineRequest: async (quoteId, reason) => quoteToDomain(await request(`/chats/requests/${quoteId}/decline`, { method: 'POST', body: JSON.stringify({ reason: reason ?? null }) })),
    markRead: async (quoteId) => { await request(`/chats/${quoteId}/read`, { method: 'POST' }); },
  },
  deals: {
    list: async () => (await request<Record<string, unknown>[]>('/deals')).map(quoteToDomain),
    get: async (quoteId) => quoteToDomain(await request(`/deals/${quoteId}`)),
    updateStatus: async (quoteId, status) => quoteToDomain(await request(`/deals/${quoteId}/status`, { method: 'PATCH', body: JSON.stringify({ status }) })),
  },
  cars: {
    list: async () => (await request<Record<string, unknown>[]>('/cars')).map(carToDomain),
    create: async (input) => carToDomain(await request('/cars', { method: 'POST', body: JSON.stringify(carInputToBody(input)) })),
    update: async (id, input) => carToDomain(await request(`/cars/${id}`, { method: 'PATCH', body: JSON.stringify(carInputToBody(input)) })),
    updateStatus: async (id, status) => carToDomain(await request(`/cars/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) })),
  },
  inventory: { list: async () => (await request<Record<string, unknown>[]>('/cars')).map(carToDomain) },
  support: {
    listTickets: async () => (await request<Record<string, unknown>[]>('/support/tickets')).map(ticketToDomain),
    createTicket: async (input) => ticketToDomain(await request<Record<string, unknown>>('/support/tickets', { method: 'POST', body: JSON.stringify({ issue_summary: input.issueSummary, issue_description: input.issueDescription, issue_type: input.issueType, page_context: input.pageContext, priority: input.priority }) })),
    updateTicket: async (id, status, note, rca) => ticketToDomain(await request<Record<string, unknown>>(`/support/queue/tickets/${id}`, { method: 'PATCH', body: JSON.stringify({ status: status ?? null, note: note ?? null, rca: rca ?? null }) })),
    queue: async () => (await request<Record<string, unknown>[]>('/support/queue/tickets')).map(ticketToDomain),
    members: async () => (await request<Record<string, unknown>[]>('/members')).map(memberToDomain),
    member: async (id) => memberToDomain(await request<Record<string, unknown>>(`/members/${id}`)),
    updateMemberRole: async (id, role) => {
      await request(`/members/${id}/support-role`, { method: 'PATCH', body: JSON.stringify({ role }) });
      return memberToDomain(await request<Record<string, unknown>>(`/members/${id}`));
    },
  },
  verifications: {
    list: async () => (await request<Record<string, unknown>[]>('/verifications')).map(verificationToDomain),
    decide: async (id, decision, reason) => {
      const path = decision === 'approved' ? 'approve' : decision === 'denied' ? 'deny' : 'reject';
      return verificationToDomain(await request(`/verifications/${id}/${path}`, { method: 'POST', body: JSON.stringify({ reason }) }));
    },
  },
  reference: {
    states: async () => (await request<Record<string, unknown>[]>('/reference/states')).map((row): StateRef => ({ id: String(row.id), code: String(row.code), name: String(row.name), ...(row.sales_tax_rate == null ? {} : { salesTaxRate: String(row.sales_tax_rate) }) })),
    brands: async () => (await request<Record<string, unknown>[]>('/reference/brands')).map((row): BrandRef => ({ id: String(row.id), name: String(row.name) })),
    taxRate: async (stateCode) => { const row = await request<{ state_code: string; rate: string }>(`/reference/states/${stateCode}/tax-rate`); return { stateCode: row.state_code, rate: row.rate }; },
  },
  ai: {
    chat: streamAi,
    threads: async () => (await request<Array<Record<string, unknown>>>('/ai/threads')).map((row): AiThread => ({ id: String(row.id), type: row.type as AiThread['type'], title: String(row.title), updatedAt: String(row.updated_at), messages: [] })),
    thread: async (id) => {
      const row = await request<{ id: string; checkpoints: Array<{ user?: string; assistant?: string }> }>(`/ai/threads/${id}`);
      return { id: row.id, type: 'sera', title: 'Conversation', updatedAt: new Date().toISOString(), messages: row.checkpoints.flatMap((checkpoint, index) => [{ id: `${id}-${index}-user`, role: 'user' as const, body: checkpoint.user ?? '' }, { id: `${id}-${index}-assistant`, role: 'assistant' as const, body: checkpoint.assistant ?? '' }]).filter((message) => message.body) };
    },
    deleteThread: async (id) => { await request(`/ai/threads/${encodeURIComponent(id)}`, { method: 'DELETE' }); },
  },
  theme: {
    active: async () => request<ActiveTheme>('/theme/active'),
  },
  administration: {
    catalog: async () => {
      const row = await request<Record<string, unknown>>('/administration/catalog');
      return { workflowKey: String(row.workflow_key), themeKey: String(row.theme_key), nodes: row.nodes as AdminCatalog['nodes'], prompts: row.prompts as AdminCatalog['prompts'], models: row.models as AdminCatalog['models'] };
    },
    getConfig: async <T,>(type: AdminConfigType, key: string) => bundleToDomain<T>(await request<Record<string, unknown>>(`/administration/config/${type}/${encodeURIComponent(key)}`)),
    validate: async (type, key, payload) => request(`/administration/config/${type}/${encodeURIComponent(key)}/validate`, { method: 'POST', body: JSON.stringify({ payload }) }),
    saveDraft: async <T,>(type: AdminConfigType, key: string, payload: T, baseVersion: number) => revisionToDomain<T>(await request<Record<string, unknown>>(`/administration/config/${type}/${encodeURIComponent(key)}/draft`, { method: 'POST', body: JSON.stringify({ payload, base_version: baseVersion }) })),
    publish: async <T,>(type: AdminConfigType, key: string, revisionId: string) => revisionToDomain<T>(await request<Record<string, unknown>>(`/administration/config/${type}/${encodeURIComponent(key)}/publish`, { method: 'POST', body: JSON.stringify({ revision_id: revisionId }) })),
    rollback: async <T,>(type: AdminConfigType, key: string, version: number) => revisionToDomain<T>(await request<Record<string, unknown>>(`/administration/config/${type}/${encodeURIComponent(key)}/rollback/${version}`, { method: 'POST' })),
    setDefault: async (type, key, version) => { await request(`/administration/config/${type}/${encodeURIComponent(key)}/default`, { method: 'POST', body: JSON.stringify({ version }) }); },
    reset: async <T,>(type: AdminConfigType, key: string) => revisionToDomain<T>(await request<Record<string, unknown>>(`/administration/config/${type}/${encodeURIComponent(key)}/reset`, { method: 'POST' })),
    prompts: async () => (await request<Array<Record<string, unknown>>>('/administration/prompts')).map((row): AdminPromptBundle => ({ key: String(row.key), file: String(row.file), label: String(row.label), description: String(row.description), ...bundleToDomain(row) } as AdminPromptBundle)),
    audit: async () => (await request<Array<Record<string, unknown>>>('/administration/audit')).map((row): AdministrationAuditEvent => ({ id: Number(row.id), uuid: String(row.uuid), action: String(row.action), resourceType: row.resource_type as AdminConfigType, resourceKey: String(row.resource_key), revisionId: row.revision_id == null ? null : String(row.revision_id), actorId: String(row.actor_id), details: (row.details as Record<string, unknown>) ?? {}, createdAt: String(row.created_at) })),
    traces: async () => request<AiTrace[]>('/administration/traces'),
    trace: async (id) => request<AiTrace>(`/administration/traces/${encodeURIComponent(id)}`),
    exportConfiguration: async (format) => download(`/administration/export?format=${format}`, `deal-drive-config.${format === 'yaml' ? 'yaml' : 'json'}`),
    preview: async (message, options) => request<WorkflowPreview>('/administration/workflow/preview', { method: 'POST', body: JSON.stringify({ message, thread_id: options?.threadId ?? null, revision_id: options?.revisionId ?? null, workflow_payload: options?.workflow ?? null, prompt_key: options?.promptKey ?? null, prompt_payload: options?.prompt ?? null }) }),
    previewStream: streamWorkflowPreview,
  },
};

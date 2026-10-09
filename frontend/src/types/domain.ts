export type Role = 'buyer' | 'dealer' | 'support' | 'support-admin' | 'admin';
export type RequestStatus = 'draft' | 'open' | 'closed' | 'expired' | 'fulfilled';
export type QuoteStatus = 'pending' | 'negotiating' | 'accepted' | 'declined' | 'withdrawn' | 'expired';
export type DealStatus = 'paperwork_going_on' | 'funds_arrived' | 'dispatch' | 'delivery' | 'completed' | 'cancelled';
export type VerificationStatus = 'pending' | 'approved' | 'denied' | 'rejected';

export interface Session {
  id: string;
  fullName: string;
  email: string;
  role: Role;
  avatarInitials: string;
  phone?: string | null;
  address?: string | null;
  stateId?: string | null;
  dealershipName?: string | null;
  branchName?: string | null;
  dealerLicense?: string | null;
  website?: string | null;
  supportedBrands?: string[];
  subscription?: Subscription | null;
}

export interface SupportMember {
  id: string;
  name: string;
  email: string;
  role: 'support' | 'support-admin';
  status: 'active' | 'pending' | 'suspended';
  phone?: string | null;
  address?: string | null;
  lastLoginAt?: string | null;
  createdAt?: string | null;
}

export interface BuyerRequest {
  id: string;
  buyerId: string;
  brand: string;
  model: string;
  bodyType: string | null;
  fuelType?: string | null;
  transmission?: string | null;
  trim?: string | null;
  drivetrain?: string | null;
  color?: string | null;
  additionalInformation?: string | null;
  yearMin: number | null;
  yearMax: number | null;
  budgetMin: string | null;
  budgetMax: string | null;
  targetOtdPrice: string | null;
  area: string;
  radiusMiles: number;
  timeline: 'ASAP' | 'Within 1 week' | 'Within 2 weeks' | 'Just exploring';
  status: RequestStatus;
  quoteCount: number;
  viewCount: number;
  createdAt: string;
  expiresAt: string;
  image: string;
  mustHaves: string[];
  alreadyQuoted: boolean;
}

export interface Quote {
  id: string;
  requestId: string;
  brand: string;
  model: string;
  yearMin: number | null;
  yearMax: number | null;
  bodyType: string | null;
  buyerArea: string;
  dealerId: string;
  dealerName: string;
  dealerCity: string;
  rating: number;
  responseMinutes: number;
  vehiclePrice: string;
  docFee: string;
  salesTax: string;
  titleReg: string;
  tradeInCredit: string;
  finalPrice: string;
  status: QuoteStatus;
  dealStatus: DealStatus | null;
  message: string;
  createdAt: string;
  expiresAt: string;
  contactAvailable: boolean;
  chatRequestStatus: 'none' | 'pending' | 'accepted' | 'declined';
  chatRequestMessage?: string;
  vehicleImages?: string[];
  documents?: Array<{ name: string; status: 'uploaded' | 'verified' }>;
  /** One entry per price revision the dealer sent; `amount` is the final price before that revision. */
  revisions?: Array<{ amount: string; at: string }>;
}

export interface ChatMessage {
  id: string;
  quoteId: string;
  senderId: string;
  senderName: string;
  body: string;
  createdAt: string;
  read: boolean;
  edited?: boolean;
  unsent?: boolean;
}

export interface AiMessage {
  id: string;
  role: 'user' | 'assistant';
  body: string;
  guidedStep?: string | undefined;
  options?: string[] | undefined;
}

export interface AiThread {
  id: string;
  type: 'sera' | 'compare';
  title: string;
  updatedAt: string;
  messages: AiMessage[];
  guidedState?: Record<string, unknown> | undefined;
  requestContext?: Record<string, string> | null | undefined;
}

export interface DealDocument {
  id: string;
  quoteId: string;
  type: string;
  name: string;
  status: string;
  downloadUrl: string;
  /** Where the file lives in storage; needed to put a document back if a replacement upload fails. */
  objectKey: string;
}

export interface QuoteCreateInput {
  buyerRequestId: string;
  vehiclePrice: string;
  docFee: string;
  salesTax: string;
  titleReg: string;
  tradeInCredit: string;
  message: string;
  expiresAt: string;
}

export interface Ticket {
  id: string;
  publicId: string;
  callerName: string;
  callerEmail?: string;
  callerRole?: Role;
  category: 'customer' | 'dealer';
  summary: string;
  issueType?: string;
  pageContext?: string;
  status: 'open' | 'in_progress' | 'on_hold' | 'resolved' | 'closed';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  createdAt: string;
  description?: string;
  notes?: Array<{ at: string; author: string; body: string }>;
  rca?: string;
}

export interface SupportTicketCreate {
  issueSummary: string;
  issueDescription: string;
  issueType: 'bug' | 'incorrect_data' | 'account_access' | 'other';
  pageContext: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
}

export interface Verification {
  id: string;
  ticketId: string;
  category: 'dealer' | 'agent' | 'customer';
  profileName: string;
  businessName: string | null;
  state: string;
  status: VerificationStatus;
  submittedAt: string;
  email?: string;
  phone?: string;
  role?: Role;
  branchName?: string;
  dealerLicense?: string;
  website?: string;
  supportedBrands?: string[];
  address?: string;
  proofDocuments?: string[];
  termsAccepted?: boolean;
  termsVersion?: string;
  termsAcceptedAt?: string;
  decidedAt?: string;
  decidedByName?: string;
  decisionReason?: string;
  history?: Array<{ at: string; decision?: string; reason?: string; note?: string; actorId?: string }>;
}

export interface StateRef {
  id: string;
  code: string;
  name: string;
  salesTaxRate?: string;
}

export interface BrandRef {
  id: string;
  name: string;
}

export interface SignupInput {
  fullName: string;
  email: string;
  phone: string;
  password: string;
  stateId: string;
  address?: string | null;
  termsAccepted: boolean;
  termsVersion: string;
}

export interface DealerSignupInput extends SignupInput {
  dealershipName: string;
  branchName: string;
  dealerLicense: string;
  website: string;
  supportedBrandIds: string[];
}

export interface SupportSignupInput extends SignupInput {
  extraInformation?: string;
}

export interface RequestCreateInput {
  brandId: string;
  buyerAreaStateId: string;
  model: string;
  bodyType?: string | null;
  fuelType?: string | null;
  yearMin?: number | null;
  yearMax?: number | null;
  trim?: string | null;
  drivetrain?: string | null;
  transmission?: string | null;
  color?: string | null;
  budgetMin?: string | null;
  budgetMax?: string | null;
  targetOtdPrice?: string | null;
  buyerArea: string;
  searchRadiusMiles: number;
  timeline: BuyerRequest['timeline'];
  mustHaves?: string[];
  additionalInformation?: string | null;
  requestExpire: string;
  status?: 'draft' | 'open';
}

export interface BuyerPreferences {
  brandId?: string | null;
  otherBrandIds?: string[];
  modelPreference?: string | null;
  bodyType?: string | null;
  seaterCount?: number | null;
  transmission?: string | null;
  drivetrain?: string | null;
  fuelType?: string | null;
  condition?: string | null;
  exteriorColor?: string | null;
  minYear?: number | null;
  maxMileage?: number | null;
  budgetMin?: number | null;
  budgetMax?: number | null;
  mustHaveFeatures?: string[];
  neverWantFeatures?: string[];
}

export interface ProfileUpdateInput {
  fullName?: string;
  phone?: string;
  address?: string;
  stateId?: string;
  website?: string;
  branchName?: string;
}

export interface InventoryCar {
  id: string;
  title: string;
  brand: string;
  model: string;
  year: number;
  bodyType: string;
  fuel: string;
  transmission: string;
  mileage: number;
  price: string;
  status: 'available' | 'reserved' | 'sold' | 'inactive';
  image: string;
}

export interface CarCreateInput {
  brandId: string;
  stateId: string;
  title: string;
  model: string;
  modelYear: number;
  bodyType?: string | null;
  seatingCapacity?: number | null;
  condition?: string;
  mileage?: number;
  fuel?: string | null;
  transmission?: string | null;
  price: string;
  imagePaths?: string[];
}

export type AdminConfigType = 'workflow' | 'prompt' | 'theme';

export interface WorkflowPosition { x: number; y: number }

export interface WorkflowNodeDefinition {
  id: string;
  type: 'router' | 'agent' | 'tool' | 'action';
  label: string;
  description: string;
  position: WorkflowPosition;
}

export interface WorkflowEdgeDefinition {
  id: string;
  source: string;
  target: string;
  condition: string;
}

export interface WorkflowDefinition {
  name: string;
  description: string;
  nodes: WorkflowNodeDefinition[];
  edges: WorkflowEdgeDefinition[];
}

export interface ThemeDefinition {
  name: string;
  primary_rgb: [number, number, number] | number[];
  background_rgb: [number, number, number] | number[];
  surface_rgb: [number, number, number] | number[];
  text_rgb: [number, number, number] | number[];
  navigation_rgb: [number, number, number] | number[];
}

export interface PromptDefinition {
  content: string;
  model: string;
  reasoning_effort: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  max_output_tokens: number;
}

export interface AdminRevision<T = Record<string, unknown>> {
  id: string;
  configType: AdminConfigType;
  configKey: string;
  version: number;
  status: 'draft' | 'published' | 'archived';
  payload: T;
  checksum: string;
  publishedAt: string | null;
  publishedBy: string | null;
  createdAt: string | null;
  createdBy: string;
}

export interface AdminConfigBundle<T = Record<string, unknown>> {
  active: AdminRevision<T>;
  draft: AdminRevision<T> | null;
  history: AdminRevision<T>[];
  defaultVersion: number;
}

export interface AdminPromptBundle extends AdminConfigBundle<PromptDefinition> {
  key: string;
  file: string;
  label: string;
  description: string;
}

export interface AdminCatalog {
  workflowKey: string;
  themeKey: string;
  nodes: Array<Omit<WorkflowNodeDefinition, 'position'>>;
  prompts: Array<{ key: string; file: string; label: string; description: string }>;
  models: Array<{ id: string; label: string; description: string }>;
}

export interface AdministrationAuditEvent {
  id: number;
  uuid: string;
  action: string;
  resourceType: AdminConfigType;
  resourceKey: string;
  revisionId: string | null;
  actorId: string;
  details: Record<string, unknown>;
  createdAt: string;
}

export interface ActiveTheme extends ThemeDefinition { version: number }

export interface WorkflowPreview {
  trace_id: string;
  thread_id: string;
  route: string | null;
  mode: string | null;
  answer: string | null;
  sources: Array<{ title: string; url: string }>;
  steps: number;
  duration_ms: number;
  input_tokens: number;
  output_tokens: number;
  model_name: string | null;
  execution_flow: AiTraceSpan[];
}

export type WorkflowPreviewStreamEvent =
  | { type: 'started'; trace_id: string; thread_id: string }
  | { type: 'step'; span: AiTraceSpan }
  | { type: 'token'; text: string }
  | { type: 'complete'; result: WorkflowPreview }
  | { type: 'error'; message: string };

export interface AiTraceSpan {
  id: string;
  trace_id: string;
  sequence: number;
  name: string;
  kind: string;
  status: string;
  duration_ms: number;
  input_tokens: number;
  output_tokens: number;
  model_name: string | null;
  details: Record<string, unknown>;
  created_at: string;
}

export interface AiTrace {
  id: string;
  thread_id: string | null;
  user_id: string | null;
  query: string;
  status: string;
  is_test: boolean;
  route: string | null;
  model_name: string | null;
  input_tokens: number;
  output_tokens: number;
  duration_ms: number;
  error_message: string | null;
  configuration_version: string;
  created_at: string;
  spans?: AiTraceSpan[];
}

export type PlanName = 'premium' | 'trial' | 'free';
export type PaymentMethod = 'credit_card' | 'debit_card';

/**
 * The caller's plan and usage, from the `subscription` block on `/auth/me`. Dealers are limited by quotes and buyers by
 * car-buy posts; both are folded into `limit`/`used`/`remaining`/`canCreate`. `limit` and `remaining` are null while premium.
 */
export interface Subscription {
  role: 'buyer' | 'dealer';
  plan: PlanName;
  isPremium: boolean;
  premiumExpiresAt: string | null;
  trialStartedAt: string | null;
  trialExpiresAt: string | null;
  premiumPrice: string;
  currency: string;
  limit: number | null;
  used: number;
  remaining: number | null;
  canCreate: boolean;
}

export interface PaymentInput {
  paymentMethod: PaymentMethod;
  /** Digits only. */
  cardNumber: string;
  cardholderName: string;
  expiryMonth: number;
  /** Four-digit year. */
  expiryYear: number;
  cvv: string;
}

export interface PaymentReceipt {
  paymentId: string;
  status: string;
  plan: string;
  amount: string;
  currency: string;
  paymentMethod: PaymentMethod;
  cardBrand: string | null;
  cardLast4: string | null;
  premiumExpiresAt: string;
  subscription: Subscription | null;
}


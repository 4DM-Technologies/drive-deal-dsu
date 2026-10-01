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
}

export interface AiMessage {
  id: string;
  role: 'user' | 'assistant';
  body: string;
}

export interface AiThread {
  id: string;
  type: 'sera' | 'compare';
  title: string;
  updatedAt: string;
  messages: AiMessage[];
}

export interface DealDocument {
  id: string;
  quoteId: string;
  type: string;
  name: string;
  status: string;
  downloadUrl: string;
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
  category: 'customer' | 'dealer';
  summary: string;
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
  licenceNumber?: string;
  address?: string;
  decisionReason?: string;
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

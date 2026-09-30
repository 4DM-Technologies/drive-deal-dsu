export type Role = 'buyer' | 'dealer' | 'support' | 'admin';
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
}

export interface Quote {
  id: string;
  requestId: string;
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
  status: 'available' | 'reserved' | 'sold';
  image: string;
}

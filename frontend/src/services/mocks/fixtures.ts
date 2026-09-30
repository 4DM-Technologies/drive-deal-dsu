import hatchbackImage from '@/assets/vehicles/studio-hatchback.png';
import sedanImage from '@/assets/vehicles/studio-sedan.png';
import suvImage from '@/assets/vehicles/studio-suv.png';
import type { BuyerRequest, ChatMessage, InventoryCar, Quote, Session, Ticket, Verification } from '@/types/domain';

const now = Date.now();
const ago = (minutes: number) => new Date(now - minutes * 60_000).toISOString();
const later = (days: number) => new Date(now + days * 86_400_000).toISOString();

export const personas: Record<string, Session> = {
  buyer: { id: 'buyer-rahul', fullName: 'Rahul Sharma', email: 'rahul@drivedeal.demo', role: 'buyer', avatarInitials: 'RS' },
  dealer: { id: 'dealer-navee', fullName: 'Naveen Kumar', email: 'naveen@naveemotors.demo', role: 'dealer', avatarInitials: 'NK' },
  support: { id: 'support-maya', fullName: 'Maya Lewis', email: 'maya@drivedeal.demo', role: 'support', avatarInitials: 'ML' },
  'support-admin': { id: 'support-admin-priya', fullName: 'Priya Shah', email: 'priya@drivedeal.demo', role: 'support-admin', avatarInitials: 'PS' },
  admin: { id: 'admin-alex', fullName: 'Alex Morgan', email: 'alex@drivedeal.demo', role: 'admin', avatarInitials: 'AM' },
};

export const initialRequests: BuyerRequest[] = [
  { id: 'req-bronco', buyerId: 'buyer-rahul', brand: 'Ford', model: 'Bronco', bodyType: 'SUV', yearMin: 2024, yearMax: 2026, budgetMin: '38000.00', budgetMax: '75000.00', targetOtdPrice: '68000.00', area: 'Frisco, TX', radiusMiles: 50, timeline: 'Within 2 weeks', status: 'open', quoteCount: 3, createdAt: ago(180), expiresAt: later(12), image: suvImage, mustHaves: ['4WD', 'Adaptive cruise', 'Hard top'] },
  { id: 'req-jazz', buyerId: 'buyer-rahul', brand: 'Honda', model: 'Jazz', bodyType: 'Hatchback', yearMin: 2025, yearMax: 2026, budgetMin: '24000.00', budgetMax: '30000.00', targetOtdPrice: '28000.00', area: 'Frisco, TX', radiusMiles: 25, timeline: 'Within 1 week', status: 'fulfilled', quoteCount: 2, createdAt: ago(5_200), expiresAt: later(4), image: hatchbackImage, mustHaves: ['Automatic', 'Rear camera'] },
  { id: 'req-bmw', buyerId: 'buyer-rahul', brand: 'BMW', model: '5 Series', bodyType: 'Sedan', yearMin: 2024, yearMax: 2026, budgetMin: '60000.00', budgetMax: '80000.00', targetOtdPrice: '70000.00', area: 'Dallas, TX', radiusMiles: 50, timeline: 'Just exploring', status: 'open', quoteCount: 1, createdAt: ago(1_460), expiresAt: later(20), image: sedanImage, mustHaves: ['AWD', 'Driver assistance', 'Black interior'] },
  { id: 'req-mustang', buyerId: 'buyer-adithyaa', brand: 'Ford', model: 'Mustang GT', bodyType: 'Sports Car', yearMin: 2023, yearMax: 2026, budgetMin: null, budgetMax: null, targetOtdPrice: null, area: 'Plano, TX', radiusMiles: 100, timeline: 'Just exploring', status: 'open', quoteCount: 0, createdAt: ago(75), expiresAt: later(26), image: sedanImage, mustHaves: ['V8', 'Manual preferred'] },
];

export const initialQuotes: Quote[] = [
  { id: 'quote-navee', requestId: 'req-bronco', dealerId: 'dealer-navee', dealerName: 'Navee Motors', dealerCity: 'Plano, TX', rating: 4.9, responseMinutes: 12, vehiclePrice: '65345.00', docFee: '800.00', salesTax: '4084.00', titleReg: '0.00', tradeInCredit: '0.00', finalPrice: '70229.00', status: 'pending', dealStatus: null, message: 'In-stock Bronco Outer Banks with the hard top and driver-assistance package.', createdAt: ago(130), expiresAt: later(3), contactAvailable: false, chatRequestStatus: 'pending', chatRequestMessage: 'I like this Bronco offer. Can we discuss the final price and delivery date?' },
  { id: 'quote-lone-star', requestId: 'req-bronco', dealerId: 'dealer-lone-star', dealerName: 'Lone Star Ford', dealerCity: 'McKinney, TX', rating: 4.7, responseMinutes: 26, vehiclePrice: '65800.00', docFee: '595.00', salesTax: '4112.50', titleReg: '210.00', tradeInCredit: '0.00', finalPrice: '70717.50', status: 'pending', dealStatus: null, message: 'Factory allocation available this week. Delivery within ten business days.', createdAt: ago(105), expiresAt: later(2), contactAvailable: false, chatRequestStatus: 'pending' },
  { id: 'quote-north-texas', requestId: 'req-bronco', dealerId: 'dealer-north-texas', dealerName: 'North Texas Auto', dealerCity: 'Denton, TX', rating: 4.6, responseMinutes: 38, vehiclePrice: '66200.00', docFee: '695.00', salesTax: '4137.50', titleReg: '225.00', tradeInCredit: '0.00', finalPrice: '71257.50', status: 'pending', dealStatus: null, message: 'A clean, itemized offer with no mandatory accessories.', createdAt: ago(90), expiresAt: later(4), contactAvailable: false, chatRequestStatus: 'none' },
  { id: 'quote-jazz-accepted', requestId: 'req-jazz', dealerId: 'dealer-navee', dealerName: 'Navee Motors', dealerCity: 'Plano, TX', rating: 4.9, responseMinutes: 9, vehiclePrice: '32600.00', docFee: '150.00', salesTax: '2038.00', titleReg: '203.00', tradeInCredit: '0.00', finalPrice: '34991.00', status: 'accepted', dealStatus: 'funds_arrived', message: 'White pearl Jazz with delivery included.', createdAt: ago(4_900), expiresAt: later(1), contactAvailable: true, chatRequestStatus: 'accepted' },
  { id: 'quote-jazz-other', requestId: 'req-jazz', dealerId: 'dealer-metro', dealerName: 'Metro Honda', dealerCity: 'Irving, TX', rating: 4.5, responseMinutes: 44, vehiclePrice: '32950.00', docFee: '499.00', salesTax: '2059.38', titleReg: '203.00', tradeInCredit: '0.00', finalPrice: '35711.38', status: 'declined', dealStatus: null, message: 'Available in silver with the comfort package.', createdAt: ago(4_800), expiresAt: later(1), contactAvailable: false, chatRequestStatus: 'none' },
  { id: 'quote-bmw', requestId: 'req-bmw', dealerId: 'dealer-navee', dealerName: 'Navee Motors', dealerCity: 'Plano, TX', rating: 4.9, responseMinutes: 18, vehiclePrice: '68400.00', docFee: '650.00', salesTax: '4275.00', titleReg: '225.00', tradeInCredit: '3500.00', finalPrice: '70050.00', status: 'negotiating', dealStatus: null, message: 'Executive package, xDrive, black interior. Trade appraisal included.', createdAt: ago(900), expiresAt: later(5), contactAvailable: true, chatRequestStatus: 'accepted' },
];

export const initialMessages: ChatMessage[] = [
  { id: 'msg-1', quoteId: 'quote-jazz-accepted', senderId: 'buyer-rahul', senderName: 'Rahul', body: 'Thanks for the clear breakdown. Is delivery to Frisco included?', createdAt: ago(210), read: true },
  { id: 'msg-2', quoteId: 'quote-jazz-accepted', senderId: 'dealer-navee', senderName: 'Naveen at Navee Motors', body: 'Yes, delivery is included. I have also uploaded the window sticker and buyer order.', createdAt: ago(202), read: true },
  { id: 'msg-3', quoteId: 'quote-jazz-accepted', senderId: 'buyer-rahul', senderName: 'Rahul', body: 'Perfect. Please keep me posted when the paperwork moves forward.', createdAt: ago(198), read: true },
  { id: 'msg-4', quoteId: 'quote-bmw', senderId: 'buyer-rahul', senderName: 'Rahul', body: 'Would the price change without my trade-in?', createdAt: ago(45), read: true },
  { id: 'msg-5', quoteId: 'quote-bmw', senderId: 'dealer-navee', senderName: 'Naveen at Navee Motors', body: 'The out-the-door figure would be $73,550 without the trade-in credit.', createdAt: ago(39), read: false },
];

export const initialInventory: InventoryCar[] = [
  { id: 'car-1', title: '2025 Trail Edition SUV', brand: 'Ford', model: 'Bronco', year: 2025, bodyType: 'SUV', fuel: 'Gasoline', transmission: 'Automatic', mileage: 12, price: '65345.00', status: 'available', image: suvImage },
  { id: 'car-2', title: '2026 Urban Hatchback', brand: 'Honda', model: 'Jazz', year: 2026, bodyType: 'Hatchback', fuel: 'Gasoline', transmission: 'Automatic', mileage: 7, price: '32600.00', status: 'reserved', image: hatchbackImage },
  { id: 'car-3', title: '2025 Executive AWD Sedan', brand: 'BMW', model: '5 Series', year: 2025, bodyType: 'Sedan', fuel: 'Hybrid', transmission: 'Automatic', mileage: 480, price: '68400.00', status: 'available', image: sedanImage },
];

export const initialTickets: Ticket[] = [
  { id: 'ticket-1', publicId: 'TIC-316519', callerName: 'Rahul Sharma', category: 'customer', summary: 'Requests page is slow when many quotes arrive', status: 'in_progress', priority: 'high', createdAt: ago(9_800) },
  { id: 'ticket-2', publicId: 'DS9940692696', callerName: 'Naveen Kumar', category: 'dealer', summary: 'Need help replacing a deal document', status: 'open', priority: 'medium', createdAt: ago(780) },
];

export const initialVerifications: Verification[] = [
  { id: 'ver-1', ticketId: 'DV1788793917', category: 'dealer', profileName: 'Elena Ruiz', businessName: 'Westline Auto', state: 'Texas', status: 'pending', submittedAt: ago(340) },
  { id: 'ver-2', ticketId: 'DV1788882726', category: 'dealer', profileName: 'Naveen Kumar', businessName: 'Navee Motors', state: 'Texas', status: 'approved', submittedAt: ago(44_000) },
  { id: 'ver-3', ticketId: 'DV1788278835', category: 'dealer', profileName: 'Jordan Blake', businessName: 'Express Motors', state: 'Oklahoma', status: 'denied', submittedAt: ago(31_000) },
  { id: 'ver-4', ticketId: 'SA97379', category: 'agent', profileName: 'Maya Lewis', businessName: null, state: 'Texas', status: 'approved', submittedAt: ago(82_000) },
];

export const states = ['Alabama','Alaska','Arizona','Arkansas','California','Colorado','Connecticut','Delaware','District of Columbia','Florida','Georgia','Hawaii','Idaho','Illinois','Indiana','Iowa','Kansas','Kentucky','Louisiana','Maine','Maryland','Massachusetts','Michigan','Minnesota','Mississippi','Missouri','Montana','Nebraska','Nevada','New Hampshire','New Jersey','New Mexico','New York','North Carolina','North Dakota','Ohio','Oklahoma','Oregon','Pennsylvania','Rhode Island','South Carolina','South Dakota','Tennessee','Texas','Utah','Vermont','Virginia','Washington','West Virginia','Wisconsin','Wyoming'];
export const brands = ['Audi','BMW','Chevrolet','Ford','Honda','Hyundai','Kia','Mahindra','Mercedes-Benz','Nissan','Tesla','Toyota'];

import type { CardKind } from '@/helpers/card';

/** What the card form holds between steps, so going back to edit the details does not wipe it. */
export interface CardState { kind: CardKind; number: string; name: string; expiry: string; cvc: string }
export const emptyCard: CardState = { kind: 'credit', number: '', name: '', expiry: '', cvc: '' };

export interface CustomerDetails { fullName: string; email: string; phone: string; company: string; address: string }
export type DetailsErrors = Partial<Record<'fullName' | 'email' | 'phone' | 'address', string>>;

export const checkoutSteps = [
  { id: 'details', label: 'Customer details' },
  { id: 'payment', label: 'Payment method' },
  { id: 'confirmation', label: 'Confirmation' },
] as const;

export type CheckoutStep = (typeof checkoutSteps)[number]['id'];

/** Billing contact for the invoice. The payment API takes card fields only, so this stays in the browser. */
export function validateDetails(details: CustomerDetails): DetailsErrors {
  const errors: DetailsErrors = {};
  if (details.fullName.trim().length < 2) errors.fullName = 'Enter your full name.';

  const email = details.email.trim();
  if (!email) errors.email = 'Enter your email address.';
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) errors.email = 'Enter a valid email address, like name@example.com.';

  const phone = details.phone.trim();
  if (phone && phone.replace(/\D/g, '').length < 7) errors.phone = 'Enter a phone number with at least 7 digits.';

  if (details.address.trim().length < 5) errors.address = 'Enter your billing address.';
  return errors;
}

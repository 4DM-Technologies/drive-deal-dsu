export type CardBrand = 'visa' | 'mastercard' | 'amex' | 'discover' | 'unknown';
export type CardKind = 'credit' | 'debit';

export interface CardFields { number: string; name: string; expiry: string; cvc: string }
export type CardErrors = Partial<Record<keyof CardFields, string>>;

export const brandLabels: Record<CardBrand, string> = { visa: 'Visa', mastercard: 'Mastercard', amex: 'American Express', discover: 'Discover', unknown: 'Card' };

export const digitsOnly = (value: string) => value.replace(/\D/g, '');

export function detectBrand(digits: string): CardBrand {
  if (/^4/.test(digits)) return 'visa';
  if (/^(5[1-5]|222[1-9]|22[3-9]\d|2[3-6]\d\d|27[01]\d|2720)/.test(digits)) return 'mastercard';
  if (/^3[47]/.test(digits)) return 'amex';
  if (/^(6011|65|64[4-9])/.test(digits)) return 'discover';
  return 'unknown';
}

export const cardLength = (brand: CardBrand) => (brand === 'amex' ? 15 : 16);
export const cvcLength = (brand: CardBrand) => (brand === 'amex' ? 4 : 3);

function group(characters: string, brand: CardBrand): string {
  const parts: string[] = [];
  let at = 0;
  for (const size of brand === 'amex' ? [4, 6, 5] : [4, 4, 4, 4]) {
    if (at >= characters.length) break;
    parts.push(characters.slice(at, at + size));
    at += size;
  }
  return parts.join(' ');
}

/** Groups typed digits the way the card is printed: 4-4-4-4, or 4-6-5 for American Express. */
export function formatCardNumber(raw: string): string {
  const digits = digitsOnly(raw);
  const brand = detectBrand(digits);
  return group(digits.slice(0, cardLength(brand)), brand);
}

/** The number as shown on the card artwork: typed digits first, remaining positions as dots. */
export function displayCardNumber(digits: string, brand: CardBrand = detectBrand(digits)): string {
  const length = cardLength(brand);
  return group(digits.slice(0, length).padEnd(length, '•'), brand);
}

/** MM/YY. A first digit above 1 is read as a single-digit month (typing "5" gives "05"). */
export function formatExpiry(raw: string): string {
  let digits = digitsOnly(raw).slice(0, 4);
  if (digits.length > 0 && Number(digits[0]) > 1) digits = `0${digits}`.slice(0, 4);
  return digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits;
}

export function passesLuhn(digits: string): boolean {
  let sum = 0;
  for (let index = 0; index < digits.length; index += 1) {
    let digit = Number(digits[digits.length - 1 - index]);
    if (index % 2 === 1) { digit *= 2; if (digit > 9) digit -= 9; }
    sum += digit;
  }
  return digits.length > 0 && sum % 10 === 0;
}

function parseExpiry(value: string): { month: number; year: number } | null {
  const match = /^(0[1-9]|1[0-2])\/(\d{2})$/.exec(value);
  return match ? { month: Number(match[1]), year: 2000 + Number(match[2]) } : null;
}

export function validateCard(fields: CardFields, now = new Date()): CardErrors {
  const errors: CardErrors = {};
  const digits = digitsOnly(fields.number);
  const brand = detectBrand(digits);
  if (!digits) errors.number = 'Enter your card number.';
  else if (digits.length !== cardLength(brand) || !passesLuhn(digits)) errors.number = 'This card number doesn’t look right. Please check it.';

  const name = fields.name.trim();
  if (!name) errors.name = 'Enter the name printed on your card.';
  else if (name.length < 2 || !/^[\p{L}][\p{L}\s.'-]*$/u.test(name)) errors.name = 'Use letters only, as printed on the card.';

  const expiry = parseExpiry(fields.expiry);
  const thisYear = now.getFullYear();
  if (!fields.expiry) errors.expiry = 'Enter the expiry date.';
  else if (!expiry) errors.expiry = 'Use the MM/YY format.';
  else if (expiry.year < thisYear || (expiry.year === thisYear && expiry.month < now.getMonth() + 1)) errors.expiry = 'This card has expired.';
  else if (expiry.year > thisYear + 20) errors.expiry = 'Check the expiry year.';

  if (digitsOnly(fields.cvc).length !== cvcLength(brand)) errors.cvc = `Enter the ${cvcLength(brand)}-digit security code.`;
  return errors;
}

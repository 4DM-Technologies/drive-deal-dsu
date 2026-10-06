import { describe, expect, it } from 'vitest';

import { cardLength, detectBrand, displayCardNumber, formatCardNumber, formatExpiry, passesLuhn, validateCard } from '@/helpers/card';

const valid = { number: '4242 4242 4242 4242', name: 'Naveen Kumar', expiry: '12/30', cvc: '123' };
const june2026 = new Date(2026, 5, 15);

describe('card helpers', () => {
  it('detects the card network from the leading digits', () => {
    expect(detectBrand('4242424242424242')).toBe('visa');
    expect(detectBrand('5555555555554444')).toBe('mastercard');
    expect(detectBrand('2223000048400011')).toBe('mastercard');
    expect(detectBrand('378282246310005')).toBe('amex');
    expect(detectBrand('6011111111111117')).toBe('discover');
    expect(detectBrand('9')).toBe('unknown');
    expect(cardLength('amex')).toBe(15);
  });

  it('groups digits like the printed card and caps the length', () => {
    expect(formatCardNumber('4242424242424242999')).toBe('4242 4242 4242 4242');
    expect(formatCardNumber('4242-4242')).toBe('4242 4242');
    expect(formatCardNumber('378282246310005')).toBe('3782 822463 10005');
    expect(displayCardNumber('4242')).toBe('4242 •••• •••• ••••');
    expect(displayCardNumber('34')).toBe('34•• •••••• •••••');
    expect(displayCardNumber('•'.repeat(10) + '10005', 'amex')).toBe('•••• •••••• 10005');
  });

  it('formats the expiry as MM/YY', () => {
    expect(formatExpiry('1')).toBe('1');
    expect(formatExpiry('5')).toBe('05');
    expect(formatExpiry('1230')).toBe('12/30');
    expect(formatExpiry('12/')).toBe('12');
  });

  it('checks numbers with the Luhn algorithm', () => {
    expect(passesLuhn('4242424242424242')).toBe(true);
    expect(passesLuhn('4242424242424241')).toBe(false);
    expect(passesLuhn('')).toBe(false);
  });

  it('accepts a complete, valid card', () => {
    expect(validateCard(valid, june2026)).toEqual({});
    expect(validateCard({ number: '3782 822463 10005', name: 'A. Dealer', expiry: '01/28', cvc: '1234' }, june2026)).toEqual({});
  });

  it('reports each invalid field', () => {
    const errors = validateCard({ number: '4242 4242 4242 4241', name: '', expiry: '13/30', cvc: '12' }, june2026);
    expect(Object.keys(errors).sort()).toEqual(['cvc', 'expiry', 'name', 'number']);
  });

  it('treats a card as valid through the end of its expiry month', () => {
    expect(validateCard({ ...valid, expiry: '06/26' }, june2026).expiry).toBeUndefined();
    expect(validateCard({ ...valid, expiry: '05/26' }, june2026).expiry).toBe('This card has expired.');
    expect(validateCard({ ...valid, expiry: '12/60' }, june2026).expiry).toBe('Check the expiry year.');
  });

  it('requires a four-digit security code for American Express only', () => {
    expect(validateCard({ ...valid, number: '3782 822463 10005', cvc: '123' }, june2026).cvc).toBe('Enter the 4-digit security code.');
    expect(validateCard({ ...valid, cvc: '1234' }, june2026).cvc).toBe('Enter the 3-digit security code.');
  });
});

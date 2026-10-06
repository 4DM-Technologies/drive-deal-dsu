import { ArrowLeft, CreditCard, Landmark, Lock, ShieldCheck } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { brandLabels, cvcLength, detectBrand, digitsOnly, formatCardNumber, formatExpiry, validateCard } from '@/helpers/card';
import type { CardFields } from '@/helpers/card';
import type { CardState } from '@/helpers/checkout';
import { formatMoney } from '@/helpers/currency';
import { ApiError } from '@/services/platform/apiError';
import { client } from '@/services/platform/client';
import { BrandMark } from '@/ui/reusables/PaymentCard/PaymentCard';
import type { PaymentReceipt, Subscription } from '@/types/domain';

const networks = ['visa', 'mastercard', 'amex', 'discover'] as const;
const kinds = [{ value: 'credit', label: 'Credit card', icon: <CreditCard size={18} /> }, { value: 'debit', label: 'Debit card', icon: <Landmark size={18} /> }] as const;
const fieldOrder = ['number', 'name', 'expiry', 'cvc'] as const;

interface PaymentStepProps {
  subscription: Subscription;
  card: CardState;
  onCard: (card: CardState) => void;
  /** Turns the card artwork beside the form over while the security code is being typed. */
  onFlip: (flipped: boolean) => void;
  onBack: () => void;
  onPaid: (receipt: PaymentReceipt) => void;
}

/**
 * Step 2: card details. The card goes to `POST /payment`, which is the backend's simulated checkout (no payment provider yet),
 * and is cleared from the page as soon as the payment succeeds.
 */
export function PaymentStep({ subscription, card, onCard, onFlip, onBack, onPaid }: PaymentStepProps) {
  const [touched, setTouched] = useState<Partial<Record<keyof CardFields, boolean>>>({});
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, []);

  const digits = digitsOnly(card.number);
  const brand = detectBrand(digits);
  const errors = useMemo(() => validateCard({ number: card.number, name: card.name, expiry: card.expiry, cvc: card.cvc }), [card.number, card.name, card.expiry, card.cvc]);
  const shown = (field: keyof CardFields) => (touched[field] ? errors[field] : undefined);
  const touch = (field: keyof CardFields) => () => setTouched((current) => ({ ...current, [field]: true }));
  const fieldProps = (field: keyof CardFields) => ({ 'aria-invalid': shown(field) ? true : undefined, 'aria-describedby': shown(field) ? `card-${field}-error` : undefined, onBlur: touch(field) });
  const fieldError = (field: keyof CardFields) => shown(field) && <small className="field-error" id={`card-${field}-error`} role="alert">{shown(field)}</small>;
  const update = (patch: Partial<CardState>) => onCard({ ...card, ...patch });

  function onNumber(event: ChangeEvent<HTMLInputElement>) {
    const formatted = formatCardNumber(event.target.value);
    update({ number: formatted, cvc: card.cvc.slice(0, cvcLength(detectBrand(digitsOnly(formatted)))) });
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setTouched({ number: true, name: true, expiry: true, cvc: true });
    const failing = fieldOrder.find((field) => errors[field]);
    if (failing) { document.getElementById(`card-${failing}`)?.focus(); return; }
    if (paying) return;
    setPaying(true);
    setError('');
    try {
      const receipt = await client.payments.create({
        paymentMethod: card.kind === 'credit' ? 'credit_card' : 'debit_card',
        cardNumber: digits, cardholderName: card.name.trim(),
        expiryMonth: Number(card.expiry.slice(0, 2)), expiryYear: 2000 + Number(card.expiry.slice(3, 5)), cvv: card.cvc,
      });
      onPaid(receipt);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 422) setError('Please check your card details and try again.');
      else if (cause instanceof ApiError && cause.status === 403) setError('Billing isn’t available for this account.');
      else setError(cause instanceof Error ? cause.message : 'The payment could not be completed. Please try again.');
      setPaying(false);
    }
  }

  const price = formatMoney(subscription.premiumPrice, true);
  return (
    <form className="checkout-form" onSubmit={(event) => { void onSubmit(event); }} noValidate>
      <header className="checkout-step-head checkout-step-head-split">
        <h2 ref={heading} tabIndex={-1}>Payment method</h2>
        <div className="pay-networks" role="img" aria-label="Accepted cards: Visa, Mastercard, American Express and Discover">
          {networks.map((item) => <span key={item} className={item === brand ? 'on' : ''} title={brandLabels[item]}><BrandMark brand={item} /></span>)}
        </div>
      </header>
      <fieldset className="pay-kind">
        <legend className="sr-only">Card type</legend>
        {kinds.map((item) => (
          <label key={item.value} className={`pay-tile ${card.kind === item.value ? 'on' : ''}`}>
            <input type="radio" name="card-kind" value={item.value} checked={card.kind === item.value} onChange={() => update({ kind: item.value })} />
            <span className="pay-dot" aria-hidden="true" />{item.icon}{item.label}
          </label>
        ))}
      </fieldset>
      <div className="checkout-fields">
        <div className="field"><label htmlFor="card-number">Card number *</label>
          <div className="input-with-icon billing-number"><CreditCard /><input id="card-number" name="cardnumber" className="input" spellCheck={false} inputMode="numeric" autoComplete="cc-number" placeholder="1234 5678 9012 3456" value={card.number} onChange={onNumber} {...fieldProps('number')} /><span className="billing-number-brand">{brand !== 'unknown' && <BrandMark brand={brand} />}</span></div>{fieldError('number')}</div>
        <div className="field"><label htmlFor="card-name">Cardholder name *</label>
          <input id="card-name" name="ccname" className="input" autoComplete="cc-name" placeholder="As printed on the card" value={card.name} onChange={(event) => update({ name: event.target.value })} {...fieldProps('name')} />{fieldError('name')}</div>
        <div className="field"><label htmlFor="card-expiry">Expiry date *</label>
          <input id="card-expiry" name="exp-date" className="input" spellCheck={false} inputMode="numeric" autoComplete="cc-exp" placeholder="MM/YY" maxLength={5} value={card.expiry} onChange={(event) => update({ expiry: formatExpiry(event.target.value) })} {...fieldProps('expiry')} />{fieldError('expiry')}</div>
        <div className="field"><label htmlFor="card-cvc">CVC *</label>
          <input id="card-cvc" name="cvc" className="input" spellCheck={false} inputMode="numeric" autoComplete="cc-csc" placeholder={brand === 'amex' ? '1234' : '123'} maxLength={cvcLength(brand)} value={card.cvc} onChange={(event) => update({ cvc: digitsOnly(event.target.value).slice(0, cvcLength(brand)) })} onFocus={() => onFlip(true)} {...fieldProps('cvc')} onBlur={() => { onFlip(false); touch('cvc')(); }} />{fieldError('cvc')}</div>
      </div>
      <p className="checkout-secure"><ShieldCheck size={15} aria-hidden="true" />Your full card number and security code are never stored.</p>
      {error && <div className="inline-warning" role="alert">{error}</div>}
      <footer className="checkout-actions">
        <button type="button" className="button button-ghost" onClick={onBack} disabled={paying}><ArrowLeft size={16} /> Back</button>
        <button className="button button-primary checkout-pay" disabled={paying}>{paying ? <><span className="billing-spinner" aria-hidden="true" /> Processing payment…</> : <><Lock size={16} /> Pay {price}</>}</button>
      </footer>
    </form>
  );
}

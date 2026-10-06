import { CreditCard, Landmark, Lock, ShieldCheck } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { brandLabels, cvcLength, detectBrand, digitsOnly, formatCardNumber, formatExpiry, validateCard } from '@/helpers/card';
import type { CardFields, CardKind } from '@/helpers/card';
import { formatMoney } from '@/helpers/currency';
import { premiumTerm, usageNoun } from '@/helpers/subscription';
import { ApiError } from '@/services/platform/apiError';
import { client } from '@/services/platform/client';
import { BrandMark, PaymentCard } from '@/ui/reusables/PaymentCard/PaymentCard';
import type { PaymentReceipt, Subscription } from '@/types/domain';

const networks = ['visa', 'mastercard', 'amex', 'discover'] as const;

/**
 * Renders two grid items for the billing layout: the live card preview (left column) and the checkout card (right column).
 * The card is sent to `POST /payment` and never kept in the browser afterwards.
 */
export function CheckoutForm({ subscription, onPaid }: { subscription: Subscription; onPaid: (receipt: PaymentReceipt) => void }) {
  const [kind, setKind] = useState<CardKind>('credit');
  const [number, setNumber] = useState('');
  const [name, setName] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cvc, setCvc] = useState('');
  const [touched, setTouched] = useState<Partial<Record<keyof CardFields, boolean>>>({});
  const [flipped, setFlipped] = useState(false);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState('');

  const digits = digitsOnly(number);
  const brand = detectBrand(digits);
  const errors = useMemo(() => validateCard({ number, name, expiry, cvc }), [number, name, expiry, cvc]);
  const shown = (field: keyof CardFields) => (touched[field] ? errors[field] : undefined);
  const touch = (field: keyof CardFields) => () => setTouched((current) => ({ ...current, [field]: true }));
  const fieldProps = (field: keyof CardFields) => ({ 'aria-invalid': shown(field) ? true : undefined, 'aria-describedby': shown(field) ? `card-${field}-error` : undefined, onBlur: touch(field) });
  const fieldError = (field: keyof CardFields) => shown(field) && <small className="field-error" id={`card-${field}-error`} role="alert">{shown(field)}</small>;

  function onNumber(event: ChangeEvent<HTMLInputElement>) {
    const formatted = formatCardNumber(event.target.value);
    setNumber(formatted);
    setCvc((current) => current.slice(0, cvcLength(detectBrand(digitsOnly(formatted)))));
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setTouched({ number: true, name: true, expiry: true, cvc: true });
    const failing = (['number', 'name', 'expiry', 'cvc'] as const).find((field) => errors[field]);
    if (failing) { document.getElementById(`card-${failing}`)?.focus(); return; }
    if (paying) return;
    setPaying(true);
    setError('');
    try {
      const receipt = await client.payments.create({
        paymentMethod: kind === 'credit' ? 'credit_card' : 'debit_card',
        cardNumber: digits, cardholderName: name.trim(),
        expiryMonth: Number(expiry.slice(0, 2)), expiryYear: 2000 + Number(expiry.slice(3, 5)), cvv: cvc,
      });
      // The card never outlives the form: clear every field before handing over the receipt.
      setNumber(''); setName(''); setExpiry(''); setCvc(''); setTouched({}); setFlipped(false);
      onPaid(receipt);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 422) setError('Please check your card details and try again.');
      else if (cause instanceof ApiError && cause.status === 403) setError('Billing isn’t available for this account.');
      else setError(cause instanceof Error ? cause.message : 'The payment could not be completed. Please try again.');
    } finally {
      setPaying(false);
    }
  }

  const price = formatMoney(subscription.premiumPrice, true);
  const kinds = [{ value: 'credit', label: 'Credit card', icon: <CreditCard size={17} /> }, { value: 'debit', label: 'Debit card', icon: <Landmark size={17} /> }] as const;
  return (
    <>
      <div className="billing-preview">
        <PaymentCard brand={brand} kind={kind} digits={digits} name={name} expiry={expiry} cvc={cvc} flipped={flipped} />
        <p className="billing-card-note"><ShieldCheck size={14} /> Your full card number and security code are never stored.</p>
      </div>
      <section className="card billing-pay" aria-labelledby="billing-pay-title">
        <header className="billing-pay-head">
          <div><h2 id="billing-pay-title">{subscription.isPremium ? 'Renew Premium' : 'Upgrade to Premium'}</h2><p>Pay by debit or credit card.</p></div>
          <div className="pay-networks" role="img" aria-label="Accepted cards: Visa, Mastercard, American Express and Discover">
            {networks.map((item) => <span key={item} className={item === brand ? 'on' : ''} title={brandLabels[item]}><BrandMark brand={item} /></span>)}
          </div>
        </header>
        <form className="billing-form" onSubmit={(event) => { void onSubmit(event); }} noValidate>
          <fieldset className="pay-kind">
            <legend className="sr-only">Card type</legend>
            {kinds.map((item) => (
              <label key={item.value} className={`pay-tile ${kind === item.value ? 'on' : ''}`}>
                <input type="radio" name="card-kind" value={item.value} checked={kind === item.value} onChange={() => setKind(item.value)} />
                <span className="pay-dot" aria-hidden="true" />{item.icon}{item.label}
              </label>
            ))}
          </fieldset>
          <div className="pay-row"><label htmlFor="card-number">Card number</label>
            <div className="pay-cell"><div className="input-with-icon billing-number"><CreditCard /><input id="card-number" name="cardnumber" className="input" spellCheck={false} inputMode="numeric" autoComplete="cc-number" placeholder="1234 5678 9012 3456" value={number} onChange={onNumber} {...fieldProps('number')} /><span className="billing-number-brand">{brand !== 'unknown' && <BrandMark brand={brand} />}</span></div>{fieldError('number')}</div></div>
          <div className="pay-row"><label htmlFor="card-name">Cardholder</label>
            <div className="pay-cell"><input id="card-name" name="ccname" className="input" autoComplete="cc-name" placeholder="As printed on the card" value={name} onChange={(event) => setName(event.target.value)} {...fieldProps('name')} />{fieldError('name')}</div></div>
          <div className="pay-row pay-row-split">
            <label htmlFor="card-expiry">Expiry date</label>
            <div className="pay-cell"><input id="card-expiry" name="exp-date" className="input" spellCheck={false} inputMode="numeric" autoComplete="cc-exp" placeholder="MM/YY" maxLength={5} value={expiry} onChange={(event) => setExpiry(formatExpiry(event.target.value))} {...fieldProps('expiry')} />{fieldError('expiry')}</div>
            <label htmlFor="card-cvc">CVC</label>
            <div className="pay-cell"><input id="card-cvc" name="cvc" className="input" spellCheck={false} inputMode="numeric" autoComplete="cc-csc" placeholder={brand === 'amex' ? '1234' : '123'} maxLength={cvcLength(brand)} value={cvc} onChange={(event) => setCvc(digitsOnly(event.target.value).slice(0, cvcLength(brand)))} onFocus={() => setFlipped(true)} {...fieldProps('cvc')} onBlur={() => { setFlipped(false); touch('cvc')(); }} />{fieldError('cvc')}</div>
          </div>
          <dl className="pay-summary">
            <div><dt>Premium · unlimited {usageNoun(subscription.role).many}</dt><dd>{price}</dd></div>
            <div className="pay-muted"><dt>Term</dt><dd>{premiumTerm(subscription)}</dd></div>
            <div className="pay-total"><dt>Total amount</dt><dd>{price} <small>{subscription.currency}</small></dd></div>
          </dl>
          {error && <div className="inline-warning" role="alert">{error}</div>}
          <button className="button button-primary billing-submit" disabled={paying}>{paying ? <><span className="billing-spinner" aria-hidden="true" /> Processing payment…</> : <><Lock size={17} /> Pay {price}</>}</button>
        </form>
      </section>
    </>
  );
}

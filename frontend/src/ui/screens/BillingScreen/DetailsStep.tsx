import { ArrowRight, Building2, Mail, MapPin, Phone, UserRound } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { validateDetails } from '@/helpers/checkout';
import type { CustomerDetails, DetailsErrors } from '@/helpers/checkout';

interface DetailsStepProps {
  details: CustomerDetails;
  onChange: (details: CustomerDetails) => void;
  onNext: () => void;
  /** Dealers also give their dealership for the receipt. */
  isDealer: boolean;
  /** Moves keyboard focus to the heading, used when the step is reopened with Back or the stepper. */
  focusHeading: boolean;
}

const order = ['fullName', 'email', 'phone', 'address'] as const;

/** Step 1: who the receipt is for. The payment API takes card fields only, so this never leaves the browser. */
export function DetailsStep({ details, onChange, onNext, isDealer, focusHeading }: DetailsStepProps) {
  const [touched, setTouched] = useState<Partial<Record<keyof DetailsErrors, boolean>>>({});
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (focusHeading) heading.current?.focus({ preventScroll: true }); }, [focusHeading]);

  const errors = useMemo(() => validateDetails(details), [details]);
  const shown = (field: keyof DetailsErrors) => (touched[field] ? errors[field] : undefined);
  const set = (field: keyof CustomerDetails) => (value: string) => onChange({ ...details, [field]: value });
  const props = (field: keyof DetailsErrors) => ({ 'aria-invalid': shown(field) ? true : undefined, 'aria-describedby': shown(field) ? `details-${field}-error` : undefined, onBlur: () => setTouched((current) => ({ ...current, [field]: true })) });
  const error = (field: keyof DetailsErrors) => shown(field) && <small className="field-error" id={`details-${field}-error`} role="alert">{shown(field)}</small>;

  function submit(event: FormEvent) {
    event.preventDefault();
    setTouched({ fullName: true, email: true, phone: true, address: true });
    const failing = order.find((field) => errors[field]);
    if (failing) { document.getElementById(`details-${failing}`)?.focus(); return; }
    onNext();
  }

  return (
    <form className="checkout-form" onSubmit={submit} noValidate>
      <header className="checkout-step-head">
        <h2 ref={heading} tabIndex={-1}>Customer details</h2>
        <p>Who should the receipt be made out to? Fields marked * are required.</p>
      </header>
      <div className="checkout-fields">
        <div className="field"><label htmlFor="details-fullName">Full name *</label>
          <div className="input-with-icon"><UserRound /><input id="details-fullName" name="name" className="input" autoComplete="name" value={details.fullName} onChange={(event) => set('fullName')(event.target.value)} {...props('fullName')} /></div>{error('fullName')}</div>
        <div className="field"><label htmlFor="details-email">Email address *</label>
          <div className="input-with-icon"><Mail /><input id="details-email" name="email" type="email" className="input" autoComplete="email" spellCheck={false} value={details.email} onChange={(event) => set('email')(event.target.value)} {...props('email')} /></div>{error('email')}</div>
        <div className="field"><label htmlFor="details-phone">Phone number</label>
          <div className="input-with-icon"><Phone /><input id="details-phone" name="tel" type="tel" className="input" autoComplete="tel" placeholder="(469) 555-0142" value={details.phone} onChange={(event) => set('phone')(event.target.value)} {...props('phone')} /></div>{error('phone')}</div>
        {isDealer && <div className="field"><label htmlFor="details-company">Dealership</label>
          <div className="input-with-icon"><Building2 /><input id="details-company" name="organization" className="input" autoComplete="organization" value={details.company} onChange={(event) => set('company')(event.target.value)} /></div></div>}
        <div className={`field ${isDealer ? 'checkout-fields-wide' : ''}`}><label htmlFor="details-address">Billing address *</label>
          <div className="input-with-icon"><MapPin /><input id="details-address" name="street-address" className="input" autoComplete="street-address" placeholder="Street, city, state" value={details.address} onChange={(event) => set('address')(event.target.value)} {...props('address')} /></div>{error('address')}</div>
      </div>
      <footer className="checkout-actions">
        <Link className="button button-ghost" to="/account">Cancel</Link>
        <button className="button button-primary">Continue to payment <ArrowRight size={16} /></button>
      </footer>
    </form>
  );
}

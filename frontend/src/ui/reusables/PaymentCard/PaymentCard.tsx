import { CreditCard } from 'lucide-react';
import { displayCardNumber, type CardBrand, type CardKind } from '@/helpers/card';

export function BrandMark({ brand }: { brand: CardBrand }) {
  if (brand === 'visa') return <svg className="pay-brand" viewBox="0 0 64 24" aria-hidden="true"><text x="32" y="19" textAnchor="middle" fontSize="22" fontWeight="800" fontStyle="italic" fontFamily="Georgia, 'Times New Roman', serif" letterSpacing="1" fill="currentColor">VISA</text></svg>;
  if (brand === 'mastercard') return <svg className="pay-brand" viewBox="0 0 48 30" aria-hidden="true"><circle cx="18" cy="15" r="12" fill="#eb001b" /><circle cx="30" cy="15" r="12" fill="#f79e1b" /><path d="M24 5.1a12 12 0 0 1 0 19.8 12 12 0 0 1 0-19.8z" fill="#ff5f00" /></svg>;
  if (brand === 'amex') return <svg className="pay-brand" viewBox="0 0 64 24" aria-hidden="true"><rect x="1" y="1" width="62" height="22" rx="4" fill="none" stroke="currentColor" strokeWidth="2" /><text x="32" y="17" textAnchor="middle" fontSize="13" fontWeight="800" fontFamily="Arial, sans-serif" letterSpacing="1.5" fill="currentColor">AMEX</text></svg>;
  if (brand === 'discover') return <svg className="pay-brand" viewBox="0 0 90 24" aria-hidden="true"><text x="2" y="17" fontSize="12" fontWeight="800" fontFamily="Arial, sans-serif" letterSpacing=".4" fill="currentColor">DISCOVER</text><circle cx="82" cy="12" r="6" fill="#f58220" /></svg>;
  return <CreditCard className="pay-brand pay-brand-generic" aria-hidden="true" />;
}

function Chip() {
  return <svg className="pay-chip" viewBox="0 0 44 34" aria-hidden="true"><rect width="44" height="34" rx="6" fill="#e6c97d" /><path d="M0 12h14m-14 10h14M30 12h14M30 22h14M14 0v34M30 0v34M14 17h16" fill="none" stroke="rgba(92,66,12,.45)" strokeWidth="1.2" /><rect x="14" y="11" width="16" height="12" rx="3" fill="none" stroke="rgba(92,66,12,.45)" strokeWidth="1.2" /></svg>;
}

function Contactless() {
  return <svg className="pay-contactless" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M8.5 8.5a5 5 0 0 1 0 7" /><path d="M12 6a8.5 8.5 0 0 1 0 12" /><path d="M15.5 3.5a12 12 0 0 1 0 17" /></svg>;
}

interface PaymentCardProps {
  brand: CardBrand;
  kind: CardKind;
  /** Digits only. Shown exactly as given, with the unfilled positions as dots. */
  digits: string;
  name: string;
  expiry: string;
  cvc: string;
  /** Turns the card over to show the security code. */
  flipped?: boolean;
}

/** Decorative card artwork. The real inputs live in the form beside it, so this is hidden from assistive tech. */
export function PaymentCard({ brand, kind, digits, name, expiry, cvc, flipped = false }: PaymentCardProps) {
  return (
    <div className="pay-card-scene" aria-hidden="true">
      <div className={`pay-card brand-${brand} ${flipped ? 'flipped' : ''}`}>
        <div className="pay-card-face pay-card-front">
          <div className="pay-card-row"><span className="pay-card-kind">{kind === 'credit' ? 'Credit' : 'Debit'}</span><BrandMark brand={brand} /></div>
          <div className="pay-card-row pay-card-chiprow"><Chip /><Contactless /></div>
          <div className="pay-card-number">{displayCardNumber(digits, brand)}</div>
          <div className="pay-card-row pay-card-meta">
            <div><small>Card holder</small><strong>{name.trim() || 'Your name'}</strong></div>
            <div><small>Expires</small><strong>{expiry || 'MM/YY'}</strong></div>
          </div>
        </div>
        <div className="pay-card-face pay-card-back">
          <div className="pay-card-stripe" />
          <div className="pay-card-signature"><small>Security code</small><strong>{cvc || '•••'}</strong></div>
          <div className="pay-card-backfoot"><span>Deal&amp;Drive</span><BrandMark brand={brand} /></div>
        </div>
      </div>
    </div>
  );
}

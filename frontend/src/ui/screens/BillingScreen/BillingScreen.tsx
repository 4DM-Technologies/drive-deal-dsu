import { ArrowLeft } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { detectBrand, digitsOnly } from '@/helpers/card';
import { emptyCard } from '@/helpers/checkout';
import type { CardState, CheckoutStep, CustomerDetails } from '@/helpers/checkout';
import { client } from '@/services/platform/client';
import { useDemoStore } from '@/services/platform/demoStore';
import { useEffectiveSession } from '@/ui/navigations/previewSession';
import { PaymentCard } from '@/ui/reusables/PaymentCard/PaymentCard';
import { CheckoutStepper } from '@/ui/screens/BillingScreen/CheckoutStepper';
import { DetailsStep } from '@/ui/screens/BillingScreen/DetailsStep';
import { OrderSummary } from '@/ui/screens/BillingScreen/OrderSummary';
import { PlanSkeleton } from '@/ui/screens/AccountScreen/PlanSkeleton';
import { PaymentStep } from '@/ui/screens/BillingScreen/PaymentStep';
import { ReceiptView } from '@/ui/screens/BillingScreen/ReceiptView';
import type { PaymentReceipt } from '@/types/domain';

/**
 * Checkout for Premium, in three steps: customer details, payment method, confirmation.
 * The payment is the backend's simulated checkout, so any well-formed card succeeds.
 */
export default function BillingScreen() {
  const session = useEffectiveSession();
  const accountSession = useDemoStore((state) => state.session);
  const setSession = useDemoStore((state) => state.setSession);
  const [refreshing, setRefreshing] = useState(true);
  const [step, setStep] = useState<CheckoutStep>('details');
  const [moved, setMoved] = useState(false);
  const [details, setDetails] = useState<CustomerDetails>(() => ({
    fullName: session?.fullName ?? '', email: session?.email ?? '', phone: session?.phone ?? '',
    company: session?.dealershipName ?? '', address: session?.address ?? '',
  }));
  const [card, setCard] = useState<CardState>(emptyCard);
  const [flipped, setFlipped] = useState(false);
  const [receipt, setReceipt] = useState<PaymentReceipt | null>(null);

  // The price and term depend on the live plan (a renewal stacks a year), so refresh it whenever this page opens.
  useEffect(() => { void client.auth.me().then(setSession).catch(() => undefined).finally(() => setRefreshing(false)); }, [setSession]);

  if (!session) return null;
  const subscription = session.subscription ?? null;

  function go(next: CheckoutStep) {
    setMoved(true);
    setStep(next);
  }

  function onPaid(paid: PaymentReceipt) {
    // The card never outlives the form: clear it before the receipt shows.
    setCard(emptyCard);
    setFlipped(false);
    setReceipt(paid);
    if (accountSession && paid.subscription) setSession({ ...accountSession, subscription: paid.subscription });
    go('confirmation');
  }

  if (!subscription) {
    return (
      <div className="shell page-content billing-page">
        {refreshing
          ? <PlanSkeleton label="Loading checkout…" />
          : <section className="card account-unavailable"><h2>Billing isn’t available here</h2><p>Plans and payments apply to buyer and dealer accounts. Staff accounts have no subscription.</p><Link className="button button-secondary" to="/profiles">Back to profile</Link></section>}
      </div>
    );
  }

  const confirmed = step === 'confirmation' && receipt;
  const heading = subscription.isPremium ? 'Renew Premium' : 'Upgrade to Premium';
  return (
    <div className={`shell page-content billing-page ${confirmed ? 'is-confirmed' : ''}`}>
      <header className="billing-head">
        <h1>{confirmed ? 'Thank you' : heading}</h1>
        <Link className="billing-back" to="/account"><ArrowLeft size={16} /> Back to plans</Link>
      </header>
      <div className={`checkout-layout ${confirmed ? 'is-confirmed' : ''}`}>
        <section className="card checkout-main">
          <div className="checkout-progress"><CheckoutStepper current={step} onGo={go} /></div>
          {confirmed
            ? <ReceiptView receipt={receipt} billedTo={details} />
            : <div className="checkout-body" key={step}>
              {step === 'details'
                ? <DetailsStep details={details} onChange={setDetails} onNext={() => go('payment')} isDealer={subscription.role === 'dealer'} focusHeading={moved} />
                : <PaymentStep subscription={subscription} card={card} onCard={setCard} onFlip={setFlipped} onBack={() => go('details')} onPaid={onPaid} />}
            </div>}
        </section>
        {!confirmed && (
          <aside className="checkout-aside" aria-label="Order">
            {step === 'payment' && (
              <div className="checkout-card-preview">
                <PaymentCard brand={detectBrand(digitsOnly(card.number))} kind={card.kind} digits={digitsOnly(card.number)} name={card.name} expiry={card.expiry} cvc={card.cvc} flipped={flipped} />
              </div>
            )}
            <OrderSummary subscription={subscription} billedTo={step === 'payment' ? details : undefined} onEditDetails={() => go('details')} compact={step === 'payment'} />
          </aside>
        )}
      </div>
    </div>
  );
}

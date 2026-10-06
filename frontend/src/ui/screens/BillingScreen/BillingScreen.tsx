import { ArrowLeft } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { smoothScroll } from '@/helpers/motion';
import { client } from '@/services/platform/client';
import { useDemoStore } from '@/services/platform/demoStore';
import { useEffectiveSession } from '@/ui/navigations/previewSession';
import { CheckoutForm } from '@/ui/screens/BillingScreen/CheckoutForm';
import { PlanCard } from '@/ui/screens/BillingScreen/PlanCard';
import { ReceiptView } from '@/ui/screens/BillingScreen/ReceiptView';
import type { PaymentReceipt } from '@/types/domain';

/** Plan on the left, checkout on the right. On a laptop screen the whole page fits without scrolling. */
export default function BillingScreen() {
  const session = useEffectiveSession();
  const accountSession = useDemoStore((state) => state.session);
  const setSession = useDemoStore((state) => state.setSession);
  const navigate = useNavigate();
  const [receipt, setReceipt] = useState<PaymentReceipt | null>(null);

  // The plan changes as quotes or posts are used, so refresh it whenever this page opens.
  useEffect(() => { void client.auth.me().then(setSession).catch(() => undefined); }, [setSession]);

  if (!session) return null;
  const subscription = session.subscription ?? null;

  function onPaid(paid: PaymentReceipt) {
    setReceipt(paid);
    if (accountSession && paid.subscription) setSession({ ...accountSession, subscription: paid.subscription });
  }

  // On narrow screens the form sits below the plan, so the plan's button takes the visitor to it.
  function focusCheckout() {
    setReceipt(null);
    window.requestAnimationFrame(() => {
      const field = document.getElementById('card-number');
      field?.scrollIntoView({ behavior: smoothScroll(), block: 'center' });
      field?.focus({ preventScroll: true });
    });
  }

  return <div className="shell page-content billing-page">
    <header className="billing-head">
      <h1>Plan &amp; billing</h1>
      <Link className="billing-back" to="/profiles"><ArrowLeft size={16} /> Back to profile</Link>
    </header>
    {!subscription
      ? <section className="card billing-unavailable"><h2>Billing isn’t available here</h2><p>Plans and payments apply to buyer and dealer accounts. Staff accounts have no subscription.</p><Link className="button button-secondary" to="/profiles">Back to profile</Link></section>
      : <div className="billing-layout">
        <PlanCard subscription={subscription} onUpgrade={focusCheckout} />
        {receipt
          ? <ReceiptView receipt={receipt} onDashboard={() => navigate('/home')} onStay={() => setReceipt(null)} />
          : <CheckoutForm subscription={subscription} onPaid={onPaid} />}
      </div>}
  </div>;
}

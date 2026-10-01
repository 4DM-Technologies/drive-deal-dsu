import { ArrowRight, Clock3, DollarSign, FileText, MessageCircle, Radio, Sparkles, Trophy } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { PageLoading } from '@/ui/reusables/PageLoading/PageLoading';
import { Link, Navigate } from 'react-router-dom';
import { formatMoney } from '@/helpers/currency';
import { relativeTime } from '@/helpers/dateTime';
import { client } from '@/services/platform/client';
import { useDemoStore } from '@/services/platform/demoStore';
import { SerraLogo } from '@/ui/reusables/SerraLogo/SerraLogo';
import { Reveal } from '@/ui/reusables/Reveal/Reveal';
import { StatusBadge } from '@/ui/reusables/StatusBadge/StatusBadge';
import type { BuyerRequest, Quote } from '@/types/domain';

type Stat = { label: string; value: string | number; note: string; icon: LucideIcon };

function StatGrid({ items }: { items: Stat[] }) {
  return <div className="grid grid-4">{items.map(({ label, value, note, icon: Icon }, index) => <Reveal key={label} delay={index * .05}><article className="card stat-card dashboard-stat"><div className="stat-label">{label}<Icon size={17} /></div><div className="stat-value price">{value}</div><span className="stat-note">{note}</span></article></Reveal>)}</div>;
}

export default function HomeScreen() {
  const session = useDemoStore((state) => state.session);
  const [requests, setRequests] = useState<BuyerRequest[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [loaded, setLoaded] = useState(false);
  const role = session?.role;

  useEffect(() => {
    if (role !== 'buyer' && role !== 'dealer') { setLoaded(true); return; }
    let active = true;
    setLoaded(false);
    const demand = role === 'buyer' ? client.requests.list() : client.feed.list();
    void Promise.all([demand.then(setRequests).catch(() => setRequests([])), client.quotes.list().then(setQuotes).catch(() => setQuotes([]))]).then(() => { if (active) setLoaded(true); });
    return () => { active = false; };
  }, [role]);

  if (!session) return null;
  if (['support', 'support-admin', 'admin'].includes(session.role)) return <Navigate to="/support" replace />;
  if (!loaded) return <PageLoading label={session.role === 'buyer' ? 'Preparing your overview' : 'Preparing your workspace'} />;

  if (session.role === 'buyer') {
    const mine = requests;
    const myQuotes = quotes;
    const accepted = myQuotes.filter((quote) => quote.status === 'accepted');
    const stats: Stat[] = [
      { label: 'Live requests', value: mine.filter((item) => item.status === 'open').length, note: 'Receiving dealer offers', icon: Radio },
      { label: 'Dealer offers', value: myQuotes.length, note: 'Across all requests', icon: MessageCircle },
      { label: 'Open conversations', value: myQuotes.filter((item) => item.contactAvailable || item.chatRequestStatus === 'pending').length, note: 'Quote-linked and private', icon: MessageCircle },
      { label: 'Orders moving', value: accepted.length, note: 'Contact is open', icon: Trophy },
    ];
    return <div className="shell page-content dashboard-page">
      <Reveal><div className="dashboard-welcome"><div><span className="eyebrow">Buyer workspace · Updated now</span><h1>Good afternoon, {session.fullName.split(' ')[0]}.</h1><p>Your requests are working in the background. Here’s what changed and what deserves your attention.</p></div><div className="dashboard-actions"><Link className="button button-secondary" to="/chatbot"><Sparkles size={17} /> Ask Sera</Link><Link className="button button-primary" to="/requests/new"><FileText size={17} /> Start a request</Link></div></div></Reveal>
      <StatGrid items={stats} />
      <div className="grid dashboard-main-grid">
        <Reveal><section className="card card-pad activity-card"><div className="section-head"><div><span className="eyebrow">Live activity</span><h2>Your requests</h2></div><Link to="/requests">View all <ArrowRight size={15} /></Link></div>{mine.slice(0, 4).map((request) => <Link key={request.id} to={`/requests/${request.id}`} className="dashboard-request-row"><span><strong>{request.brand} {request.model}</strong><small>{myQuotes.filter((quote) => quote.requestId === request.id).length} offers · {relativeTime(request.createdAt)}</small></span><StatusBadge status={request.status === 'open' ? 'live' : request.status} /></Link>)}</section></Reveal>
        <Reveal delay={.08}><section className="card serra-spotlight"><div className="serra-orbit"><SerraLogo size={40} title={null} /></div><span className="eyebrow">Ask Sera</span><h2>Compare your dealer offers in one place.</h2><p>Sera can summarize price, equipment, delivery timing, and what each offer leaves unclear—so you can compare with confidence and decide on your own terms.</p><Link className="button" to={`/chatbot?compare=${mine[0]?.id ?? ''}`}>Review with Sera <ArrowRight size={17} /></Link></section></Reveal>
      </div>
    </div>;
  }

  const mine = quotes;
  const liveRequests = requests.filter((request) => request.status === 'open');
  const stats: Stat[] = [
    { label: 'Matched requests', value: liveRequests.length, note: 'Open buyer demand', icon: Radio },
    { label: 'Active quotes', value: mine.filter((item) => ['pending', 'negotiating'].includes(item.status)).length, note: 'Across nearby buyers', icon: FileText },
    { label: 'Deals won', value: mine.filter((item) => item.status === 'accepted').length, note: 'Accepted offers', icon: Trophy },
    { label: 'Open requests', value: liveRequests.length, note: 'Across your market', icon: Clock3 },
  ];
  return <div className="shell page-content dashboard-page">
    <Reveal><div className="dashboard-welcome"><div><span className="eyebrow">Dealer workspace</span><h1>Demand is moving.</h1><p>Respond quickly, keep totals transparent, and follow through on every conversation you open.</p></div><Link className="button button-primary" to="/feed">Browse buyer demand <ArrowRight size={17} /></Link></div></Reveal>
    <StatGrid items={stats} />
    <div className="grid dashboard-main-grid">
      <Reveal><section className="card card-pad activity-card"><div className="section-head"><div><span className="eyebrow">Attention needed</span><h2>Quote performance</h2></div><Link to="/quotes">View all</Link></div>{mine.map((quote) => <Link key={quote.id} to={`/quotes/${quote.id}`} className="dashboard-request-row"><span><strong>Request {quote.requestId.slice(0, 8)}</strong><small>{quote.status === 'pending' ? 'Offer is live' : quote.status}</small></span><strong className="price">{formatMoney(quote.finalPrice)}</strong></Link>)}</section></Reveal>
      <Reveal delay={.08}><section className="card card-pad revenue-card"><span className="eyebrow">Revenue in progress</span><h2>{formatMoney(mine.filter((item) => item.status === 'accepted').reduce((sum, item) => sum + Number(item.finalPrice), 0))}</h2><p>Accepted out-the-door value moving through fulfillment.</p><div><DollarSign size={18} /><strong>Track active deals for fulfillment status</strong></div><Link className="button button-secondary" to="/deals">Track active deals <ArrowRight size={16} /></Link></section></Reveal>
    </div>
    <Reveal><section className="card dashboard-next"><div><span className="eyebrow">Buyer intent nearby</span><h2>{liveRequests.length} matching requests are open.</h2><p>Open the buyer feed to review the latest demand.</p></div><Link className="button button-primary" to="/feed">Review live demand</Link></section></Reveal>
  </div>;
}

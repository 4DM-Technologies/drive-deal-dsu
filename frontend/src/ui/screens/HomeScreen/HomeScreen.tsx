import { ArrowRight, Clock3, DollarSign, FileText, MessageCircle, Radio, Sparkles, Trophy } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { PageLoading } from '@/ui/reusables/PageLoading/PageLoading';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { formatMoney } from '@/helpers/currency';
import { relativeTime } from '@/helpers/dateTime';
import { client } from '@/services/platform/client';
import { SerraLogo } from '@/ui/reusables/SerraLogo/SerraLogo';
import { Reveal } from '@/ui/reusables/Reveal/Reveal';
import { StatusBadge } from '@/ui/reusables/StatusBadge/StatusBadge';
import { TrialBanner } from '@/ui/reusables/TrialBanner/TrialBanner';
import type { BuyerRequest, Quote } from '@/types/domain';
import { previewQuery, useEffectiveSession } from '@/ui/navigations/previewSession';

/** `live` makes the icon beat in red, for a number that is changing in real time. */
type Stat = { label: string; value: string | number; note: string; icon: LucideIcon; live?: boolean };

function StatGrid({ items }: { items: Stat[] }) {
  return <div className="grid grid-4">{items.map(({ label, value, note, icon: Icon, live }, index) => <Reveal key={label} delay={index * .05}><article className="card stat-card dashboard-stat"><div className="stat-label">{label}<Icon size={17} className={live ? 'stat-icon-live' : ''} /></div><div className="stat-value price">{value}</div><span className="stat-note">{note}</span></article></Reveal>)}</div>;
}

export default function HomeScreen() {
  const session = useEffectiveSession();
  const previewSearch = previewQuery(useLocation().search);
  const navigate = useNavigate();
  const [requests, setRequests] = useState<BuyerRequest[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [loaded, setLoaded] = useState(false);
  const role = session?.role;

  useEffect(() => {
    if (role !== 'buyer' && role !== 'dealer') return;
    let active = true;
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
      <Reveal><div className="dashboard-welcome"><div><span className="eyebrow">Buyer workspace · Updated now</span><h1>Good afternoon, {session.fullName.split(' ')[0]}.</h1><p>Your requests are working in the background. Here’s what changed and what deserves your attention.</p></div><div className="dashboard-actions"><Link className="button button-secondary" to={`/chatbot${previewSearch}`}><Sparkles size={17} /> Ask Sera</Link><Link className="button button-primary" to="/requests/new"><FileText size={17} /> Start a request</Link></div></div></Reveal>
      <StatGrid items={stats} />
      <div className="grid dashboard-main-grid">
        <Reveal><section className="card card-pad activity-card"><div className="section-head"><div><span className="eyebrow">Live activity</span><h2>Your requests</h2></div><Link to="/requests">View all <ArrowRight size={15} /></Link></div>{mine.slice(0, 4).map((request) => <Link key={request.id} to={`/requests/${request.id}`} className="dashboard-request-row"><span><strong>{request.brand} {request.model}</strong><small>{myQuotes.filter((quote) => quote.requestId === request.id).length} offers · {relativeTime(request.createdAt)}</small></span><StatusBadge status={request.status === 'open' ? 'live' : request.status} /></Link>)}</section></Reveal>
        <Reveal delay={.08}><section className="card serra-spotlight"><div className="serra-orbit"><SerraLogo size={40} title={null} /></div><span className="eyebrow">Ask Sera</span><h2>Compare your dealer offers in one place.</h2><p>Sera can summarize price, equipment, delivery timing, and what each offer leaves unclear—so you can compare with confidence and decide on your own terms.</p><Link className="button" to={`/chatbot?compare=${mine[0]?.id ?? ''}`}>Review with Sera <ArrowRight size={17} /></Link></section></Reveal>
      </div>
    </div>;
  }

  const mine = quotes;
  const liveRequests = requests.filter((request) => request.status === 'open');
  const recentQuotes = [...mine]
    .sort((a, b) => Number(['pending', 'negotiating'].includes(b.status)) - Number(['pending', 'negotiating'].includes(a.status)) || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 4);
  const acceptedQuotes = mine.filter((item) => item.status === 'accepted');
  const stats: Stat[] = [
    { label: 'Matched requests', value: liveRequests.length, note: 'Open buyer demand', icon: Radio, live: true },
    { label: 'Active quotes', value: mine.filter((item) => ['pending', 'negotiating'].includes(item.status)).length, note: 'Across nearby buyers', icon: FileText },
    { label: 'Open requests', value: liveRequests.length, note: 'Across your market', icon: Clock3 },
    { label: 'Deals won', value: acceptedQuotes.length, note: 'Accepted offers', icon: Trophy },
  ];
  return <div className="shell page-content dashboard-page">
    <TrialBanner subscription={session.subscription ?? null} onUpgrade={() => navigate(`/billing${previewSearch}`)} />
    <Reveal><div className="dashboard-welcome"><div><span className="eyebrow">Dealer workspace</span><h1>Demand is moving.</h1><p>Respond quickly, keep totals transparent, and follow through on every conversation you open.</p></div><Link className="button button-primary" to="/feed">Browse buyer demand <ArrowRight size={17} /></Link></div></Reveal>
    <StatGrid items={stats} />
    <div className="grid dashboard-main-grid dealer-overview-grid">
      <Reveal><section className="card card-pad activity-card dealer-activity-card"><div className="section-head"><div><span className="eyebrow">Needs attention</span><h2>Recent quote activity</h2></div><Link to="/quotes">View all <ArrowRight size={15} /></Link></div>{recentQuotes.map((quote) => { const vehicle = [quote.yearMax ?? quote.yearMin, quote.brand, quote.model].filter(Boolean).join(' ') || 'Vehicle request'; const status = quote.status === 'pending' ? 'Offer is live' : quote.status === 'negotiating' ? 'Buyer is negotiating' : quote.status === 'accepted' ? 'Offer accepted' : prettyStatus(quote.status); return <Link key={quote.id} to={`/quotes/${quote.id}`} className="dashboard-request-row"><span><strong>{vehicle}</strong><small>{quote.buyerArea || 'Local buyer'} · {status}</small></span><strong className="price">{formatMoney(quote.finalPrice)}</strong></Link>; })}{recentQuotes.length === 0 && <p className="compact-empty">No quotes need attention right now.</p>}</section></Reveal>
      <Reveal delay={.08}><section className="card card-pad revenue-card dealer-deal-summary"><span className="eyebrow">Accepted deals</span><div className="deal-summary-head"><span><strong>{acceptedQuotes.length}</strong><small>Active fulfillments</small></span><h2>{formatMoney(acceptedQuotes.reduce((sum, item) => sum + Number(item.finalPrice), 0))}</h2></div><p>Accepted out-the-door value currently moving through your pipeline.</p><Link className="button button-secondary" to="/deals"><DollarSign size={16} /> Review deals <ArrowRight size={16} /></Link></section></Reveal>
    </div>
    <Reveal><section className="card dashboard-next"><div><span className="eyebrow">Buyer intent nearby</span><h2>{liveRequests.length} matching requests are open.</h2><p>Open the buyer feed to review the latest demand.</p></div><Link className="button button-primary" to="/feed">Review live demand</Link></section></Reveal>
  </div>;
}

function prettyStatus(status: string) {
  return status.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

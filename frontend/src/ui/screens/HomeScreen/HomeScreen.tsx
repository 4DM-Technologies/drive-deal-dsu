import { ArrowRight, CarFront, Clock3, DollarSign, FileText, MessageCircle, Radio, Sparkles, TrendingDown, Trophy } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Link, Navigate } from 'react-router-dom';
import { formatMoney } from '@/helpers/currency';
import { relativeTime } from '@/helpers/dateTime';
import { useDemoStore } from '@/services/platform/demoStore';
import { Reveal } from '@/ui/reusables/Reveal/Reveal';
import { StatusBadge } from '@/ui/reusables/StatusBadge/StatusBadge';

type Stat = { label: string; value: string | number; note: string; icon: LucideIcon };

function StatGrid({ items }: { items: Stat[] }) {
  return <div className="grid grid-4">{items.map(({ label, value, note, icon: Icon }, index) => <Reveal key={label} delay={index * .05}><article className="card stat-card dashboard-stat"><div className="stat-label">{label}<Icon size={17} /></div><div className="stat-value price">{value}</div><span className="stat-note">{note}</span></article></Reveal>)}</div>;
}

export default function HomeScreen() {
  const session = useDemoStore((state) => state.session);
  const requests = useDemoStore((state) => state.requests);
  const quotes = useDemoStore((state) => state.quotes);
  if (!session) return null;
  if (session.role === 'support' || session.role === 'admin') return <Navigate to="/support" replace />;

  if (session.role === 'buyer') {
    const mine = requests.filter((request) => request.buyerId === session.id);
    const myQuotes = quotes.filter((quote) => mine.some((request) => request.id === quote.requestId));
    const accepted = myQuotes.filter((quote) => quote.status === 'accepted');
    const lowest = [...myQuotes].sort((a, b) => Number(a.finalPrice) - Number(b.finalPrice))[0];
    const stats: Stat[] = [
      { label: 'Live requests', value: mine.filter((item) => item.status === 'open').length, note: 'Receiving dealer offers', icon: Radio },
      { label: 'Dealer offers', value: myQuotes.length, note: 'Across all requests', icon: MessageCircle },
      { label: 'Best current OTD', value: lowest ? formatMoney(lowest.finalPrice) : '—', note: 'Itemized total', icon: TrendingDown },
      { label: 'Orders moving', value: accepted.length, note: 'Contact is open', icon: Trophy },
    ];
    return <div className="shell page-content dashboard-page">
      <Reveal><div className="dashboard-welcome"><div><span className="eyebrow">Buyer workspace · Updated now</span><h1>Good afternoon, {session.fullName.split(' ')[0]}.</h1><p>Your requests are working in the background. Here’s what changed and what deserves your attention.</p></div><div className="dashboard-actions"><Link className="button button-secondary" to="/chatbot"><Sparkles size={17} /> Ask Serra</Link><Link className="button button-primary" to="/requests/new"><FileText size={17} /> Start a request</Link></div></div></Reveal>
      <StatGrid items={stats} />
      <div className="grid dashboard-main-grid">
        <Reveal><section className="card card-pad activity-card"><div className="section-head"><div><span className="eyebrow">Live activity</span><h2>Your requests</h2></div><Link to="/requests">View all <ArrowRight size={15} /></Link></div>{mine.slice(0, 4).map((request) => <Link key={request.id} to={`/requests/${request.id}`} className="dashboard-request-row"><span className="request-row-icon"><CarFront size={20} /></span><span><strong>{request.brand} {request.model}</strong><small>{request.quoteCount} offers · {relativeTime(request.createdAt)}</small></span><StatusBadge status={request.status === 'open' ? 'live' : request.status} /></Link>)}</section></Reveal>
        <Reveal delay={.08}><section className="card serra-spotlight"><div className="serra-orbit"><Sparkles /></div><span className="eyebrow">Serra found a decision point</span><h2>Your Bronco request has enough signal to compare.</h2><p>Three dealers responded. I can summarize price, equipment, delivery timing, and what each offer leaves unclear.</p><Link className="button" to={`/chatbot?compare=${mine[0]?.id ?? ''}`}>Review with Serra <ArrowRight size={17} /></Link></section></Reveal>
      </div>
      <Reveal><section className="card dashboard-next"><div><span className="eyebrow">Next best action</span><h2>One conversation is waiting for you.</h2><p>Navee Motors replied to your BMW negotiation 39 minutes ago.</p></div><Link className="button button-secondary" to="/chat/quote-bmw"><MessageCircle size={17} /> Open conversation</Link></section></Reveal>
    </div>;
  }

  const mine = quotes.filter((quote) => quote.dealerId === session.id);
  const liveRequests = requests.filter((request) => request.status === 'open');
  const stats: Stat[] = [
    { label: 'Matched requests', value: liveRequests.length, note: '+4 since yesterday', icon: Radio },
    { label: 'Active quotes', value: mine.filter((item) => ['pending', 'negotiating'].includes(item.status)).length, note: 'Across nearby buyers', icon: FileText },
    { label: 'Deals won', value: mine.filter((item) => item.status === 'accepted').length, note: '14.2% win rate', icon: Trophy },
    { label: 'Median response', value: '12m', note: 'Top 10% locally', icon: Clock3 },
  ];
  return <div className="shell page-content dashboard-page">
    <Reveal><div className="dashboard-welcome"><div><span className="eyebrow">Navee Motors · Dealer workspace</span><h1>Demand is moving.</h1><p>Respond quickly, keep totals transparent, and follow through on every conversation you open.</p></div><Link className="button button-primary" to="/feed">Browse buyer demand <ArrowRight size={17} /></Link></div></Reveal>
    <StatGrid items={stats} />
    <div className="grid dashboard-main-grid">
      <Reveal><section className="card card-pad activity-card"><div className="section-head"><div><span className="eyebrow">Attention needed</span><h2>Quote performance</h2></div><Link to="/quotes">View all</Link></div>{mine.map((quote) => { const request = requests.find((item) => item.id === quote.requestId); return <Link key={quote.id} to={`/quotes/${quote.id}`} className="dashboard-request-row"><span className="request-row-icon"><CarFront size={20} /></span><span><strong>{request?.brand} {request?.model}</strong><small>{request?.area} · {quote.status === 'pending' ? 'Offer is live' : quote.status}</small></span><strong className="price">{formatMoney(quote.finalPrice)}</strong></Link>; })}</section></Reveal>
      <Reveal delay={.08}><section className="card card-pad revenue-card"><span className="eyebrow">Revenue in progress</span><h2>{formatMoney(mine.filter((item) => item.status === 'accepted').reduce((sum, item) => sum + Number(item.finalPrice), 0))}</h2><p>Accepted out-the-door value moving through fulfillment.</p><div><DollarSign size={18} /><strong>One buyer reached funds-arrived status</strong></div><Link className="button button-secondary" to="/deals">Track active deals <ArrowRight size={16} /></Link></section></Reveal>
    </div>
    <Reveal><section className="card dashboard-next"><div><span className="eyebrow">Buyer intent nearby</span><h2>{liveRequests.length} matching requests are open.</h2><p>Highest fit: Ford Bronco, approximately 12 miles away.</p></div><Link className="button button-primary" to="/feed">Review live demand</Link></section></Reveal>
  </div>;
}

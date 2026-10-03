import { ArrowRight, Check, Clock3, MapPin, MessageCircle, Plus, Search, SlidersHorizontal } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { formatMoney } from '@/helpers/currency';
import { client } from '@/services/platform/client';
import { useDemoStore } from '@/services/platform/demoStore';
import { Dropdown } from '@/ui/reusables/Dropdown/Dropdown';
import { PageLoading } from '@/ui/reusables/PageLoading/PageLoading';
import { EmptyState } from '@/ui/reusables/EmptyState/EmptyState';
import { StatusBadge } from '@/ui/reusables/StatusBadge/StatusBadge';
import type { BuyerRequest, Quote } from '@/types/domain';

const friendlyTimeline = { ASAP: 'Ready to decide', 'Within 1 week': 'Deciding this week', 'Within 2 weeks': 'Deciding in 2–4 weeks', 'Just exploring': 'Researching options' } as const;

export default function DealerListScreen() {
  const path = useLocation().pathname;
  const session = useDemoStore((state) => state.session);
  const [feed, setFeed] = useState<BuyerRequest[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [search, setSearch] = useState('');
  const [distance, setDistance] = useState('50');
  const [loadedPath, setLoadedPath] = useState('');
  const dealsOnly = path === '/deals' || path === '/orders';
  const loaded = loadedPath === path;

  useEffect(() => {
    if (path === '/feed') { void client.feed.list().then(setFeed).catch(() => setFeed([])).finally(() => setLoadedPath(path)); return; }
    const loadQuotes = dealsOnly ? client.deals.list() : client.quotes.list();
    void loadQuotes.then(setQuotes).catch(() => setQuotes([])).finally(() => setLoadedPath(path));
  }, [path, dealsOnly]);

  if (!loaded) {
    if (path === '/feed') return <PageLoading label="Finding buyer demand" />;
    if (path === '/orders') return <PageLoading label="Loading your orders" />;
    if (path === '/deals') return <PageLoading label="Loading your deals" />;
    return <PageLoading label="Loading your quotes" />;
  }
  if (path === '/feed') {
    const filtered = feed
      .filter((request) => request.radiusMiles <= Number(distance) || Number(distance) === 250)
      .filter((request) => `${request.brand} ${request.model} ${request.area}`.toLowerCase().includes(search.toLowerCase()));
    const liveCount = filtered.filter((request) => !request.alreadyQuoted).length;
    return <div className="shell page-content"><div className="page-heading"><div><span className="eyebrow">Verified buyer demand</span><h1>Quote the requests you can win.</h1><p>Buyer identity stays private. Match on vehicle fit, approximate distance, timing, and your ability to deliver.</p></div><span className="live-ops"><i /> {liveCount} live matches</span></div><div className="card card-pad list-toolbar"><label className="search-field"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search brand, model, or area" /></label><div className="select-inline"><SlidersHorizontal size={16} /><Dropdown ariaLabel="Maximum distance" value={distance} onChange={setDistance} options={[{ value: '25', label: 'Within 25 miles' }, { value: '50', label: 'Within 50 miles' }, { value: '100', label: 'Within 100 miles' }, { value: '250', label: 'All matched areas' }]} /></div></div><div className="grid grid-3 dealer-feed">{filtered.map((request) => <article className="card card-hover demand-card" key={request.id}><div className="demand-card-accent"><strong>{request.brand} {request.model}</strong>{request.alreadyQuoted ? <StatusBadge status="quoted" /> : <StatusBadge status="live" />}</div><div className="card-pad"><span className="eyebrow">{friendlyTimeline[request.timeline]}</span><h3>{request.brand} {request.model}</h3><div className="demand-meta"><span><MapPin size={14} /> {request.area}</span><span><Clock3 size={14} /> {new Date(request.createdAt).toLocaleDateString('en-US')}</span></div><div className="request-tags">{request.mustHaves.slice(0, 3).map((item) => <span className="status status-draft" key={item}>{item}</span>)}</div>{request.alreadyQuoted ? <span className="button button-secondary button-wide" aria-disabled><Check size={16} /> Quote already sent</span> : <Link className="button button-primary button-wide" to={`/feed/${request.id}`}>Review brief &amp; quote <ArrowRight size={16} /></Link>}</div></article>)}</div>{filtered.length === 0 && <div className="card"><EmptyState title="No matches found" description="Expand your distance or clear the search." /></div>}</div>;
  }

  const mine = quotes;
  return <div className="shell page-content"><div className="page-heading"><div><span className="eyebrow">{dealsOnly ? session?.role === 'buyer' ? 'Your orders' : 'Won business' : 'Dealer quotes'}</span><h1>{dealsOnly ? session?.role === 'buyer' ? 'Orders moving forward' : 'Deals in progress' : 'Your active offers'}</h1><p>{dealsOnly ? 'Track the accepted quote through paperwork, funding, dispatch, and delivery.' : 'Monitor your position, expiry, and open conversations from one place.'}</p></div>{!dealsOnly && <Link className="button button-primary" to="/feed"><Plus size={17} /> Find buyer demand</Link>}</div><section className="card"><div className="table-wrap"><table className="data-table"><thead><tr><th>Vehicle request</th><th>{session?.role === 'buyer' ? 'Dealer' : 'Buyer area'}</th><th>Out-the-door</th><th>Status</th><th>Conversation</th><th /></tr></thead><tbody>{mine.map((quote) => <tr key={quote.id}><td><strong>{quote.brand ? `${quote.brand} ${quote.model}` : 'Vehicle request'}</strong><small>{quote.brand ? `${quote.yearMin}–${quote.yearMax} · ${quote.bodyType}` : ''}</small></td><td>{session?.role === 'buyer' ? quote.dealerName : <span><MapPin size={13} /> {quote.buyerArea ?? 'Buyer area'}</span>}</td><td><strong className="price">{formatMoney(quote.finalPrice)}</strong></td><td><StatusBadge status={dealsOnly ? quote.dealStatus ?? quote.status : quote.status} /></td><td>{quote.contactAvailable ? <Link to={`/chat/${quote.id}`} className="button button-secondary button-sm"><MessageCircle size={15} /> Open chat</Link> : quote.chatRequestStatus === 'pending' ? <Link to="/chat/requests" className="button button-secondary button-sm"><Clock3 size={15} /> Buyer waiting</Link> : <span className="muted">Not opened</span>}</td><td><Link className="button button-ghost button-sm" to={dealsOnly ? `/${session?.role === 'buyer' ? 'orders' : 'deals'}/${quote.id}` : `/quotes/${quote.id}`}>View <ArrowRight size={15} /></Link></td></tr>)}</tbody></table></div>{mine.length === 0 && <EmptyState title={dealsOnly ? 'No accepted deals yet' : 'No quotes yet'} description={dealsOnly ? 'Accepted offers will appear here for fulfillment tracking.' : 'Open the buyer feed to send your first quote.'} />}</section></div>;
}

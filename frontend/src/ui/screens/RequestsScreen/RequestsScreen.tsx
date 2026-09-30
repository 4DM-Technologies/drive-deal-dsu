import { ArrowRight, FilePlus2, MapPin, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useDemoStore } from '@/services/platform/demoStore';
import { EmptyState } from '@/ui/reusables/EmptyState/EmptyState';
import { StatusBadge } from '@/ui/reusables/StatusBadge/StatusBadge';

export default function RequestsScreen() {
  const session = useDemoStore((state) => state.session);
  const requests = useDemoStore((state) => state.requests);
  const quotes = useDemoStore((state) => state.quotes);
  const [filter, setFilter] = useState<'all' | 'open' | 'fulfilled'>('all');
  const [search, setSearch] = useState('');
  const items = useMemo(() => requests.filter((request) => request.buyerId === session?.id).filter((request) => filter === 'all' || request.status === filter).filter((request) => `${request.brand} ${request.model}`.toLowerCase().includes(search.toLowerCase())), [filter, requests, search, session?.id]);
  return <div className="shell page-content"><div className="page-heading"><div><span className="eyebrow">Your private briefs</span><h1>Vehicle requests</h1><p>Track dealer interest, compare itemized offers, and decide when to open contact.</p></div><Link className="button button-primary" to="/requests/new"><FilePlus2 size={17} /> Start a request</Link></div>
    <div className="card card-pad list-toolbar"><label className="search-field"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search brand or model" /></label><div className="filter-pills">{(['all', 'open', 'fulfilled'] as const).map((value) => <button key={value} className={`filter-pill ${filter === value ? 'active' : ''}`} onClick={() => setFilter(value)}>{value === 'all' ? 'All briefs' : value === 'open' ? 'Receiving offers' : 'Converted to order'}</button>)}</div></div>
    {items.length === 0 ? <div className="card"><EmptyState title="No requests match" description="Try another filter or create a new buyer request." action={<Link className="button button-primary" to="/requests/new">Start a request</Link>} /></div> : <div className="grid grid-2">{items.map((request) => {
      const requestQuotes = quotes.filter((quote) => quote.requestId === request.id);
      return <Link className="card request-card request-card-spec card-hover" key={request.id} to={`/requests/${request.id}`}><div className="request-card-body"><div className="request-card-top"><div><span className="eyebrow">Private buying brief</span><h3>{request.brand} {request.model}</h3><div className="request-meta"><span><MapPin size={13} /> {request.area}</span><span>{request.yearMin}–{request.yearMax}</span><span>{request.bodyType || 'Any body style'}</span></div></div><StatusBadge status={request.status === 'open' ? 'live' : request.status} /></div><div className="request-tags">{request.mustHaves.slice(0, 4).map((item) => <span key={item} className="status status-draft">{item}</span>)}</div><div className="request-footer"><span><strong>{requestQuotes.length} dealer {requestQuotes.length === 1 ? 'offer' : 'offers'}</strong><small className="muted">{requestQuotes.length ? 'Open to compare every itemized quote' : 'Waiting for the first quote'}</small></span><ArrowRight size={18} /></div></div></Link>;
    })}</div>}
  </div>;
}

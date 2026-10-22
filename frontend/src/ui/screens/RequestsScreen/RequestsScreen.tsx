import { ArrowRight, BellRing, CalendarDays, CircleAlert, Eye, FilePlus2, History, MapPin, MessageSquareQuote, RotateCw, Search, TrendingDown, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { formatMoney } from '@/helpers/currency';
import { formatLongDate } from '@/helpers/dateTime';
import { client } from '@/services/platform/client';
import { PageLoading } from '@/ui/reusables/PageLoading/PageLoading';
import { EmptyState } from '@/ui/reusables/EmptyState/EmptyState';
import { StatusBadge } from '@/ui/reusables/StatusBadge/StatusBadge';
import type { BuyerRequest, Quote } from '@/types/domain';

type RequestFilter = 'all' | 'open' | 'fulfilled';
const REQUEST_FILTERS: readonly RequestFilter[] = ['all', 'open', 'fulfilled'];

interface RevisionNotice { direction: 'down' | 'up' | 'same'; title: string; detail: string }

/** The most recent price revision among a request's live offers, worded for the buyer. */
function revisionNotice(offers: Quote[]): RevisionNotice | null {
  const revised = offers
    .filter((offer) => ['pending', 'negotiating'].includes(offer.status))
    .flatMap((offer) => { const last = offer.revisions?.at(-1); return last ? [{ offer, last }] : []; })
    .sort((a, b) => new Date(b.last.at).getTime() - new Date(a.last.at).getTime());
  const latest = revised[0];
  if (!latest) return null;
  const before = latest.last.amount === '' ? Number.NaN : Number(latest.last.amount);
  const now = Number(latest.offer.finalPrice);
  const dealer = latest.offer.dealerName;
  const more = revised.length - 1;
  const alsoRevised = more > 0 ? ` · ${more} more ${more === 1 ? 'dealer' : 'dealers'} also revised` : '';
  if (!Number.isFinite(before) || before === now) return { direction: 'same', title: `${dealer} revised their offer`, detail: `Now ${formatMoney(now)}${alsoRevised}` };
  const change = formatMoney(Math.abs(before - now));
  return now < before
    ? { direction: 'down', title: `${dealer} lowered their price`, detail: `Now ${formatMoney(now)}, down ${change} from ${formatMoney(before)}${alsoRevised}` }
    : { direction: 'up', title: `${dealer} revised their price`, detail: `Now ${formatMoney(now)}, up ${change} from ${formatMoney(before)}${alsoRevised}` };
}

export default function RequestsScreen() {
  const [requests, setRequests] = useState<BuyerRequest[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  // The filter lives in the URL (`?status=open`, `?offers=1`) so the overview cards can open this page pre-filtered.
  const [searchParams, setSearchParams] = useSearchParams();
  const statusParam = searchParams.get('status') as RequestFilter | null;
  const filter: RequestFilter = statusParam && REQUEST_FILTERS.includes(statusParam) ? statusParam : 'all';
  const withOffersOnly = searchParams.get('offers') === '1';
  const updateParams = (change: (params: URLSearchParams) => void) => setSearchParams((params) => { change(params); return params; }, { replace: true });
  const setFilter = (value: RequestFilter) => updateParams((params) => { if (value === 'all') params.delete('status'); else params.set('status', value); });
  const clearOffersOnly = () => updateParams((params) => params.delete('offers'));
  const [search, setSearch] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<{ id: string; message: string } | null>(null);

  useEffect(() => {
    void Promise.all([client.requests.list().then(setRequests).catch(() => setRequests([])), client.quotes.list().then(setQuotes).catch(() => setQuotes([]))]).then(() => setLoaded(true));
  }, []);

  /** Reminds dealers about an unquoted brief, or reopens one that closed for getting no quotes. */
  const sendBackToDealers = (request: BuyerRequest, action: 'notify' | 'repush') => {
    setBusyId(request.id); setActionError(null);
    const call = action === 'notify' ? client.requests.notifyDealers(request.id) : client.requests.repush(request.id);
    void call
      .then((updated) => setRequests((rows) => rows.map((row) => (row.id === updated.id ? updated : row))))
      .catch((error: unknown) => setActionError({ id: request.id, message: error instanceof Error ? error.message : 'Something went wrong. Please try again.' }))
      .finally(() => setBusyId(null));
  };

  const offerCount = (request: BuyerRequest) => request.quoteCount || quotes.filter((quote) => quote.requestId === request.id).length;
  const items = requests
    .filter((request) => filter === 'all' || request.status === filter)
    .filter((request) => !withOffersOnly || offerCount(request) > 0)
    .filter((request) => `${request.brand} ${request.model}`.toLowerCase().includes(search.toLowerCase()));
  if (!loaded) return <PageLoading label="Loading your requests" />;
  return <div className="shell page-content requests-page"><div className="page-heading"><div><span className="eyebrow">Your private briefs</span><h1>Vehicle requests</h1><p>Track dealer interest, compare itemized offers, and decide when to open contact.</p></div><Link className="button button-primary" to="/requests/new"><FilePlus2 size={17} /> Start a request</Link></div>
    <div className="card card-pad list-toolbar requests-toolbar"><label className="search-field"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search brand or model" /></label><div className="filter-pills">{(['all', 'open', 'fulfilled'] as const).map((value) => <button key={value} type="button" className={`filter-pill ${filter === value ? 'active' : ''}`} aria-pressed={filter === value} onClick={() => setFilter(value)}>{value === 'all' ? 'All briefs' : value === 'open' ? 'Receiving offers' : 'Converted to order'}</button>)}</div></div>
    {withOffersOnly && <div className="active-filter"><span>Showing requests with dealer offers</span><button type="button" onClick={clearOffersOnly} aria-label="Show requests with or without offers"><X size={13} /></button></div>}
    {items.length === 0 ? <div className="card">{withOffersOnly && filter === 'all' && !search ? <EmptyState title="No dealer offers yet" description="Offers appear here as soon as a dealer quotes on one of your requests." action={<button type="button" className="button button-secondary" onClick={clearOffersOnly}>Show all requests</button>} /> : <EmptyState title="No requests match" description="Try another filter or create a new buyer request." action={<Link className="button button-primary" to="/requests/new">Start a request</Link>} />}</div> : <div className="grid grid-2 request-card-grid">{items.map((request) => {
      const liveQuoteCount = offerCount(request); const notice = revisionNotice(quotes.filter((quote) => quote.requestId === request.id));
      const closedUnquoted = request.canRepush;
      const repushed = request.status === 'open' && request.repushedAt != null;
      const reminded = request.status === 'open' && !liveQuoteCount && request.dealersNotifiedAt != null;
      const busy = busyId === request.id;
      const footer = closedUnquoted
        ? { title: 'Request closed', detail: 'Repush it to send your brief to dealers again' }
        : request.canNotifyDealers
          ? { title: 'No quotes in 2 weeks', detail: 'Remind dealers your brief is still open' }
          : reminded
            ? { title: 'Dealers have been reminded', detail: `We sent your brief back to dealers on ${formatLongDate(request.dealersNotifiedAt!)}` }
            : { title: liveQuoteCount ? 'Dealer interest is active' : request.viewCount ? 'Dealers are reviewing your brief' : 'Your brief is live', detail: liveQuoteCount ? 'Open to compare every itemized quote' : 'We’ll notify you when a dealer responds' };
      return <article className={`card request-card request-card-spec card-hover${closedUnquoted ? ' is-closed' : ''}`} key={request.id}><div className="request-card-body">
        {notice && <div className={`request-revised ${notice.direction}`}>{notice.direction === 'down' ? <TrendingDown size={17} /> : <History size={17} />}<span><strong>{notice.title}</strong><small>{notice.detail}</small></span></div>}
        {closedUnquoted && <div className="request-alert closed" role="status"><CircleAlert size={17} /><span><strong>Closed, no quotes in 30 days</strong><small>No dealer quoted on this brief within a month, so we closed it. Repush it to reopen it for dealers.</small></span></div>}
        {repushed && <div className="request-alert repushed"><RotateCw size={17} /><span><strong>This request was repushed</strong><small>Back in front of dealers since {formatLongDate(request.repushedAt!)}</small></span></div>}
        <div className="request-card-top"><div><div className="request-card-eyebrow"><span className="eyebrow">Private buying brief</span><span className="request-posted"><CalendarDays size={13} /> Posted {formatLongDate(request.createdAt)}</span></div><h3><Link className="request-card-link" to={`/requests/${request.id}`}>{request.brand} {request.model}</Link></h3><div className="request-meta"><span><MapPin size={13} /> {request.area}</span><span>{request.yearMin}–{request.yearMax}</span><span>{request.bodyType || 'Any body style'}</span></div></div><StatusBadge status={request.status === 'open' ? 'live' : request.status === 'expired' ? 'closed' : request.status} /></div>
        {request.mustHaves.length > 0 && <div className="request-tags">{request.mustHaves.slice(0, 4).map((item) => <span key={item} className="status status-draft">{item}</span>)}</div>}
        <div className="request-interest" aria-label="Dealer activity"><span><Eye size={16} /><strong>{request.viewCount}</strong><small>dealers viewed</small></span><span><MessageSquareQuote size={16} /><strong>{liveQuoteCount}</strong><small>quotes received</small></span></div>
        <div className="request-footer"><span className="request-footer-copy"><strong>{footer.title}</strong><small>{footer.detail}</small></span>{closedUnquoted
          ? <button type="button" className="button button-primary button-sm request-card-action" disabled={busy} onClick={() => sendBackToDealers(request, 'repush')}><RotateCw size={15} /> {busy ? 'Repushing…' : 'Repush'}</button>
          : request.canNotifyDealers
            ? <button type="button" className="button button-primary button-sm request-card-action" disabled={busy} onClick={() => sendBackToDealers(request, 'notify')}><BellRing size={15} /> {busy ? 'Notifying…' : 'Notify dealers'}</button>
            : <span className="request-footer-action">View request <ArrowRight size={16} /></span>}</div>
        {actionError?.id === request.id && <p className="request-card-error" role="alert">{actionError.message}</p>}
      </div></article>;
    })}</div>}
  </div>;
}

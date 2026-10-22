import { ArrowRight, BellRing, Clock3, FileSpreadsheet, MapPin, MessageCircle, RotateCw, Search, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { formatMoney } from '@/helpers/currency';
import { formatLongDate } from '@/helpers/dateTime';
import { ACTIVE_QUOTE_STATUSES } from '@/helpers/quoteStatus';
import { DEFAULT_FEED_FILTERS, FRIENDLY_TIMELINE, activeFilterCount, filterFeed, type FeedFilters } from '@/helpers/feedFilters';
import { client } from '@/services/platform/client';
import { useDemoStore } from '@/services/platform/demoStore';
import { PageLoading } from '@/ui/reusables/PageLoading/PageLoading';
import { EmptyState } from '@/ui/reusables/EmptyState/EmptyState';
import { BuyerViewBadge } from '@/ui/reusables/BuyerViewBadge/BuyerViewBadge';
import { StatusBadge } from '@/ui/reusables/StatusBadge/StatusBadge';
import { FeedFilterBar } from './FeedFilterBar';
import type { BuyerRequest, Quote } from '@/types/domain';

/** Tells a dealer that the buyer sent this brief back to them: a reminder after two quiet weeks, or a repush after it closed unquoted. */
function BuyerPushNotice({ request }: { request: BuyerRequest }) {
  // A reminder is cleared by a repush, so when one is set it is the most recent push.
  if (request.dealersNotifiedAt) return <div className="request-alert"><BellRing size={17} /><span><strong>Buyer is still waiting for a quote</strong><small>They sent this brief back to dealers on {formatLongDate(request.dealersNotifiedAt)}</small></span></div>;
  if (request.repushedAt) return <div className="request-alert"><RotateCw size={17} /><span><strong>Buyer repushed this request</strong><small>Back on the market since {formatLongDate(request.repushedAt)} after getting no quotes</small></span></div>;
  return null;
}

export default function DealerListScreen() {
  const path = useLocation().pathname;
  const navigate = useNavigate();
  const session = useDemoStore((state) => state.session);
  const [feed, setFeed] = useState<BuyerRequest[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [filters, setFilters] = useState<FeedFilters>(DEFAULT_FEED_FILTERS);
  const [quoteSearch, setQuoteSearch] = useState('');
  const [loadedPath, setLoadedPath] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const [searchParams, setSearchParams] = useSearchParams();
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
    // The feed is for requests still open to this dealer; once a quote is sent it lives under Quotes.
    const open = feed.filter((request) => !request.alreadyQuoted);
    const filtered = filterFeed(open, filters);
    const liveCount = filtered.length;
    return <div className="shell page-content"><div className="page-heading"><div><span className="eyebrow">Verified buyer demand</span><h1>Quote the requests you can win.</h1><p>Buyer identity stays private. Match on vehicle fit, approximate distance, timing, and your ability to deliver.</p></div><span className="live-ops"><i /> {liveCount} live matches</span></div><FeedFilterBar requests={open} filters={filters} onChange={setFilters} /><div className="grid grid-3 dealer-feed">{filtered.map((request) => <Link className="card card-hover demand-card" key={request.id} to={`/feed/${request.id}`} aria-label={`Review brief and quote for ${request.brand} ${request.model}`}><div className="demand-card-accent"><strong>{request.brand} {request.model}</strong><StatusBadge status="live" /></div><div className="card-pad"><BuyerPushNotice request={request} /><span className="eyebrow">{FRIENDLY_TIMELINE[request.timeline]}</span><h3>{request.brand} {request.model}</h3><div className="demand-meta"><span><MapPin size={14} /> {request.area}</span><span><Clock3 size={14} /> {new Date(request.createdAt).toLocaleDateString('en-US')}</span></div><div className="request-tags">{request.mustHaves.slice(0, 3).map((item) => <span className="status status-draft" key={item}>{item}</span>)}</div><div className="request-footer"><span className="request-footer-action">Review brief &amp; quote <ArrowRight size={16} /></span></div></div></Link>)}</div>{filtered.length === 0 && <div className="card"><EmptyState title="No matches found" description={open.length === 0 ? 'No open buyer requests right now. New ones appear here as buyers post them.' : 'Nothing fits the current filters. Try a wider distance or fewer filters.'} action={activeFilterCount(filters) > 0 ? <div className="empty-action"><button type="button" className="button button-secondary" onClick={() => setFilters({ ...DEFAULT_FEED_FILTERS })}>Reset filters</button></div> : undefined} /></div>}</div>;
  }

  // Every word typed has to match somewhere in the row, so "audi pending" narrows to pending Audi quotes.
  // The dealer's Quotes page: adds the buyer's first name and drops the View column (the vehicle name and the row open the quote).
  const showBuyerView = !dealsOnly && session?.role !== 'buyer';
  const dealerQuotes = showBuyerView;
  const terms = quoteSearch.trim().toLowerCase().split(/\s+/).filter(Boolean);
  // `?status=active` (the dashboard's "Active quotes" card) narrows the list to offers still in play.
  const activeOnly = !dealsOnly && searchParams.get('status') === 'active';
  const inScope = activeOnly ? quotes.filter((quote) => ACTIVE_QUOTE_STATUSES.includes(quote.status)) : quotes;
  const clearActiveOnly = () => setSearchParams((params) => { params.delete('status'); return params; }, { replace: true });
  const mine = dealsOnly || terms.length === 0 ? inScope : inScope.filter((quote) => {
    const haystack = [quote.brand, quote.model, quote.buyerFirstName, quote.yearMin, quote.yearMax, quote.bodyType, quote.buyerArea, quote.status, quote.finalPrice, formatMoney(quote.finalPrice)].filter(Boolean).join(' ').toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
  const dealerDeals = dealsOnly && session?.role !== 'buyer';
  // The server builds the workbook from the database, so the file never depends on what this page shows.
  const exportDeals = () => {
    setExporting(true); setExportError('');
    void client.deals.export()
      .catch((error: unknown) => setExportError(error instanceof Error ? error.message : 'The export could not be created. Please try again.'))
      .finally(() => setExporting(false));
  };
  return <div className="shell page-content"><div className="page-heading"><div><span className="eyebrow">{dealsOnly ? session?.role === 'buyer' ? 'Your orders' : 'Won business' : 'Dealer quotes'}</span><h1>{dealsOnly ? session?.role === 'buyer' ? 'Orders moving forward' : 'Deals in progress' : 'Your active offers'}</h1><p>{dealsOnly ? 'Track the accepted quote through paperwork, funding, dispatch, and delivery.' : 'Monitor your position, expiry, and open conversations from one place.'}</p></div>{!dealsOnly && <label className="search-field quotes-search"><Search size={17} /><input type="search" value={quoteSearch} onChange={(event) => setQuoteSearch(event.target.value)} placeholder="Search vehicle, area, status or price" aria-label="Search your quotes" /></label>}{dealerDeals && <button type="button" className="button button-secondary" onClick={exportDeals} disabled={mine.length === 0 || exporting}><FileSpreadsheet size={17} /> {exporting ? 'Exporting…' : 'Export to Excel'}</button>}</div>{exportError && <p className="field-error" role="alert">{exportError}</p>}{activeOnly && <div className="active-filter"><span>Showing active quotes · pending or negotiating</span><button type="button" onClick={clearActiveOnly} aria-label="Show all quotes"><X size={13} /></button></div>}<section className="card"><div className="table-wrap"><table className={`data-table${dealerQuotes ? ' dealer-quotes-table' : ''}`}><thead><tr><th>Vehicle request</th>{dealerQuotes && <th>Buyer</th>}<th>{session?.role === 'buyer' ? 'Dealer' : 'Buyer area'}</th><th>Out-the-door</th>{!dealsOnly && <th>Status</th>}{showBuyerView && <th>Buyer view</th>}<th>Conversation</th>{!dealerQuotes && <th />}</tr></thead><tbody>{mine.map((quote) => {
            const viewHref = dealsOnly ? `/${session?.role === 'buyer' ? 'orders' : 'deals'}/${quote.id}` : `/quotes/${quote.id}`;
            // The row itself is a mouse convenience on top of a real link (the vehicle name on the Quotes page, "View"
            // elsewhere), which stays the keyboard/screen-reader way in - a click on an inner link or button keeps its own destination.
            const goToRow = (event: ReactMouseEvent<HTMLTableRowElement>) => {
              if ((event.target as HTMLElement).closest('a, button')) return;
              navigate(viewHref);
            };
            const vehicle = quote.brand ? `${quote.brand} ${quote.model}` : 'Vehicle request';
            return <tr key={quote.id} className="row-clickable" onClick={goToRow}><td><strong>{dealerQuotes ? <Link className="row-link" to={viewHref}>{vehicle}</Link> : vehicle}</strong><small>{quote.brand ? [`${quote.yearMin}–${quote.yearMax}`, quote.bodyType].filter(Boolean).join(' · ') : ''}</small></td>{dealerQuotes && <td>{quote.buyerFirstName ? <span className="buyer-name">{quote.buyerFirstName}</span> : <span className="muted">—</span>}</td>}<td>{session?.role === 'buyer' ? quote.dealerName : <span className="table-place"><MapPin size={13} /> {quote.buyerArea ?? 'Buyer area'}</span>}</td><td><strong className="price">{formatMoney(quote.finalPrice)}</strong></td>{!dealsOnly && <td><StatusBadge status={quote.status} /></td>}{showBuyerView && <td><BuyerViewBadge viewed={quote.buyerViewed} /></td>}<td>{quote.contactAvailable ? <Link to={`/chat/${quote.id}`} className="button button-secondary button-sm"><MessageCircle size={15} /> Open chat</Link> : quote.chatRequestStatus === 'pending' ? <Link to="/chat/requests" className="button button-secondary button-sm"><Clock3 size={15} /> Buyer waiting</Link> : <span className="muted">Not opened</span>}</td>{!dealerQuotes && <td><Link className="button button-ghost button-sm" to={viewHref}>View <ArrowRight size={15} /></Link></td>}</tr>;
          })}</tbody></table></div>{mine.length === 0 && quotes.length > 0 && !dealsOnly && (activeOnly && terms.length === 0 ? <EmptyState title="No active quotes right now" description="Every offer has been accepted, declined or has expired." action={<div className="empty-action"><button type="button" className="button button-secondary" onClick={clearActiveOnly}>Show all quotes</button></div>} /> : <EmptyState title="No quotes match your search" description="Try a vehicle, area, status or price." />)}{quotes.length === 0 && <EmptyState title={dealsOnly ? 'No accepted deals yet' : 'No quotes yet'} description={dealsOnly ? 'Accepted offers will appear here for fulfillment tracking.' : 'Open the buyer feed to send your first quote.'} />}</section></div>;
}

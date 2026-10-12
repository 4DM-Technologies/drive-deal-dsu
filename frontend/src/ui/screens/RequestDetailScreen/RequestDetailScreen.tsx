import { ArrowLeft, Check, ChevronRight, Clock3, Eye, MessageSquareQuote, ShieldCheck, Star, Trophy } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { formatMoney } from '@/helpers/currency';
import { client } from '@/services/platform/client';
import { EmptyState } from '@/ui/reusables/EmptyState/EmptyState';
import { CompareIcon } from '@/ui/reusables/Icons/CompareIcon';
import { OfferDecision } from '@/ui/reusables/OfferDecision/OfferDecision';
import { PageLoading } from '@/ui/reusables/PageLoading/PageLoading';
import { StatusBadge } from '@/ui/reusables/StatusBadge/StatusBadge';
import type { BuyerRequest, Quote } from '@/types/domain';

const friendlyTimeline = { ASAP: 'Ready when the right offer arrives', 'Within 1 week': 'Deciding within a week', 'Within 2 weeks': 'Deciding within 2–4 weeks', 'Just exploring': 'Researching options' } as const;

export default function RequestDetailScreen() {
  const { id = '' } = useParams();
  const [request, setRequest] = useState<BuyerRequest | null | undefined>(undefined);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [notice, setNotice] = useState('');
  // The offer shown in the side card; the leaderboard's #1 until the buyer picks another row.
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const refresh = useCallback(() => {
    void client.requests.get(id).then(setRequest).catch(() => setRequest(null));
    void client.quotes.list(id).then((rows) => setQuotes(rows.sort((a, b) => Number(a.finalPrice) - Number(b.finalPrice)))).catch(() => setQuotes([]));
  }, [id]);
  useEffect(() => { refresh(); }, [refresh]);

  if (request === undefined) return <PageLoading label="Opening your request" />;
  if (!request) return <div className="shell page-content"><div className="card"><EmptyState title="Request not found" description="This request may have been removed or belongs to another buyer." action={<Link className="button button-primary" to="/requests">Back to requests</Link>} /></div></div>;
  const leader = quotes[0];
  const selected = quotes.find((quote) => quote.id === selectedId) ?? leader;
  const selectedRank = selected ? quotes.indexOf(selected) + 1 : 0;
  const vehicle = `${request.brand} ${request.model}`;
  const decided = (message: string) => { setNotice(message); refresh(); };
  // A row click picks the offer; clicks on the row's own link (the arrow to the full quote) keep their destination.
  const selectFromRow = (event: { target: EventTarget }, quoteId: string) => {
    if ((event.target as HTMLElement).closest('a')) return;
    setSelectedId(quoteId);
  };


  return <div className="shell page-content">
    <Link className="button button-ghost" to="/requests"><ArrowLeft size={17} /> All requests</Link>
    <div className="page-heading request-detail-heading"><div><span className="eyebrow">Private buyer request</span><h1>{request.brand} {request.model}</h1><p>{request.yearMin}–{request.yearMax} · {request.bodyType} · {request.area} · within {request.radiusMiles} miles</p></div><div className="heading-actions"><Link className="button button-compare" to={`/chatbot?compare=${request.id}`}><CompareIcon size={17} /> Compare with Sera</Link><StatusBadge status={request.status === 'open' ? 'live' : request.status} /></div></div>
    {notice && <div className="inline-success" role="status"><Check size={18} />{notice}</div>}
    <section className="request-activity-strip" aria-label="Request activity"><div><Eye /><span><strong>{request.viewCount}</strong><small>verified {request.viewCount === 1 ? 'dealer has' : 'dealers have'} viewed this request</small></span></div><div><MessageSquareQuote /><span><strong>{request.quoteCount || quotes.length}</strong><small>itemized {(request.quoteCount || quotes.length) === 1 ? 'quote' : 'quotes'} received</small></span></div><p>Counts include unique verified dealerships, so repeat visits do not inflate interest.</p></section>
    <div className="detail-grid">
      <main>
        <section className="card card-pad request-summary"><div className="request-summary-head"><div><span className="eyebrow">Your dealer brief</span><h2>{request.brand} {request.model}</h2><p>{friendlyTimeline[request.timeline]} · Expires {new Date(request.expiresAt).toLocaleDateString('en-US')}</p></div></div><div className="spec-list"><div className="spec"><span>Search area</span><strong>{request.area} · {request.radiusMiles} mi</strong></div><div className="spec"><span>Model years</span><strong>{request.yearMin ?? 'Any'}–{request.yearMax ?? 'Any'}</strong></div><div className="spec"><span>Body style</span><strong>{request.bodyType || 'No preference'}</strong></div><div className="spec"><span>Fuel &amp; transmission</span><strong>{[request.fuelType || 'Any fuel', request.transmission || 'Any transmission'].join(' · ')}</strong></div><div className="spec"><span>Preferences</span><strong>{request.mustHaves.join(', ') || 'Open to options'}</strong></div>{request.additionalInformation && <div className="spec"><span>Additional details</span><strong>{request.additionalInformation}</strong></div>}</div></section>
        <section className="card offers-card"><div className="card-pad offers-head"><div><span className="eyebrow">Live quote leaderboard</span><h2>Itemized dealer offers</h2></div><span className="offer-count">{quotes.length} received</span></div>
          {quotes.length === 0 ? <EmptyState title="Waiting for the first offer" description="Matching dealers can see your request. We’ll update this page as soon as one responds." /> : <>
            <div className="table-wrap quote-desktop"><table className="data-table"><thead><tr><th>Rank</th><th>Dealer</th><th>Vehicle</th><th>Fees &amp; tax</th><th>Out-the-door</th><th>Status</th><th /></tr></thead><tbody>{quotes.map((quote, index) => <tr key={quote.id} className={`row-clickable${index === 0 ? ' quote-row-leading' : ''}${quote.id === selected?.id ? ' is-selected' : ''}`} onClick={(event) => selectFromRow(event, quote.id)}><td><span className="rank-badge">{index === 0 ? <Trophy size={14} /> : index + 1}</span></td><td><button type="button" className="offer-select" aria-pressed={quote.id === selected?.id} aria-label={`Select ${quote.dealerName} offer, ${formatMoney(quote.finalPrice)} out the door`}>{quote.dealerName}</button><small className="muted"><Star size={12} fill="currentColor" /> {quote.rating} · {quote.dealerCity}</small>{index === 0 && <span className="leader">Best current value</span>}{(quote.revisions?.length ?? 0) > 0 && <span className="revised-tag">Revised</span>}</td><td className="price">{formatMoney(quote.vehiclePrice)}</td><td className="price">{formatMoney(Number(quote.docFee) + Number(quote.salesTax) + Number(quote.titleReg) - Number(quote.tradeInCredit))}</td><td><strong className="price offer-price">{formatMoney(quote.finalPrice)}</strong><small className="muted"><Clock3 size={12} /> valid through {new Date(quote.expiresAt).toLocaleDateString('en-US')}</small></td><td><StatusBadge status={quote.status} /></td><td><Link className="button button-ghost button-sm" to={`/quotes/${quote.id}`} aria-label={`View ${quote.dealerName} offer`}><ChevronRight size={18} /></Link></td></tr>)}</tbody></table></div>
            <div className="quote-mobile card-pad">{quotes.map((quote, index) => <article className={`mobile-offer${quote.id === selected?.id ? ' is-selected' : ''}`} key={quote.id} onClick={(event) => selectFromRow(event, quote.id)}><div><button type="button" className="offer-select" aria-pressed={quote.id === selected?.id} aria-label={`Select ${quote.dealerName} offer`}>{quote.dealerName}</button>{index === 0 && <span className="leader"><Trophy size={13} /> Best value</span>}{(quote.revisions?.length ?? 0) > 0 && <span className="revised-tag">Revised</span>}<small>{quote.dealerCity} · {quote.rating} stars</small></div><strong className="price">{formatMoney(quote.finalPrice)}</strong><Link className="button button-secondary button-sm" to={`/quotes/${quote.id}`}>View offer</Link></article>)}</div>
          </>}
        </section>
      </main>
      <aside className="sticky-card"><section className="card card-pad best-offer-card"><span className="eyebrow">{selected && selected.id !== leader?.id ? `Selected offer · #${selectedRank} of ${quotes.length}` : 'Best current offer'}</span>{selected ? <><div className="best-offer-price-row"><h2 className="price">{formatMoney(selected.finalPrice)}</h2><StatusBadge status={selected.status} /></div><p><strong>{selected.dealerName}</strong>{(selected.revisions?.length ?? 0) > 0 && <span className="revised-tag">Revised</span>}<br /><span className="muted">{selected.message}</span></p><OfferDecision key={selected.id} quote={selected} vehicle={vehicle} onChanged={decided} />{quotes.length > 1 && <p className="best-offer-hint">Select any offer in the leaderboard to review and act on it here.</p>}</> : <p className="muted">No quotes yet.</p>}</section><section className="card card-pad privacy-note"><ShieldCheck /><div><h3>Buyer-controlled contact</h3><p>Dealer details and chat unlock only after accepting an offer or when the dealer accepts your negotiation request.</p></div></section></aside>
    </div>
  </div>;
}

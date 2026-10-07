import { ArrowLeft, Check, ChevronRight, Clock3, Eye, MessageCircle, MessageSquareQuote, ShieldCheck, Star, Trophy, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { formatMoney } from '@/helpers/currency';
import { client } from '@/services/platform/client';
import { ConfirmDialog } from '@/ui/reusables/ConfirmDialog/ConfirmDialog';
import { EmptyState } from '@/ui/reusables/EmptyState/EmptyState';
import { CompareIcon } from '@/ui/reusables/Icons/CompareIcon';
import { PageLoading } from '@/ui/reusables/PageLoading/PageLoading';
import { StatusBadge } from '@/ui/reusables/StatusBadge/StatusBadge';
import type { BuyerRequest, Quote } from '@/types/domain';

const friendlyTimeline = { ASAP: 'Ready when the right offer arrives', 'Within 1 week': 'Deciding within a week', 'Within 2 weeks': 'Deciding within 2–4 weeks', 'Just exploring': 'Researching options' } as const;

export default function RequestDetailScreen() {
  const { id = '' } = useParams();
  const [request, setRequest] = useState<BuyerRequest | null | undefined>(undefined);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [notice, setNotice] = useState('');
  const [confirming, setConfirming] = useState<{ kind: 'accept' | 'decline'; quote: Quote } | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmError, setConfirmError] = useState('');
  const [negotiating, setNegotiating] = useState<string | null>(null);
  const [openingMessage, setOpeningMessage] = useState('I like this offer, but I would like to discuss the equipment and final price before deciding.');

  const refresh = useCallback(() => {
    void client.requests.get(id).then(setRequest).catch(() => setRequest(null));
    void client.quotes.list(id).then((rows) => setQuotes(rows.sort((a, b) => Number(a.finalPrice) - Number(b.finalPrice)))).catch(() => setQuotes([]));
  }, [id]);
  useEffect(() => { refresh(); }, [refresh]);

  if (request === undefined) return <PageLoading label="Opening your request" />;
  if (!request) return <div className="shell page-content"><div className="card"><EmptyState title="Request not found" description="This request may have been removed or belongs to another buyer." action={<Link className="button button-primary" to="/requests">Back to requests</Link>} /></div></div>;
  const leader = quotes[0];

  function askAccept(idValue: string) {
    const quote = quotes.find((item) => item.id === idValue);
    if (quote) { setConfirmError(''); setConfirming({ kind: 'accept', quote }); }
  }

  function askDecline(idValue: string) {
    const quote = quotes.find((item) => item.id === idValue);
    if (quote) { setConfirmError(''); setConfirming({ kind: 'decline', quote }); }
  }

  async function confirmAction() {
    if (!confirming) return;
    setConfirmBusy(true);
    setConfirmError('');
    try {
      if (confirming.kind === 'accept') {
        await client.quotes.accept(confirming.quote.id);
        setNotice('Offer accepted. The order and dealer conversation are now open.');
      } else {
        await client.quotes.decline(confirming.quote.id);
        setNotice('Offer declined.');
      }
      setConfirming(null);
      refresh();
    } catch {
      setConfirmError('That did not go through. Please try again.');
    } finally {
      setConfirmBusy(false);
    }
  }

  async function submitNegotiation() {
    if (!negotiating || !openingMessage.trim()) return;
    await client.chats.requestAccess(negotiating, openingMessage.trim());
    setNegotiating(null);
    setNotice('Negotiation request sent. The dealer can review your note before opening contact.');
    refresh();
  }

  return <div className="shell page-content">
    <Link className="button button-ghost" to="/requests"><ArrowLeft size={17} /> All requests</Link>
    <div className="page-heading request-detail-heading"><div><span className="eyebrow">Private buyer request</span><h1>{request.brand} {request.model}</h1><p>{request.yearMin}–{request.yearMax} · {request.bodyType} · {request.area} · within {request.radiusMiles} miles</p></div><div className="heading-actions"><Link className="button button-secondary" to={`/chatbot?compare=${request.id}`}><CompareIcon size={17} /> Compare with Sera</Link><StatusBadge status={request.status === 'open' ? 'live' : request.status} /></div></div>
    {notice && <div className="inline-success" role="status"><Check size={18} />{notice}</div>}
    <section className="request-activity-strip" aria-label="Request activity"><div><Eye /><span><strong>{request.viewCount}</strong><small>verified {request.viewCount === 1 ? 'dealer has' : 'dealers have'} viewed this request</small></span></div><div><MessageSquareQuote /><span><strong>{request.quoteCount || quotes.length}</strong><small>itemized {(request.quoteCount || quotes.length) === 1 ? 'quote' : 'quotes'} received</small></span></div><p>Counts include unique verified dealerships, so repeat visits do not inflate interest.</p></section>
    <div className="detail-grid">
      <main>
        <section className="card card-pad request-summary"><div className="request-summary-head"><div><span className="eyebrow">Your dealer brief</span><h2>{request.brand} {request.model}</h2><p>{friendlyTimeline[request.timeline]} · Expires {new Date(request.expiresAt).toLocaleDateString('en-US')}</p></div></div><div className="spec-list"><div className="spec"><span>Search area</span><strong>{request.area} · {request.radiusMiles} mi</strong></div><div className="spec"><span>Model years</span><strong>{request.yearMin}–{request.yearMax}</strong></div><div className="spec"><span>Body style</span><strong>{request.bodyType || 'No preference'}</strong></div><div className="spec"><span>Preferences</span><strong>{request.mustHaves.join(', ') || 'Open to options'}</strong></div></div></section>
        <section className="card offers-card"><div className="card-pad offers-head"><div><span className="eyebrow">Live quote leaderboard</span><h2>Itemized dealer offers</h2></div><span className="offer-count">{quotes.length} received</span></div>
          {quotes.length === 0 ? <EmptyState title="Waiting for the first offer" description="Matching dealers can see your request. We’ll update this page as soon as one responds." /> : <>
            <div className="table-wrap quote-desktop"><table className="data-table"><thead><tr><th>Rank</th><th>Dealer</th><th>Vehicle</th><th>Fees &amp; tax</th><th>Out-the-door</th><th>Status</th><th /></tr></thead><tbody>{quotes.map((quote, index) => <tr key={quote.id} className={index === 0 ? 'quote-row-leading' : ''}><td><span className="rank-badge">{index === 0 ? <Trophy size={14} /> : index + 1}</span></td><td><strong>{quote.dealerName}</strong><small className="muted"><Star size={12} fill="currentColor" /> {quote.rating} · {quote.dealerCity}</small>{index === 0 && <span className="leader">Best current value</span>}</td><td className="price">{formatMoney(quote.vehiclePrice)}</td><td className="price">{formatMoney(Number(quote.docFee) + Number(quote.salesTax) + Number(quote.titleReg) - Number(quote.tradeInCredit))}</td><td><strong className="price offer-price">{formatMoney(quote.finalPrice)}</strong><small className="muted"><Clock3 size={12} /> valid through {new Date(quote.expiresAt).toLocaleDateString('en-US')}</small></td><td><StatusBadge status={quote.status} /></td><td><Link className="button button-ghost button-sm" to={`/quotes/${quote.id}`} aria-label={`View ${quote.dealerName} offer`}><ChevronRight size={18} /></Link></td></tr>)}</tbody></table></div>
            <div className="quote-mobile card-pad">{quotes.map((quote, index) => <article className="mobile-offer" key={quote.id}><div><strong>{quote.dealerName}</strong>{index === 0 && <span className="leader"><Trophy size={13} /> Best value</span>}<small>{quote.dealerCity} · {quote.rating} stars</small></div><strong className="price">{formatMoney(quote.finalPrice)}</strong><Link className="button button-secondary button-sm" to={`/quotes/${quote.id}`}>View offer</Link></article>)}</div>
          </>}
        </section>
      </main>
      <aside className="sticky-card"><section className="card card-pad best-offer-card"><span className="eyebrow">Best current offer</span>{leader ? <><h2 className="price">{formatMoney(leader.finalPrice)}</h2><p><strong>{leader.dealerName}</strong><br /><span className="muted">{leader.message}</span></p><div className="grid"><button className="button button-primary" onClick={() => askAccept(leader.id)} disabled={leader.status === 'accepted'}><Check size={17} /> {leader.status === 'accepted' ? 'Offer accepted' : 'Accept offer'}</button>{leader.chatRequestStatus === 'none' && !leader.contactAvailable && <button className="button button-secondary" onClick={() => { setNegotiating(leader.id); setOpeningMessage(`I like your ${request.brand} ${request.model} offer. I would like to discuss the equipment and final price before deciding.`); }}><MessageCircle size={17} /> Ask to negotiate</button>}{leader.chatRequestStatus === 'pending' && <Link className="button button-secondary" to={`/chat/${leader.id}`}><Clock3 size={17} /> Request pending</Link>}{leader.contactAvailable && <Link className="button button-secondary" to={`/chat/${leader.id}`}><MessageCircle size={17} /> Message dealer</Link>}<button className="button button-ghost" onClick={() => askDecline(leader.id)}><X size={17} /> Decline offer</button></div></> : <p className="muted">No quotes yet.</p>}</section><section className="card card-pad privacy-note"><ShieldCheck /><div><h3>Buyer-controlled contact</h3><p>Dealer details and chat unlock only after accepting an offer or when the dealer accepts your negotiation request.</p></div></section></aside>
    </div>
    {confirming && <ConfirmDialog open title={confirming.kind === 'accept' ? 'Accept this offer?' : 'Decline this offer?'} description={confirming.kind === 'accept' ? 'Accepting opens a private conversation with this dealer. Your other offers on this request will be declined.' : 'The dealer will be told this offer was declined. You can keep comparing your other offers.'} details={<><span>{confirming.quote.dealerName}</span><strong className="price">{formatMoney(confirming.quote.finalPrice)}</strong><small>Out-the-door total</small></>} confirmLabel={confirming.kind === 'accept' ? 'Yes, accept offer' : 'Yes, decline offer'} tone={confirming.kind === 'accept' ? 'primary' : 'danger'} busy={confirmBusy} error={confirmError} onConfirm={() => void confirmAction()} onCancel={() => setConfirming(null)} />}
    {negotiating && <div className="modal-backdrop" role="presentation" onMouseDown={() => setNegotiating(null)}><section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="negotiation-title" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" onClick={() => setNegotiating(null)} aria-label="Close"><X /></button><span className="eyebrow">Private negotiation request</span><h2 id="negotiation-title">Ask {quotes.find((quote) => quote.id === negotiating)?.dealerName} to chat</h2><p className="muted">This note is visible before your identity is shared. If the dealer accepts, it becomes the first message in the conversation.</p><div className="field"><label>Your opening note</label><textarea className="textarea" rows={5} maxLength={1000} value={openingMessage} onChange={(event) => setOpeningMessage(event.target.value)} /></div><small className="character-count">{openingMessage.length}/1000</small><button className="button button-primary button-wide" onClick={() => void submitNegotiation()} disabled={!openingMessage.trim()}><MessageCircle size={17} /> Send negotiation request</button></section></div>}
  </div>;
}

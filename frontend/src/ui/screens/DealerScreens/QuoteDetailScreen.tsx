import { ArrowLeft, CheckCircle2, Download, FileCheck2, Image, ImageOff, MessageCircle, Pencil, ShieldCheck, TrendingDown, Trophy } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { computeOtd, formatMoney } from '@/helpers/currency';
import { client } from '@/services/platform/client';
import { useDemoStore } from '@/services/platform/demoStore';
import type { BuyerRequest, DealDocument, Quote } from '@/types/domain';
import { PageLoading } from '@/ui/reusables/PageLoading/PageLoading';
import { StatusBadge } from '@/ui/reusables/StatusBadge/StatusBadge';

const progression = ['paperwork_going_on', 'funds_arrived', 'dispatch', 'delivery', 'completed'] as const;

export default function QuoteDetailScreen({ deal = false }: { deal?: boolean }) {
  const params = useParams();
  const id = params.id ?? params.quoteId ?? '';
  const session = useDemoStore((state) => state.session);
  const [quote, setQuote] = useState<Quote | null | undefined>(undefined);
  const [request, setRequest] = useState<BuyerRequest | null | undefined>(undefined);
  const [competing, setCompeting] = useState<Quote[]>([]);
  const [revising, setRevising] = useState(false);
  const [vehiclePrice, setVehiclePrice] = useState('0');
  const [attachments, setAttachments] = useState<DealDocument[]>([]);
  const [selectedImage, setSelectedImage] = useState(0);

  const refresh = () => {
    void client.quotes.get(id).then(async (row) => {
      setQuote(row);
      setVehiclePrice(row.vehiclePrice);
      const lookup = session?.role === 'buyer' ? client.requests.get : client.feed.get;
      void lookup(row.requestId).then(setRequest).catch(() => setRequest(null));
      void client.quotes.list(row.requestId).then((rows) => setCompeting(rows.filter((item) => !['withdrawn', 'expired'].includes(item.status)).sort((a, b) => Number(a.finalPrice) - Number(b.finalPrice)))).catch(() => setCompeting([]));
    }).catch(() => setQuote(null));
    void client.documents.list(id).then((rows) => { setAttachments(rows); setSelectedImage(0); }).catch(() => setAttachments([]));
  };
  // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
  useEffect(() => { setQuote(undefined); setRequest(undefined); setCompeting([]); refresh(); }, [id]);

  if (quote === undefined || (quote && request === undefined)) return <PageLoading label="Opening quote" />;
  if (!quote || !request) return <div className="shell page-content"><section className="card card-pad"><h1>Quote not found</h1><p className="muted">This quote may no longer be available in your workspace.</p><Link className="button button-primary" to="/quotes">Back to quotes</Link></section></div>;

  const rank = competing.findIndex((item) => item.id === quote.id) + 1;
  const leader = competing[0];
  const gap = leader ? Number(quote.finalPrice) - Number(leader.finalPrice) : 0;
  const currentIndex = quote.dealStatus ? progression.indexOf(quote.dealStatus as typeof progression[number]) : -1;
  const next = progression[currentIndex + 1];
  const images = attachments.filter((item) => item.type === 'vehicle_image' && item.downloadUrl);
  const documents = attachments.filter((item) => item.type !== 'vehicle_image' && item.downloadUrl);
  const newTotal = computeOtd({ vehiclePrice, docFee: quote.docFee, salesTax: (Number(vehiclePrice) * .0625).toFixed(2), titleReg: quote.titleReg, tradeInCredit: quote.tradeInCredit });
  const accepted = quote.status === 'accepted';

  async function sendRevision() {
    await client.quotes.revise(quote!.id, { vehiclePrice, docFee: quote!.docFee, salesTax: (Number(vehiclePrice) * .0625).toFixed(2), titleReg: quote!.titleReg, tradeInCredit: quote!.tradeInCredit });
    setRevising(false);
    refresh();
  }

  async function advance() {
    if (!next) return;
    await client.deals.updateStatus(quote!.id, next);
    refresh();
  }

  return <div className="shell page-content quote-detail-page">
    <Link className="button button-ghost" to={deal ? session?.role === 'buyer' ? '/orders' : '/deals' : session?.role === 'buyer' ? `/requests/${request.id}` : '/quotes'}><ArrowLeft size={17} /> Back</Link>
    <div className="page-heading quote-detail-heading"><div><span className="eyebrow">{deal ? 'Accepted deal' : 'Dealer quote'} · {request.brand} {request.model}</span><h1>{formatMoney(quote.finalPrice)} out the door</h1><p>{quote.dealerName} · {quote.dealerCity} · valid through {new Date(quote.expiresAt).toLocaleDateString('en-US')}</p></div><StatusBadge status={deal ? quote.dealStatus ?? quote.status : quote.status} /></div>
    {session?.role === 'dealer' && !accepted && <section className={`quote-position ${rank === 1 ? 'leading' : 'behind'}`}>{rank === 1 ? <Trophy /> : <TrendingDown />}<div><span className="eyebrow">Live position · #{rank} of {competing.length}</span><h2>{rank === 1 ? 'You are leading this request.' : 'A revision may improve your position.'}</h2><p>{rank === 1 ? `Your offer is ${formatMoney(Math.max(0, Number(competing[1]?.finalPrice ?? quote.finalPrice) - Number(quote.finalPrice)))} below the next dealer.` : `The current leading offer is ${formatMoney(gap)} lower. Buyer identity remains protected.`}</p></div><button className="button button-secondary" onClick={() => setRevising((value) => !value)}><Pencil size={17} /> Revise price</button></section>}
    {accepted && session?.role === 'dealer' && <section className="quote-position accepted"><CheckCircle2 /><div><span className="eyebrow">Buyer accepted your offer</span><h2>Contact and realtime chat are now open.</h2></div><Link className="button button-primary" to={`/chat/${quote.id}`}><MessageCircle size={17} /> Message buyer</Link></section>}
    {revising && <section className="card card-pad revise-bar"><div><span className="eyebrow">Price revision</span><h3>Send a new itemized total</h3></div><div className="field"><label htmlFor="revised-price">Vehicle price</label><input id="revised-price" className="input price" value={vehiclePrice} onChange={(event) => setVehiclePrice(event.target.value)} inputMode="decimal" /></div><div><small>New estimated OTD</small><strong className="price">{formatMoney(newTotal)}</strong></div><button className="button button-primary" onClick={() => void sendRevision()}>Send revision</button></section>}
    <div className="detail-grid"><main className="grid">
      <section className={`card quote-gallery ${images.length ? '' : 'quote-gallery-empty'}`}>
        {images.length ? <><div className="quote-gallery-main"><img src={images[selectedImage]?.downloadUrl ?? images[0]!.downloadUrl} alt={`${request.brand} ${request.model} supplied by ${quote.dealerName}`} /></div><div className="quote-gallery-thumbs">{images.map((image, index) => <button type="button" className={selectedImage === index ? 'active' : ''} onClick={() => setSelectedImage(index)} key={image.id} aria-label={`View dealer vehicle photo ${index + 1}`}><img src={image.downloadUrl} alt="" loading="lazy" /></button>)}<span><Image size={18} /> {images.length} dealer-supplied {images.length === 1 ? 'photo' : 'photos'}</span></div></> : <div className="quote-media-empty"><span><ImageOff /></span><h3>No vehicle photos supplied</h3><p>This quote includes pricing only. Deal&amp;Drive does not substitute stock or demo images.</p></div>}
      </section>
      <section className="card card-pad"><span className="eyebrow">Out-the-door breakdown</span><div className="spec-list"><div className="spec"><span>Vehicle price</span><strong className="price">{formatMoney(quote.vehiclePrice, true)}</strong></div><div className="spec"><span>Documentation fee</span><strong className="price">{formatMoney(quote.docFee, true)}</strong></div><div className="spec"><span>Sales tax</span><strong className="price">{formatMoney(quote.salesTax, true)}</strong></div><div className="spec"><span>Title &amp; registration</span><strong className="price">{formatMoney(quote.titleReg, true)}</strong></div><div className="spec"><span>Trade-in credit</span><strong className="price">−{formatMoney(quote.tradeInCredit, true)}</strong></div><div className="spec"><span>Final total</span><strong className="price quote-total">{formatMoney(quote.finalPrice, true)}</strong></div></div><blockquote className="dealer-note">“{quote.message}”</blockquote></section>
      {deal && <section className="card card-pad"><span className="eyebrow">Fulfillment</span><h2>Deal progress</h2><div className="deal-progress">{progression.map((item, index) => <div key={item} className={index <= currentIndex ? 'complete' : ''}><CheckCircle2 /><span>{item.replaceAll('_', ' ').replace(/^./, (char) => char.toUpperCase())}</span>{index === currentIndex && <StatusBadge status={item} />}</div>)}</div>{session?.role === 'dealer' && next && <button className="button button-primary" onClick={() => void advance()}>Advance to {next.replaceAll('_', ' ')}</button>}</section>}
    </main><aside className="sticky-card grid"><section className="card card-pad"><ShieldCheck color="var(--accent)" /><h3>{quote.contactAvailable ? 'Contact is unlocked' : 'Buyer identity is protected'}</h3><p className="muted">{quote.contactAvailable ? 'The accepted quote or approved negotiation opened this private conversation.' : 'Contact opens only after acceptance or an approved negotiation request.'}</p>{quote.contactAvailable && <Link className="button button-primary button-wide" to={`/chat/${quote.id}`}><MessageCircle size={17} /> Open conversation</Link>}</section><section className="card card-pad quote-documents"><span className="eyebrow">Dealer document</span><h3>Quote attachment</h3>{documents.length ? documents.map((document) => <a className="document-row" href={document.downloadUrl} download={document.name} key={document.id} aria-label={`Download ${document.name}`}><FileCheck2 size={18} /><span><strong>{document.name}</strong><small>Secure download · {document.status}</small></span><Download size={17} /></a>) : <div className="document-empty"><FileCheck2 /><p><strong>No document attached</strong><small>The dealer submitted this quote without a downloadable document.</small></p></div>}</section></aside></div>
  </div>;
}

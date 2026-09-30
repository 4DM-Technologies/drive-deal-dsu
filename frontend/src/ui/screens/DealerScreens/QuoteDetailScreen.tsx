import { ArrowLeft, CheckCircle2, FileCheck2, Image, MessageCircle, Pencil, ShieldCheck, TrendingDown, Trophy } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { computeOtd, formatMoney } from '@/helpers/currency';
import sedanImage from '@/assets/vehicles/studio-sedan.png';
import suvImage from '@/assets/vehicles/studio-suv.png';
import { client } from '@/services/platform/client';
import { useDemoStore } from '@/services/platform/demoStore';
import type { DealDocument } from '@/types/domain';
import { StatusBadge } from '@/ui/reusables/StatusBadge/StatusBadge';

const progression = ['paperwork_going_on', 'funds_arrived', 'dispatch', 'delivery', 'completed'] as const;

export default function QuoteDetailScreen({ deal = false }: { deal?: boolean }) {
  const params = useParams();
  const id = params.id ?? params.quoteId ?? '';
  const quotes = useDemoStore((state) => state.quotes);
  const quote = quotes.find((item) => item.id === id);
  const request = useDemoStore((state) => state.requests.find((item) => item.id === quote?.requestId));
  const updateDealStatus = useDemoStore((state) => state.updateDealStatus);
  const reviseQuote = useDemoStore((state) => state.reviseQuote);
  const session = useDemoStore((state) => state.session);
  const [revising, setRevising] = useState(false);
  const [vehiclePrice, setVehiclePrice] = useState(quote?.vehiclePrice ?? '0');
  const [attachments, setAttachments] = useState<DealDocument[]>([]);
  useEffect(() => {
    if (!quote || import.meta.env.VITE_USE_MOCKS !== 'false') return;
    void client.documents.list(quote.id).then(setAttachments).catch(() => setAttachments([]));
  }, [quote]);
  const competing = useMemo(() => quotes.filter((item) => item.requestId === quote?.requestId && !['withdrawn', 'expired'].includes(item.status)).sort((a, b) => Number(a.finalPrice) - Number(b.finalPrice)), [quote?.requestId, quotes]);
  if (!quote || !request) return <div className="shell page-content"><section className="card card-pad"><h1>Quote not found</h1><p className="muted">This quote may no longer be available in your workspace.</p><Link className="button button-primary" to="/quotes">Back to quotes</Link></section></div>;

  const rank = competing.findIndex((item) => item.id === quote.id) + 1;
  const leader = competing[0];
  const gap = leader ? Number(quote.finalPrice) - Number(leader.finalPrice) : 0;
  const currentIndex = quote.dealStatus ? progression.indexOf(quote.dealStatus as typeof progression[number]) : -1;
  const next = progression[currentIndex + 1];
  const storedImages = attachments.filter((item) => item.type === 'vehicle_image' && item.downloadUrl).map((item) => item.downloadUrl);
  const images = storedImages.length ? storedImages : quote.vehicleImages?.length ? quote.vehicleImages : request.bodyType === 'Sedan' ? [sedanImage, suvImage] : [suvImage, sedanImage];
  const newTotal = computeOtd({ vehiclePrice, docFee: quote.docFee, salesTax: (Number(vehiclePrice) * .0625).toFixed(2), titleReg: quote.titleReg, tradeInCredit: quote.tradeInCredit });
  const accepted = quote.status === 'accepted';

  return <div className="shell page-content quote-detail-page"><Link className="button button-ghost" to={deal ? session?.role === 'buyer' ? '/orders' : '/deals' : session?.role === 'buyer' ? `/requests/${request.id}` : '/quotes'}><ArrowLeft size={17} /> Back</Link><div className="page-heading quote-detail-heading"><div><span className="eyebrow">{deal ? 'Accepted deal' : 'Dealer quote'} · {request.brand} {request.model}</span><h1>{formatMoney(quote.finalPrice)} out the door</h1><p>{quote.dealerName} · {quote.dealerCity} · valid through {new Date(quote.expiresAt).toLocaleDateString('en-US')}</p></div><StatusBadge status={deal ? quote.dealStatus ?? quote.status : quote.status} /></div>
    {session?.role === 'dealer' && !accepted && <section className={`quote-position ${rank === 1 ? 'leading' : 'behind'}`}>{rank === 1 ? <Trophy /> : <TrendingDown />}<div><span className="eyebrow">Live position · #{rank} of {competing.length}</span><h2>{rank === 1 ? 'You are leading this request.' : 'A revision may improve your position.'}</h2><p>{rank === 1 ? `Your offer is ${formatMoney(Math.max(0, Number(competing[1]?.finalPrice ?? quote.finalPrice) - Number(quote.finalPrice)))} below the next dealer.` : `The current leading offer is ${formatMoney(gap)} lower. Buyer identity remains protected.`}</p></div><button className="button button-secondary" onClick={() => setRevising((value) => !value)}><Pencil size={17} /> Revise price</button></section>}
    {accepted && session?.role === 'dealer' && <section className="quote-position accepted"><CheckCircle2 /><div><span className="eyebrow">Buyer accepted your offer</span><h2>Contact and realtime chat are now open.</h2><p>Rahul Sharma · Frisco, TX · (469) 555-0142 · rahul@drivedeal.demo</p></div><Link className="button button-primary" to={`/chat/${quote.id}`}><MessageCircle size={17} /> Message buyer</Link></section>}
    {revising && <section className="card card-pad revise-bar"><div><span className="eyebrow">Price revision</span><h3>Send a new itemized total</h3></div><div className="field"><label>Vehicle price</label><input className="input price" value={vehiclePrice} onChange={(event) => setVehiclePrice(event.target.value)} inputMode="decimal" /></div><div><small>New estimated OTD</small><strong className="price">{formatMoney(newTotal)}</strong></div><button className="button button-primary" onClick={() => { reviseQuote(quote.id, vehiclePrice, String(newTotal)); setRevising(false); }}>Send revision</button></section>}
    <div className="detail-grid"><main className="grid"><section className="card quote-gallery"><div className="quote-gallery-main"><img src={images[0]} alt={`${request.brand} ${request.model} supplied by ${quote.dealerName}`} /></div><div className="quote-gallery-thumbs">{images.slice(1).map((image, index) => <img src={image} alt={`Dealer vehicle view ${index + 2}`} key={image} />)}<span><Image size={18} /> Dealer-supplied vehicle photos</span></div></section><section className="card card-pad"><span className="eyebrow">Out-the-door breakdown</span><div className="spec-list"><div className="spec"><span>Vehicle price</span><strong className="price">{formatMoney(quote.vehiclePrice, true)}</strong></div><div className="spec"><span>Documentation fee</span><strong className="price">{formatMoney(quote.docFee, true)}</strong></div><div className="spec"><span>Sales tax</span><strong className="price">{formatMoney(quote.salesTax, true)}</strong></div><div className="spec"><span>Title & registration</span><strong className="price">{formatMoney(quote.titleReg, true)}</strong></div><div className="spec"><span>Trade-in credit</span><strong className="price">−{formatMoney(quote.tradeInCredit, true)}</strong></div><div className="spec"><span>Final total</span><strong className="price quote-total">{formatMoney(quote.finalPrice, true)}</strong></div></div><blockquote className="dealer-note">“{quote.message}”</blockquote></section>{deal && <section className="card card-pad"><span className="eyebrow">Fulfillment</span><h2>Deal progress</h2><div className="deal-progress">{progression.map((item, index) => <div key={item} className={index <= currentIndex ? 'complete' : ''}><CheckCircle2 /><span>{item.replaceAll('_', ' ').replace(/^./, (char) => char.toUpperCase())}</span>{index === currentIndex && <StatusBadge status={item} />}</div>)}</div>{session?.role === 'dealer' && next && <button className="button button-primary" onClick={() => updateDealStatus(quote.id, next)}>Advance to {next.replaceAll('_', ' ')}</button>}</section>}</main><aside className="sticky-card grid"><section className="card card-pad"><ShieldCheck color="var(--accent)" /><h3>{quote.contactAvailable ? 'Contact is unlocked' : 'Buyer identity is protected'}</h3><p className="muted">{quote.contactAvailable ? 'The accepted quote or approved negotiation opened this private conversation.' : 'Contact opens only after acceptance or an approved negotiation request.'}</p>{quote.contactAvailable && <Link className="button button-primary button-wide" to={`/chat/${quote.id}`}><MessageCircle size={17} /> Open conversation</Link>}</section><section className="card card-pad"><span className="eyebrow">Dealer documents</span><h3>Quote attachments</h3>{(attachments.length ? attachments.filter((item) => item.type !== 'vehicle_image') : quote.documents ?? [{ name: 'Window sticker', status: 'verified' }, { name: 'Itemized buyer order', status: 'uploaded' }]).map((document) => <a className="document-row" href={'downloadUrl' in document ? document.downloadUrl : undefined} target="_blank" rel="noreferrer" key={'id' in document ? document.id : document.name}><FileCheck2 size={17} /><span><strong>{document.name}</strong><small>{document.status}</small></span></a>)}</section></aside></div>
  </div>;
}

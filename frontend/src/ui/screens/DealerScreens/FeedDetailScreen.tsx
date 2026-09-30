import { ArrowLeft, Calculator, FileUp, ImagePlus, MapPin, Send, ShieldCheck } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { computeOtd, formatMoney } from '@/helpers/currency';
import { client } from '@/services/platform/client';
import { useDemoStore } from '@/services/platform/demoStore';

export default function FeedDetailScreen() {
  const { requestId = '' } = useParams();
  const navigate = useNavigate();
  const session = useDemoStore((state) => state.session);
  const request = useDemoStore((state) => state.requests.find((item) => item.id === requestId));
  const addQuote = useDemoStore((state) => state.addQuote);
  const [vehiclePrice, setVehiclePrice] = useState('65000.00');
  const [docFee, setDocFee] = useState('650.00');
  const [titleReg, setTitleReg] = useState('225.00');
  const [trade, setTrade] = useState('0.00');
  const [message, setMessage] = useState('Vehicle is available with the requested equipment. Delivery timing can be confirmed after acceptance.');
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [documentFiles, setDocumentFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const images = useMemo(() => imageFiles.map((file) => URL.createObjectURL(file)), [imageFiles]);
  const tax = useMemo(() => (Number(vehiclePrice || 0) * .0625).toFixed(2), [vehiclePrice]);
  const total = computeOtd({ vehiclePrice, docFee, salesTax: tax, titleReg, tradeInCredit: trade });
  if (!request) return <div className="shell page-content"><section className="card card-pad"><h1>Request not found</h1><p className="muted">This buying request may have closed or moved outside your matched area.</p><Link className="button button-primary" to="/feed">Back to buyer feed</Link></section></div>;

  async function submit() {
    if (submitting) return;
    setSubmitting(true);
    const id = `quote-${crypto.randomUUID()}`;
    try {
      if (import.meta.env.VITE_USE_MOCKS !== 'false') {
        addQuote({ id, requestId: request!.id, dealerId: session?.id ?? 'dealer-navee', dealerName: 'Navee Motors', dealerCity: 'Plano, TX', rating: 4.9, responseMinutes: 1, vehiclePrice, docFee, salesTax: tax, titleReg, tradeInCredit: trade, finalPrice: String(total), status: 'pending', dealStatus: null, message, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 5 * 86_400_000).toISOString(), contactAvailable: false, chatRequestStatus: 'none', vehicleImages: images, documents: documentFiles.map((file) => ({ name: file.name, status: 'uploaded' })) });
        navigate(`/quotes/${id}`);
        return;
      }
      const created = await client.quotes.create({ buyerRequestId: request!.id, vehiclePrice, docFee, salesTax: tax, titleReg, tradeInCredit: trade, message, expiresAt: new Date(Date.now() + 5 * 86_400_000).toISOString() });
      await Promise.all([...imageFiles.map((file) => client.documents.upload(created.id, file, 'vehicle_image')), ...documentFiles.map((file) => client.documents.upload(created.id, file, 'quote_document'))]);
      navigate(`/quotes/${created.id}`);
    } finally {
      setSubmitting(false);
    }
  }

  return <div className="shell page-content" style={{ maxWidth: 1180 }}><Link className="button button-ghost" to="/feed"><ArrowLeft size={17} /> Back to feed</Link><div className="page-heading request-detail-heading"><div><span className="eyebrow">Buyer request · Identity protected</span><h1>{request.brand} {request.model}</h1><p>{request.yearMin}–{request.yearMax} · {request.bodyType} · {request.timeline}</p></div><div className="distance-chip"><MapPin size={16} /><span><strong>Approx. 12 miles away</strong><small>{request.area} · within {request.radiusMiles} mi</small></span></div></div><div className="detail-grid"><section className="card card-pad quote-builder"><span className="eyebrow">Transparent dealer response</span><h2>Build your itemized quote</h2><form className="form-grid" onSubmit={(event) => { event.preventDefault(); void submit(); }}><div className="field form-span"><label>Vehicle price</label><input className="input price" value={vehiclePrice} onChange={(event) => setVehiclePrice(event.target.value)} inputMode="decimal" required /></div><div className="field"><label>Documentation fee</label><input className="input price" value={docFee} onChange={(event) => setDocFee(event.target.value)} inputMode="decimal" /></div><div className="field"><label>Sales tax <span className="muted">(6.25%)</span></label><input className="input price" value={tax} readOnly /></div><div className="field"><label>Title & registration</label><input className="input price" value={titleReg} onChange={(event) => setTitleReg(event.target.value)} inputMode="decimal" /></div><div className="field"><label>Trade-in credit</label><input className="input price" value={trade} onChange={(event) => setTrade(event.target.value)} inputMode="decimal" /></div><div className="field form-span"><label>Vehicle photos <span className="muted">(dealer supplied)</span></label><label className="upload-zone"><ImagePlus /><span><strong>Add actual vehicle photos</strong><small>JPG, PNG or WebP · up to 8 images</small></span><input type="file" accept="image/*" multiple onChange={(event) => setImageFiles(Array.from(event.target.files ?? []).slice(0, 8))} /></label>{images.length > 0 && <div className="upload-preview">{images.map((image) => <img src={image} alt="Vehicle upload preview" key={image} />)}</div>}</div><div className="field form-span"><label>Quote documents</label><label className="upload-zone compact"><FileUp /><span><strong>Attach window sticker or buyer order</strong><small>PDF or image · securely stored with this quote</small></span><input type="file" accept=".pdf,image/*" multiple onChange={(event) => setDocumentFiles(Array.from(event.target.files ?? []))} /></label>{documentFiles.map((file) => <span className="uploaded-file" key={file.name}><FileUp size={15} /> {file.name}</span>)}</div><div className="field form-span"><label>Message to buyer</label><textarea className="textarea" value={message} onChange={(event) => setMessage(event.target.value)} rows={4} required /></div><div className="form-span quote-total-bar"><span><small>Out-the-door total</small><strong className="price">{formatMoney(total, true)}</strong></span><button className="button button-primary" disabled={submitting}><Send size={17} /> {submitting ? 'Uploading quote…' : 'Send itemized quote'}</button></div></form></section><aside className="sticky-card grid"><section className="card card-pad"><Calculator color="var(--accent)" /><h3>The complete total competes</h3><p className="muted">Vehicle price + documentation fee + sales tax + title and registration − trade-in credit.</p><div className="spec-list single"><div className="spec"><span>Buyer timing</span><strong>{request.timeline}</strong></div><div className="spec"><span>Buyer area</span><strong>{request.area}</strong></div><div className="spec"><span>Requested features</span><strong>{request.mustHaves.join(', ') || 'Open to options'}</strong></div></div></section><section className="card card-pad privacy-note"><ShieldCheck /><div><h3>Identity remains private</h3><p>You see the approximate area only. Contact opens if the buyer accepts or you accept their negotiation request.</p></div></section></aside></div></div>;
}

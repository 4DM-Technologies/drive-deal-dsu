import { ArrowRight, Building2, CheckCircle2, UserRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import heroImage from '@/assets/vehicles/drivedeal-hero.png';
import { client } from '@/services/platform/client';
import { useDemoStore } from '@/services/platform/demoStore';
import { Brand } from '@/ui/reusables/Brand/Brand';
import type { BrandRef, StateRef } from '@/types/domain';

export function SignupChooser() {
  return (
    <main className="auth-panel signup-chooser">
      <div className="auth-card signup-card">
        <Link to="/"><Brand /></Link>
        <span className="eyebrow">Create your account</span>
        <h1>Choose your Deal&amp;Drive workspace</h1>
        <p className="muted">Buyer and dealer accounts have different tools, so each gets a purpose-built experience.</p>
        <div className="grid grid-2 signup-choices">
          <Link className="card card-pad card-hover signup-choice" to="/signup/buyer"><div className="step-number"><UserRound /></div><h2>I want to buy a car</h2><p className="muted">Post one clear request, compare dealer offers, and choose without pressure.</p><span>Create buyer account <ArrowRight size={16} /></span></Link>
          <Link className="card card-pad card-hover signup-choice" to="/signup/dealer"><div className="step-number"><Building2 /></div><h2>I represent a dealership</h2><p className="muted">Meet high-intent buyers and respond with transparent, itemized quotes.</p><span>Apply as a dealer <ArrowRight size={16} /></span></Link>
        </div>
        <p className="auth-alternate">Already have an account? <Link to="/login">Sign in</Link></p>
      </div>
    </main>
  );
}

export default function SignupScreen() {
  const { role = 'buyer' } = useParams();
  const type = role === 'support' ? 'support' : role === 'dealer' ? 'dealer' : 'buyer';
  const setSession = useDemoStore((state) => state.setSession);
  const navigate = useNavigate();
  const [states, setStates] = useState<StateRef[]>([]);
  const [brands, setBrands] = useState<BrandRef[]>([]);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [address, setAddress] = useState('');
  const [stateId, setStateId] = useState('');
  const [dealershipName, setDealershipName] = useState('');
  const [branchName, setBranchName] = useState('');
  const [dealerLicense, setDealerLicense] = useState('');
  const [website, setWebsite] = useState('');
  const [brandId, setBrandId] = useState('');
  const [extraInformation, setExtraInformation] = useState('');
  const [terms, setTerms] = useState(false);
  const [complete, setComplete] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const pending = type !== 'buyer';

  useEffect(() => {
    void client.reference.states().then((rows) => { setStates(rows); setStateId((current) => current || rows[0]?.id || ''); }).catch(() => setStates([]));
    if (type === 'dealer') void client.reference.brands().then((rows) => { setBrands(rows); setBrandId((current) => current || rows[0]?.id || ''); }).catch(() => setBrands([]));
  }, [type]);

  async function submit() {
    if (!terms || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      const base = { fullName, email, phone, password, stateId, address, termsAccepted: terms, termsVersion: '2026-01' };
      if (type === 'buyer') {
        const session = await client.auth.signupBuyer(base);
        setSession(session);
      } else if (type === 'dealer') {
        await client.auth.signupDealer({ ...base, dealershipName, branchName, dealerLicense, website, supportedBrandIds: brandId ? [brandId] : [] });
      } else {
        await client.auth.signupSupport({ ...base, extraInformation });
      }
      setComplete(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Your account could not be created. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (complete) return <main className="auth-panel signup-chooser"><div className="auth-card card card-pad signup-complete"><div className="empty-icon success-icon"><CheckCircle2 /></div><h1>{pending ? `Your ${type} account is pending approval.` : 'Your buyer account is ready.'}</h1><p className="muted">{pending ? 'Our team reviews every request. You will receive an email when access is approved.' : 'Create your first vehicle request and start receiving dealer offers.'}</p><button className="button button-primary" onClick={() => pending ? navigate(`/login?role=${type}`) : navigate('/home')}>{pending ? 'Back to sign in' : 'Open my dashboard'} <ArrowRight size={17} /></button></div></main>;

  return (
    <main className="auth-page">
      <section className="auth-art"><img src={heroImage} alt="Blue sedan on an open road" /><div className="auth-art-copy"><span className="eyebrow auth-eyebrow">{type === 'buyer' ? 'Your next car starts here' : type === 'dealer' ? 'Turn demand into deals' : 'Protected operational access'}</span><h2>{type === 'buyer' ? 'Describe the car. Let the right offer find you.' : type === 'dealer' ? 'Meet buyers already ready to decide.' : 'Support access is reviewed by a person.'}</h2></div></section>
      <section className="auth-panel">
        <div className="auth-card">
          <div className="auth-brand-row"><Link to="/"><Brand /></Link></div>
          <div className="auth-title"><span className="eyebrow">{type === 'buyer' ? 'Buyer account' : type === 'dealer' ? 'Dealer application' : 'Team access request'}</span><h1>{type === 'buyer' ? 'Create your buyer account' : type === 'dealer' ? 'Register your dealership' : 'Request support access'}</h1><p className="muted">Required information keeps the marketplace trustworthy. You can review everything before submitting.</p></div>
          <form className="form-grid signup-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
            <div className="field"><label>Full name</label><input className="input" autoComplete="name" value={fullName} onChange={(event) => setFullName(event.target.value)} required /></div>
            <div className="field"><label>Email address</label><input className="input" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></div>
            <div className="field"><label>Phone number</label><input className="input" type="tel" autoComplete="tel" pattern="^\+?[0-9 ()-]{7,18}$" value={phone} onChange={(event) => setPhone(event.target.value)} required /></div>
            <div className="field"><label>Create password</label><input className="input" type="password" autoComplete="new-password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} required /></div>
            {type === 'dealer' && <><div className="field"><label>Dealership name</label><input className="input" value={dealershipName} onChange={(event) => setDealershipName(event.target.value)} required /></div><div className="field"><label>Branch name</label><input className="input" value={branchName} onChange={(event) => setBranchName(event.target.value)} required /></div><div className="field"><label>Dealer licence number</label><input className="input" value={dealerLicense} onChange={(event) => setDealerLicense(event.target.value)} required /></div><div className="field"><label>Website</label><input className="input" type="url" value={website} onChange={(event) => setWebsite(event.target.value)} required /></div><div className="field"><label>State</label><select className="select" required value={stateId} onChange={(event) => setStateId(event.target.value)}>{states.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div><div className="field"><label>Primary brand</label><select className="select" required value={brandId} onChange={(event) => setBrandId(event.target.value)}>{brands.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div><div className="field form-span"><label>Business address</label><input className="input" value={address} onChange={(event) => setAddress(event.target.value)} required /></div></>}
            {type === 'buyer' && <div className="field form-span"><label>Home area <span className="muted">(optional)</span></label><input className="input" value={address} onChange={(event) => setAddress(event.target.value)} /></div>}
            {type === 'support' && <><div className="field form-span"><label>Location address</label><input className="input" value={address} onChange={(event) => setAddress(event.target.value)} required /></div><div className="field"><label>State</label><select className="select" required value={stateId} onChange={(event) => setStateId(event.target.value)}>{states.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div><div className="field form-span"><label>Verification note <span className="muted">(optional)</span></label><textarea className="textarea" rows={3} value={extraInformation} onChange={(event) => setExtraInformation(event.target.value)} placeholder="Add anything that helps us verify your request" /></div></>}
            {type === 'buyer' && <div className="field"><label>State</label><select className="select" required value={stateId} onChange={(event) => setStateId(event.target.value)}>{states.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>}
            <label className="checkbox-row form-span"><input type="checkbox" checked={terms} onChange={(event) => setTerms(event.target.checked)} required /><span>I agree to Deal&amp;Drive’s <Link to="/terms" target="_blank">Terms of Service</Link> and <Link to="/privacy" target="_blank">Privacy Policy</Link>.</span></label>
            {error && <div className="inline-warning form-span" role="alert">{error}</div>}
            <button className="button button-primary form-span" disabled={!terms || submitting}>{submitting ? 'Submitting…' : type === 'buyer' ? 'Create buyer account' : 'Submit for review'} <ArrowRight size={17} /></button>
          </form>
          <p className="auth-alternate auth-alternate-bottom">Already registered? <Link to={`/login?role=${type}`}>Sign in</Link></p>
        </div>
      </section>
    </main>
  );
}

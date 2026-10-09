import { ArrowRight, Building2, CheckCircle2, FileUp, UserRound } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import heroImage from '@/assets/vehicles/drivedeal-hero.png';
import { DRIVING_LICENSE_UPLOAD } from '@/config/uploads';
import { DRIVING_LICENSE_ACCEPT, drivingLicenseProblem, formatFileSize } from '@/helpers/drivingLicense';
import { client } from '@/services/platform/client';
import { useDemoStore } from '@/services/platform/demoStore';
import { Brand } from '@/ui/reusables/Brand/Brand';
import { Dropdown } from '@/ui/reusables/Dropdown/Dropdown';
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
  const [confirmPassword, setConfirmPassword] = useState('');
  const [address, setAddress] = useState('');
  const [stateId, setStateId] = useState('');
  const [dealershipName, setDealershipName] = useState('');
  const [branchName, setBranchName] = useState('');
  const [dealerLicense, setDealerLicense] = useState('');
  const [website, setWebsite] = useState('');
  const [brandId, setBrandId] = useState('');
  const [extraInformation, setExtraInformation] = useState('');
  const [licenseFile, setLicenseFile] = useState<File | null>(null);
  const [licenseError, setLicenseError] = useState('');
  const [terms, setTerms] = useState(false);
  const [complete, setComplete] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [dealerStep, setDealerStep] = useState(1);
  const confirmPasswordRef = useRef<HTMLInputElement>(null);
  const pending = type !== 'buyer';

  useEffect(() => {
    void client.reference.states().then(setStates).catch(() => setStates([]));
    if (type === 'dealer') void client.reference.brands().then(setBrands).catch(() => setBrands([]));
  }, [type]);

  function pickLicense(file: File | undefined) {
    if (!file) return;
    const problem = drivingLicenseProblem(file);
    setLicenseError(problem ?? '');
    if (!problem) setLicenseFile(file);
  }

  async function submit() {
    if (!terms || submitting) return;
    if (password !== confirmPassword) {
      confirmPasswordRef.current?.setCustomValidity('Passwords do not match.');
      confirmPasswordRef.current?.reportValidity();
      return;
    }
    if (type === 'buyer' && !licenseFile) { setLicenseError('Upload a PDF of your driving licence.'); return; }
    setSubmitting(true);
    setError('');
    try {
      const base = { fullName, email, phone, password, stateId, address, termsAccepted: terms, termsVersion: '2026-01' };
      if (type === 'buyer') {
        const session = await client.auth.signupBuyer({ ...base, drivingLicense: licenseFile as File });
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

  function advanceDealerStep(form: HTMLFormElement) {
    setError('');
    if (!form.reportValidity()) return;
    if (dealerStep === 2 && (!stateId || !brandId)) {
      setError('Select a state and primary brand to continue.');
      return;
    }
    setDealerStep((current) => Math.min(3, current + 1));
  }

  const stateField = <div className="field"><label htmlFor="signup-state">State</label><Dropdown id="signup-state" ariaLabel="State" align="left" placement="auto" value={stateId} onChange={setStateId} options={[{ value: '', label: 'Select a state' }, ...states.map((item) => ({ value: item.id, label: item.name }))]} /></div>;
  const missingChoice = !stateId || (type === 'dealer' && !brandId);

  if (complete) return <main className="auth-panel signup-chooser"><div className="auth-card card card-pad signup-complete"><div className="empty-icon success-icon"><CheckCircle2 /></div><h1>{pending ? `Your ${type} account is pending approval.` : 'Your buyer account is ready.'}</h1><p className="muted">{pending ? 'Our team reviews every request. You will receive an email when access is approved.' : 'Create your first vehicle request and start receiving dealer offers.'}</p><button className="button button-primary" onClick={() => pending ? navigate(`/login?role=${type}`) : navigate('/home')}>{pending ? 'Back to sign in' : 'Open my dashboard'} <ArrowRight size={17} /></button></div></main>;

  return (
    <main className="auth-page">
      <section className="auth-art"><img src={heroImage} alt="Blue sedan on an open road" /><div className="auth-art-copy"><span className="eyebrow auth-eyebrow">{type === 'buyer' ? 'Your next car starts here' : type === 'dealer' ? 'Turn demand into deals' : 'Protected operational access'}</span><h2>{type === 'buyer' ? 'Describe the car. Let the right offer find you.' : type === 'dealer' ? 'Meet buyers already ready to decide.' : 'Support access is reviewed by a person.'}</h2></div></section>
      <section className="auth-panel">
        <div className={`auth-card${type === 'dealer' ? ' auth-card-wide' : ''}`}>
          <div className="auth-brand-row"><Link to="/"><Brand /></Link></div>
          <div className="auth-title"><span className="eyebrow">{type === 'buyer' ? 'Buyer account' : type === 'dealer' ? 'Dealer application' : 'Team access request'}</span><h1>{type === 'buyer' ? 'Create your buyer account' : type === 'dealer' ? 'Register your dealership' : 'Request support access'}</h1><p className="muted">Required information keeps the marketplace trustworthy. You can review everything before submitting.</p></div>
          {type === 'dealer' && <div className="signup-progress" aria-label={`Step ${dealerStep} of 3`}><div className="signup-progress-track"><span style={{ width: `${dealerStep / 3 * 100}%` }} /></div><div className="signup-progress-labels">{['Your account', 'Dealership', 'Location & review'].map((label, index) => <span key={label} className={dealerStep === index + 1 ? 'active' : dealerStep > index + 1 ? 'complete' : ''}><b>{index + 1}</b>{label}</span>)}</div></div>}
          <form className={`form-grid signup-form${type === 'dealer' ? ` signup-form-dealer signup-form-step-${dealerStep}` : ''}`} onSubmit={(event) => { event.preventDefault(); void submit(); }}>
            {(type !== 'dealer' || dealerStep === 1) && <>
              <div className="field"><label htmlFor="signup-name">Full name</label><input id="signup-name" className="input" autoComplete="name" value={fullName} onChange={(event) => setFullName(event.target.value)} required /></div>
              <div className="field"><label htmlFor="signup-email">Email address</label><input id="signup-email" className="input" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></div>
              <div className="field"><label htmlFor="signup-phone">Phone number</label><input id="signup-phone" className="input" type="tel" autoComplete="tel" pattern="^\+?[0-9 \(\)\-]{7,18}$" value={phone} onChange={(event) => setPhone(event.target.value)} required /></div>
              <div className="field"><label htmlFor="signup-password">Create password</label><input id="signup-password" className="input" type="password" autoComplete="new-password" minLength={8} value={password} onChange={(event) => { setPassword(event.target.value); confirmPasswordRef.current?.setCustomValidity(''); }} required /></div>
              <div className="field"><label htmlFor="signup-confirm-password">Confirm password</label><input id="signup-confirm-password" ref={confirmPasswordRef} className="input" type="password" autoComplete="new-password" minLength={8} value={confirmPassword} onChange={(event) => { setConfirmPassword(event.target.value); event.currentTarget.setCustomValidity(event.target.value === password ? '' : 'Passwords do not match.'); }} required /></div>
            </>}
            {type === 'dealer' && dealerStep === 2 && <>
              <div className="field"><label htmlFor="signup-dealership">Dealership name</label><input id="signup-dealership" className="input" autoComplete="organization" value={dealershipName} onChange={(event) => setDealershipName(event.target.value)} required /></div>
              <div className="field"><label htmlFor="signup-branch">Branch name</label><input id="signup-branch" className="input" autoComplete="organization-title" value={branchName} onChange={(event) => setBranchName(event.target.value)} required /></div>
              <div className="field"><label htmlFor="signup-license">Dealer licence number</label><input id="signup-license" className="input" value={dealerLicense} onChange={(event) => setDealerLicense(event.target.value)} required /></div>
              <div className="field"><label htmlFor="signup-website">Website</label><input id="signup-website" className="input" type="url" autoComplete="url" placeholder="https://example.com…" value={website} onChange={(event) => setWebsite(event.target.value)} required /></div>
              {stateField}
              <div className="field"><label htmlFor="signup-brand">Primary brand</label><Dropdown id="signup-brand" ariaLabel="Primary brand" align="left" value={brandId} onChange={setBrandId} options={[{ value: '', label: 'Select a primary brand' }, ...brands.map((item) => ({ value: item.id, label: item.name }))]} /></div>
            </>}
            {type === 'dealer' && dealerStep === 3 && <>
              <div className="field form-span signup-address"><label htmlFor="signup-address">Business address</label><input id="signup-address" className="input" autoComplete="street-address" value={address} onChange={(event) => setAddress(event.target.value)} required /></div>
              <label className="checkbox-row form-span"><input type="checkbox" checked={terms} onChange={(event) => setTerms(event.target.checked)} required /><span>I agree to Deal&amp;Drive’s <Link to="/terms" target="_blank">Terms of Service</Link> and <Link to="/privacy" target="_blank">Privacy Policy</Link>.<span className="trial-line"><b>Free for 2 months, up to 3 quotes.</b> Upgrade to Premium after that to keep quoting.</span></span></label>
            </>}
            {type === 'buyer' && <>
              {stateField}
              <div className="field"><label htmlFor="signup-area">Home area <span className="muted">(optional)</span></label><input id="signup-area" className="input" value={address} onChange={(event) => setAddress(event.target.value)} /></div>
              <div className="field form-span">
                <label htmlFor="driving-license">Driving licence <span className="muted">(PDF only)</span></label>
                <label className={`upload-zone compact${licenseFile ? ' has-file' : ''}`} htmlFor="driving-license">
                  {licenseFile ? <CheckCircle2 /> : <FileUp />}
                  <span><strong>{licenseFile ? licenseFile.name : 'Upload your driving licence'}</strong><small>{licenseFile ? `${formatFileSize(licenseFile.size)} · click to choose a different PDF` : `${DRIVING_LICENSE_UPLOAD.formatsLabel} · up to ${DRIVING_LICENSE_UPLOAD.maxBytes / 1024 / 1024} MB · kept private`}</small></span>
                  <input id="driving-license" type="file" accept={DRIVING_LICENSE_ACCEPT} required={!licenseFile} onChange={(event) => { pickLicense(event.target.files?.[0]); event.target.value = ''; }} />
                  {licenseFile && <button type="button" className="upload-remove" onClick={() => { setLicenseFile(null); setLicenseError(''); }} aria-label={`Remove ${licenseFile.name}`}>Remove</button>}
                </label>
                {licenseError && <span className="field-error" role="alert">{licenseError}</span>}
              </div>
            </>}
            {type === 'support' && <><div className="field"><label htmlFor="signup-address">Location address</label><input id="signup-address" className="input" value={address} onChange={(event) => setAddress(event.target.value)} required /></div>{stateField}<div className="field form-span"><label>Verification note <span className="muted">(optional)</span></label><textarea className="textarea" rows={3} value={extraInformation} onChange={(event) => setExtraInformation(event.target.value)} placeholder="Add anything that helps us verify your request" /></div></>}
            {type !== 'dealer' && <label className="checkbox-row form-span"><input type="checkbox" checked={terms} onChange={(event) => setTerms(event.target.checked)} required /><span>I agree to Deal&amp;Drive’s <Link to="/terms" target="_blank">Terms of Service</Link> and <Link to="/privacy" target="_blank">Privacy Policy</Link>.</span></label>}
            {error && <div className="inline-warning form-span" role="alert">{error}</div>}
            {type === 'dealer' ? <div className="signup-step-actions form-span">{dealerStep > 1 && <button type="button" className="button button-secondary" onClick={() => { setError(''); setDealerStep((current) => current - 1); }}>Back</button>}{dealerStep < 3 ? <button type="button" className="button button-primary" onClick={(event) => advanceDealerStep(event.currentTarget.form!)}>Continue <ArrowRight size={17} /></button> : <button className="button button-primary" disabled={!terms || submitting || missingChoice}>{submitting ? 'Submitting…' : 'Submit for review'} <ArrowRight size={17} /></button>}</div> : <button className="button button-primary form-span" disabled={!terms || submitting || missingChoice}>{submitting ? 'Submitting…' : type === 'buyer' ? 'Create buyer account' : 'Submit for review'} <ArrowRight size={17} /></button>}
          </form>
          <p className="auth-alternate auth-alternate-bottom">Already registered? <Link to={`/login?role=${type}`}>Sign in</Link></p>
        </div>
      </section>
    </main>
  );
}

import { ArrowLeft, ArrowRight, Building2, ChevronDown, Headphones, LockKeyhole, ShieldCheck, UserRound } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import heroImage from '@/assets/vehicles/drivedeal-hero.png';
import { useDemoStore } from '@/services/platform/demoStore';
import { Brand } from '@/ui/reusables/Brand/Brand';
import type { Role } from '@/types/domain';

const access = {
  buyer: { label: 'Buyer', helper: 'Requests, quotes & Serra', icon: UserRound, email: 'rahul@drivedeal.demo', signup: '/signup/buyer' },
  dealer: { label: 'Dealer', helper: 'Demand, quotes & deals', icon: Building2, email: 'naveen@naveemotors.demo', signup: '/signup/dealer' },
  support: { label: 'Team', helper: 'Support operations', icon: Headphones, email: 'maya@drivedeal.demo', signup: '/signup/support' },
} as const;

type LoginRole = keyof typeof access;

export default function LoginScreen() {
  const loginAs = useDemoStore((state) => state.loginAs);
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const requestedRole = params.get('role');
  const initialRole: LoginRole = requestedRole === 'dealer' || requestedRole === 'support' ? requestedRole : 'buyer';
  const [role, setRole] = useState<LoginRole>(initialRole);
  const [email, setEmail] = useState<string>(access[initialRole].email);
  const [password, setPassword] = useState('demo1234');
  const current = useMemo(() => access[role], [role]);
  const teamMode = role === 'support';

  function chooseRole(next: LoginRole) {
    setRole(next);
    setEmail(access[next].email);
    setParams({ role: next }, { replace: true });
  }

  function signIn(asRole: Role = role) {
    loginAs(asRole);
    const state = location.state as { next?: string } | null;
    navigate(state?.next ?? (asRole === 'support' || asRole === 'admin' ? '/support' : '/home'));
  }

  return (
    <main className="auth-page">
      <section className="auth-art"><img src={heroImage} alt="Blue sedan on an open road" /><div className="auth-art-copy"><span className="eyebrow auth-eyebrow">A calmer way to buy</span><h2>Real dealer offers.<br />One clear decision.</h2><p>Create one request, compare itemized prices, and keep your contact details private until you choose.</p><div className="auth-proof"><ShieldCheck size={18} /> Buyer-controlled contact and AI-assisted comparisons</div></div></section>
      <section className="auth-panel">
        <div className="auth-card">
          <Link to="/" aria-label="DriveDeal landing page"><Brand /></Link>
          <div className="auth-title"><span className="eyebrow">{teamMode ? 'Restricted operations access' : 'Secure account access'}</span><h1>{teamMode ? 'DriveDeal team sign in' : 'Welcome back'}</h1><p className="muted">{teamMode ? 'For approved support and administration accounts only.' : 'Sign in as a buyer or verified dealer.'}</p></div>
          {!teamMode && <div className="role-switcher role-switcher-public" role="tablist" aria-label="Account type">
            {(['buyer', 'dealer'] as LoginRole[]).map((key) => { const item = access[key]; const Icon = item.icon; return <button key={key} type="button" role="tab" aria-selected={role === key} className={role === key ? 'active' : ''} onClick={() => chooseRole(key)}><Icon size={18} /><span><strong>{item.label}</strong><small>{item.helper}</small></span></button>; })}
          </div>}
          {teamMode && <div className="team-access-note"><Headphones size={18} /><span><strong>Operational workspace</strong><small>Access is audited and requires an approved account.</small></span></div>}
          <form className="grid auth-form" onSubmit={(event) => { event.preventDefault(); signIn(); }}>
            <div className="field"><label htmlFor="email">{current.label} email</label><input id="email" className="input" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></div>
            <div className="field"><div className="field-label-row"><label htmlFor="password">Password</label><Link to="/forgot-password">Forgot password?</Link></div><input id="password" className="input" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={6} required /></div>
            <button className="button button-primary button-wide">Sign in to {current.label.toLowerCase()} workspace <ArrowRight size={17} /></button>
          </form>
          {!teamMode && <p className="auth-alternate">New to DriveDeal? <Link to={current.signup}>{role === 'buyer' ? 'Create buyer account' : 'Apply as a dealer'}</Link></p>}
          {teamMode && <p className="auth-alternate"><Link to="/login?role=buyer" onClick={() => chooseRole('buyer')}><ArrowLeft size={14} /> Back to customer sign in</Link></p>}
          <details className="demo-access">
            <summary><span><LockKeyhole size={15} /> Developer demo access</span><ChevronDown size={16} /></summary>
            <div className="demo-access-body"><p>Development only. Choose a ready-made workspace:</p><div className="demo-buttons"><button onClick={() => signIn('buyer')}>Buyer</button><button onClick={() => signIn('dealer')}>Dealer</button><button onClick={() => signIn('support')}>Support</button><button onClick={() => signIn('admin')}>Admin</button></div></div>
          </details>
        </div>
      </section>
    </main>
  );
}

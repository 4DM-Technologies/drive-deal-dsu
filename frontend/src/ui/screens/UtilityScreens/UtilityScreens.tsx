import { ArrowLeft, LockKeyhole, SearchX, ShieldAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Brand } from '@/ui/reusables/Brand/Brand';

export function LegalScreen({ type }: { type: 'terms' | 'privacy' }) {
  const topics = ['Using Deal&Drive', 'Marketplace responsibilities', 'Account and verification', 'Data and communications', 'AI-assisted guidance', 'Contact and disputes'];
  return <main className="shell section" style={{ maxWidth: 850 }}><Link to="/"><Brand /></Link><article style={{ marginTop: '4rem' }}><span className="eyebrow">Last updated September 30, 2026</span><h1 style={{ fontSize: 'clamp(2.5rem,6vw,5rem)' }}>{type === 'terms' ? 'Terms of Service' : 'Privacy Policy'}</h1><p className="muted">This development document establishes the user-facing structure for Deal&amp;Drive’s launch. Legal counsel must review final production language before release.</p>{topics.map((heading, index) => <section key={heading} style={{ padding: '1.3rem 0', borderTop: '1px solid var(--border)' }}><h2>{heading}</h2><p className="muted">Deal&amp;Drive provides a platform for buyers to request vehicles and verified dealers to submit itemized offers. Users remain responsible for reviewing information, making their own purchasing decisions, and keeping account details accurate. {index === 4 && 'AI suggestions are advisory; they do not publish requests, negotiate, or accept offers without explicit buyer confirmation.'}</p></section>)}</article></main>;
}

export function UnauthorizedScreen() { return <Utility icon={<ShieldAlert />} title="This workspace isn’t available to your role" body="Deal&Drive keeps buyer, dealer, and support capabilities separate. Return to your role’s home to continue." />; }
export function NotFoundScreen() { return <Utility icon={<SearchX />} title="That road doesn’t lead anywhere" body="The page may have moved, or the link may no longer be valid." />; }

export function ForgotPasswordScreen() {
  return <main className="auth-panel" style={{ minHeight: '100vh' }}><div className="auth-card card card-pad"><div className="empty-icon"><LockKeyhole /></div><h1>Reset your password</h1><p className="muted">Enter your account email. In connected mode we’ll send a secure, time-limited reset link.</p><form className="grid" onSubmit={(event) => { event.preventDefault(); window.alert('Password reset requested. Email delivery activates when SMTP is configured.'); }}><input className="input" type="email" placeholder="you@example.com" required /><button className="button button-primary">Send reset link</button></form></div></main>;
}

function Utility({ icon, title, body }: { icon: ReactNode; title: string; body: string }) {
  return <main className="auth-panel" style={{ minHeight: '100vh' }}><div className="auth-card" style={{ textAlign: 'center' }}><div className="empty-icon">{icon}</div><h1>{title}</h1><p className="muted">{body}</p><Link className="button button-primary" to="/home"><ArrowLeft size={17} /> Return home</Link></div></main>;
}

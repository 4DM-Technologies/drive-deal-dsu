import { AnimatePresence, motion } from 'motion/react';
import { BriefcaseBusiness, ClipboardCheck, FileText, Gauge, Headphones, Home, LifeBuoy, LogOut, Menu, MessageCircle, PackageCheck, ScrollText, Search, ShieldCheck, Sparkles, TicketCheck, UserRound, Users, X } from 'lucide-react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { SerraWidget } from '@/ui/reusables/SerraWidget/SerraWidget';
import { Brand } from '@/ui/reusables/Brand/Brand';
import { useDemoStore } from '@/services/platform/demoStore';
import { SupportReporter } from '@/ui/reusables/SupportReporter/SupportReporter';
import type { Role } from '@/types/domain';

const links: Record<Role, Array<{ to: string; label: string; icon: typeof Home }>> = {
  buyer: [
    { to: '/home', label: 'Overview', icon: Home }, { to: '/requests', label: 'Requests', icon: FileText },
    { to: '/orders', label: 'Orders', icon: PackageCheck }, { to: '/chat', label: 'Messages', icon: MessageCircle },
    { to: '/chatbot', label: 'Ask Sera', icon: Sparkles }, { to: '/profiles', label: 'Profile', icon: UserRound },
  ],
  dealer: [
    { to: '/home', label: 'Overview', icon: Gauge }, { to: '/feed', label: 'Buyer feed', icon: Search },
    { to: '/quotes', label: 'Quotes', icon: ScrollText }, { to: '/deals', label: 'Deals', icon: BriefcaseBusiness },
    { to: '/chat', label: 'Messages', icon: MessageCircle },
  ],
  support: [
    { to: '/support', label: 'Console', icon: Headphones }, { to: '/tickets', label: 'Tickets', icon: TicketCheck },
    { to: '/verifications', label: 'Verifications', icon: ClipboardCheck }, { to: '/support-members', label: 'Members', icon: Users },
  ],
  'support-admin': [
    { to: '/support', label: 'Console', icon: Headphones }, { to: '/tickets', label: 'Tickets', icon: TicketCheck },
    { to: '/verifications', label: 'Verifications', icon: ClipboardCheck }, { to: '/support-members', label: 'Members', icon: Users },
    { to: '/support-administration', label: 'Administrator', icon: ShieldCheck },
  ],
  admin: [
    { to: '/support', label: 'Console', icon: Headphones }, { to: '/tickets', label: 'Tickets', icon: TicketCheck },
    { to: '/verifications', label: 'Verifications', icon: ClipboardCheck }, { to: '/support-members', label: 'Members', icon: Users },
  ],
};

export function AppShell() {
  const session = useDemoStore((state) => state.session);
  const sidebarOpen = useDemoStore((state) => state.sidebarOpen);
  const setSidebarOpen = useDemoStore((state) => state.setSidebarOpen);
  const logout = useDemoStore((state) => state.logout);
  const navigate = useNavigate();
  const location = useLocation();
  const [supportOpen, setSupportOpen] = useState(false);
  // Switching conversations (/chat/:quoteId) is not a page change: keep the same page instance so nothing remounts or re-animates.
  const pageKey = /^\/chat\/(?!requests$)[^/]+$/.test(location.pathname) ? '/chat' : location.pathname;
  useEffect(() => { window.scrollTo({ top: 0, left: 0 }); }, [pageKey]);
  if (!session) return null;

  const nav = links[session.role];
  const roleHome = ['support', 'support-admin', 'admin'].includes(session.role) ? '/support' : '/home';
  const [signOutOpen, setSignOutOpen] = useState(false);
  const signOutRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!signOutOpen) return;
    const close = (event: MouseEvent) => { if (!signOutRef.current?.contains(event.target as Node)) setSignOutOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setSignOutOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', escape); };
  }, [signOutOpen]);
  const signOut = () => { window.localStorage.removeItem('drivedeal.accessToken'); window.localStorage.removeItem('drivedeal.refreshToken'); logout(); navigate('/login', { replace: true, state: null }); };

  return (
    <div className="page">
      <header className="topbar">
        <div className="shell topbar-inner">
          <NavLink to={roleHome} aria-label={`Deal&Drive ${session.role} home`}><Brand /></NavLink>
          <nav className="main-nav" aria-label="Primary navigation">
            {nav.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}><Icon size={16} />{label}</NavLink>)}
          </nav>
          {(session.role === 'buyer' || session.role === 'dealer') && <button className="support-help-trigger" onClick={() => setSupportOpen(true)} aria-label="Open help and support"><LifeBuoy size={18} /><span>Help</span></button>}
          <button className="profile-menu" onClick={() => navigate('/profiles')} aria-label="Open profile">
            <span className="avatar">{session.avatarInitials}</span>
            <span className="profile-meta"><strong>{session.fullName}</strong><span>{session.role}</span></span>
          </button>
          <div className="signout-wrap" ref={signOutRef}>
            <button className={`button button-ghost button-sm signout-trigger ${signOutOpen ? 'open' : ''}`} onClick={() => setSignOutOpen((open) => !open)} aria-label="Account menu" aria-haspopup="menu" aria-expanded={signOutOpen}><LogOut size={18} /></button>
            {signOutOpen && <div className="signout-menu" role="menu"><button className="signout-item" role="menuitem" onClick={signOut} autoFocus><LogOut size={16} /> Sign out</button></div>}
          </div>
          <button className="button button-ghost mobile-menu" onClick={() => setSidebarOpen(!sidebarOpen)} aria-label="Open menu"><Menu /></button>
        </div>
      </header>
      <AnimatePresence>
        {sidebarOpen && (
          <motion.div style={{ position: 'fixed', inset: 0, zIndex: 70, background: 'rgba(16,35,63,.28)' }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setSidebarOpen(false)}>
            <motion.nav style={{ width: 'min(340px,88vw)', height: '100%', padding: '1rem', background: 'var(--raised)', marginLeft: 'auto' }} initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ duration: .25 }} onClick={(event) => event.stopPropagation()}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}><Brand /><button className="button button-ghost" onClick={() => setSidebarOpen(false)}><X /></button></div>
              {nav.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} onClick={() => setSidebarOpen(false)} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} style={{ display: 'flex', marginBottom: '.25rem' }}><Icon size={17} />{label}</NavLink>)}
            </motion.nav>
          </motion.div>
        )}
      </AnimatePresence>
      <motion.main key={pageKey} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .18 }}>
        <Outlet />
      </motion.main>
      {session.role === 'buyer' && location.pathname !== '/chatbot' && <SerraWidget />}
      {(session.role === 'buyer' || session.role === 'dealer') && <SupportReporter open={supportOpen} onClose={() => setSupportOpen(false)} role={session.role} pageContext={location.pathname} />}
    </div>
  );
}

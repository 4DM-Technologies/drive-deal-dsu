import { AnimatePresence, motion } from 'motion/react';
import { BriefcaseBusiness, ClipboardCheck, FileText, Gauge, Headphones, Home, LogOut, Menu, MessageCircle, PackageCheck, ScrollText, Search, Sparkles, TicketCheck, UserRound, Users, X } from 'lucide-react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import { SerraWidget } from '@/ui/reusables/SerraWidget/SerraWidget';
import { Brand } from '@/ui/reusables/Brand/Brand';
import { ScrollControls } from '@/ui/reusables/ScrollControls/ScrollControls';
import { useDemoStore } from '@/services/platform/demoStore';
import type { Role } from '@/types/domain';

const links: Record<Role, Array<{ to: string; label: string; icon: typeof Home }>> = {
  buyer: [
    { to: '/home', label: 'Overview', icon: Home }, { to: '/requests', label: 'Requests', icon: FileText },
    { to: '/orders', label: 'Orders', icon: PackageCheck }, { to: '/chat', label: 'Messages', icon: MessageCircle },
    { to: '/chatbot', label: 'Ask Serra', icon: Sparkles }, { to: '/profiles', label: 'Profile', icon: UserRound },
  ],
  dealer: [
    { to: '/home', label: 'Overview', icon: Gauge }, { to: '/feed', label: 'Buyer feed', icon: Search },
    { to: '/quotes', label: 'Quotes', icon: ScrollText }, { to: '/deals', label: 'Deals', icon: BriefcaseBusiness },
    { to: '/chat/requests', label: 'Chat requests', icon: MessageCircle }, { to: '/chat', label: 'Messages', icon: MessageCircle },
  ],
  support: [
    { to: '/support', label: 'Console', icon: Headphones }, { to: '/tickets', label: 'Tickets', icon: TicketCheck },
    { to: '/verifications', label: 'Verifications', icon: ClipboardCheck }, { to: '/support-members', label: 'Members', icon: Users },
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
  useEffect(() => { window.scrollTo({ top: 0, left: 0 }); }, [location.pathname]);
  if (!session) return null;

  const nav = links[session.role];
  const roleHome = session.role === 'support' || session.role === 'admin' ? '/support' : '/home';
  const signOut = () => { logout(); navigate('/login'); };

  return (
    <div className="page">
      <header className="topbar">
        <div className="shell topbar-inner">
          <NavLink to={roleHome} aria-label={`DriveDeal ${session.role} home`}><Brand /></NavLink>
          <nav className="main-nav" aria-label="Primary navigation">
            {nav.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}><Icon size={16} />{label}</NavLink>)}
          </nav>
          <button className="profile-menu" onClick={() => navigate('/profiles')} aria-label="Open profile">
            <span className="avatar">{session.avatarInitials}</span>
            <span className="profile-meta"><strong>{session.fullName}</strong><span>{session.role}</span></span>
          </button>
          <button className="button button-ghost button-sm" onClick={signOut} aria-label="Sign out"><LogOut size={18} /></button>
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
      <motion.main key={location.pathname} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .18 }}>
        <Outlet />
      </motion.main>
      {session.role === 'buyer' && location.pathname !== '/chatbot' && <SerraWidget />}
      <ScrollControls />
    </div>
  );
}

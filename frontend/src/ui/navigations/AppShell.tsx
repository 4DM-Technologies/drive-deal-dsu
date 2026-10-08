import { AnimatePresence, motion } from 'motion/react';
import { BriefcaseBusiness, CircleQuestionMark, ClipboardCheck, Eye, FileText, Gauge, Headphones, Home, LogOut, Menu, MessageCircle, PackageCheck, ScrollText, Search, ShieldCheck, TicketCheck, UserRound, Users, WalletCards, X } from 'lucide-react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import type { ComponentType } from 'react';
import { planDetailLine } from '@/helpers/plans';
import { planLabel } from '@/helpers/subscription';
import { SerraLogo } from '@/ui/reusables/SerraLogo/SerraLogo';
import { SerraWidget } from '@/ui/reusables/SerraWidget/SerraWidget';
import { Brand } from '@/ui/reusables/Brand/Brand';
import { ProfileMenu } from '@/ui/reusables/ProfileMenu/ProfileMenu';
import { useDemoStore } from '@/services/platform/demoStore';
import { SupportReporter } from '@/ui/reusables/SupportReporter/SupportReporter';
import type { Role } from '@/types/domain';
import { previewQuery, useEffectiveSession } from '@/ui/navigations/previewSession';
import { BROWSER_STORAGE_KEYS, WORKSPACE_VIEW_QUERY_PARAMETER } from '@/config/browser';

/** Sera's own mark as a nav icon. It is drawn a little larger than the line icons beside it, so its detail still reads, and kept still to keep the header light. */
function SeraNavIcon({ size = 16 }: { size?: number }) {
  return <SerraLogo size={size + 4} animated={false} title={null} />;
}

const links: Record<Role, Array<{ to: string; label: string; icon: ComponentType<{ size?: number }> }>> = {
  buyer: [
    { to: '/home', label: 'Overview', icon: Home }, { to: '/chatbot', label: 'Ask Sera', icon: SeraNavIcon },
    { to: '/requests', label: 'Requests', icon: FileText }, { to: '/orders', label: 'Orders', icon: PackageCheck },
    { to: '/chat', label: 'Messages', icon: MessageCircle }, { to: '/profiles', label: 'Profile', icon: UserRound },
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
    { to: '/support-administration', label: 'Administrator', icon: ShieldCheck },
  ],
};

export function AppShell() {
  const session = useEffectiveSession();
  const accountSession = useDemoStore((state) => state.session);
  const sidebarOpen = useDemoStore((state) => state.sidebarOpen);
  const setSidebarOpen = useDemoStore((state) => state.setSidebarOpen);
  const logout = useDemoStore((state) => state.logout);
  const navigate = useNavigate();
  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  const workspaceView = searchParams.get(WORKSPACE_VIEW_QUERY_PARAMETER);
  const isThemePreview = searchParams.get('themePreview') === '1';
  const previewSearch = previewQuery(location.search);
  const previewPath = (path: string) => `${path}${previewSearch}`;
  const [supportOpen, setSupportOpen] = useState(false);
  // Switching conversations (/chat/:quoteId) is not a page change: keep the same page instance so nothing remounts or re-animates.
  const pageKey = /^\/chat\/(?!requests$)[^/]+$/.test(location.pathname) ? '/chat' : location.pathname;
  useEffect(() => { window.scrollTo({ top: 0, left: 0 }); }, [pageKey]);
  if (!session) return null;

  const nav = links[session.role];
  // Plans and billing belong to buyers and dealers acting as themselves, not to staff or read-only previews.
  const showAccount = (session.role === 'buyer' || session.role === 'dealer') && !previewSearch;
  const subscription = showAccount ? session.subscription ?? null : null;
  const roleHome = ['support', 'support-admin', 'admin'].includes(session.role) ? '/support' : '/home';
  const signOut = () => {
    if (isThemePreview) return;
    window.localStorage.removeItem(BROWSER_STORAGE_KEYS.accessToken);
    window.localStorage.removeItem(BROWSER_STORAGE_KEYS.refreshToken);
    logout();
    navigate('/login', { replace: true, state: null });
  };

  return (
    <div className="page">
      <header className="topbar">
        <div className="shell topbar-inner">
          <NavLink to={previewPath(roleHome)} aria-label={`Deal&Drive ${session.role} home`}><Brand /></NavLink>
          <nav className="main-nav" aria-label="Primary navigation">
            {nav.map(({ to, label, icon: Icon }) => <NavLink key={to} to={previewPath(to)} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}><Icon size={16} />{label}</NavLink>)}
          </nav>
          <div className="topbar-actions">
            {accountSession && ['support-admin', 'admin'].includes(accountSession.role) && !isThemePreview && <label className="workspace-switcher desktop-header-action"><Eye size={16} /><span className="sr-only">View workspace</span><select aria-label="View workspace" value={workspaceView ?? 'support'} onChange={(event) => navigate(event.target.value === 'support' ? '/support' : `/home?workspaceView=${event.target.value}`)}><option value="support">Support workspace</option><option value="buyer">Buyer · read only</option><option value="dealer">Dealer · read only</option></select></label>}
            {(session.role === 'buyer' || session.role === 'dealer') && <button className="support-help-trigger desktop-header-action" onClick={() => setSupportOpen(true)} aria-label="Open help and support"><CircleQuestionMark size={18} /><span>Help</span></button>}
            <ProfileMenu session={session} previewSearch={previewSearch} showAccount={showAccount} signOutDisabled={isThemePreview} onSignOut={signOut} />
            <button className="button button-ghost mobile-menu" onClick={() => setSidebarOpen(!sidebarOpen)} aria-label="Open menu"><Menu /></button>
          </div>
        </div>
      </header>
      {workspaceView && <div className="workspace-view-banner"><div className="shell"><Eye size={17} /><span><strong>{workspaceView === 'buyer' ? 'Buyer' : 'Dealer'} workspace · read only</strong><small>You can inspect the experience and marketplace data. Sensitive and write operations remain disabled.</small></span><button type="button" onClick={() => navigate('/support')}>Return to Support</button></div></div>}
      <AnimatePresence>
        {sidebarOpen && (
          <motion.div style={{ position: 'fixed', inset: 0, zIndex: 70, background: 'rgba(16,35,63,.28)' }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setSidebarOpen(false)}>
            <motion.nav className="mobile-nav-drawer" style={{ width: 'min(340px,88vw)', height: '100%', padding: '1rem', background: 'var(--raised)', marginLeft: 'auto' }} initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ duration: .25 }} onClick={(event) => event.stopPropagation()}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}><Brand /><button className="button button-ghost" onClick={() => setSidebarOpen(false)}><X /></button></div>
              <div className="mobile-nav-links">{nav.map(({ to, label, icon: Icon }) => <NavLink key={to} to={previewPath(to)} onClick={() => setSidebarOpen(false)} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}><Icon size={17} />{label}</NavLink>)}</div>
              {accountSession && ['support-admin', 'admin'].includes(accountSession.role) && !isThemePreview && <label className="workspace-switcher mobile-workspace-switcher"><Eye size={16} /><select aria-label="View workspace" value={workspaceView ?? 'support'} onChange={(event) => { navigate(event.target.value === 'support' ? '/support' : `/home?workspaceView=${event.target.value}`); setSidebarOpen(false); }}><option value="support">Support workspace</option><option value="buyer">Buyer · read only</option><option value="dealer">Dealer · read only</option></select></label>}
              <div className="mobile-nav-account">
                <button type="button" onClick={() => { navigate(previewPath('/profiles')); setSidebarOpen(false); }}><span className="avatar">{session.avatarInitials}</span><span><strong>{session.fullName}</strong><small>Profile</small></span></button>
                {showAccount && <button type="button" onClick={() => { navigate('/account'); setSidebarOpen(false); }}><WalletCards size={18} /><span><strong>Account</strong><small>{subscription ? `${planLabel(subscription)} · ${planDetailLine(subscription)}` : 'Your plan and billing'}</small></span></button>}
                {(session.role === 'buyer' || session.role === 'dealer') && <button type="button" onClick={() => { setSupportOpen(true); setSidebarOpen(false); }}><CircleQuestionMark size={18} /><span><strong>Help</strong><small>Contact support</small></span></button>}
                <button type="button" className="mobile-signout" disabled={isThemePreview} onClick={signOut}><LogOut size={18} /><span><strong>Sign out</strong><small>{isThemePreview ? 'Unavailable in preview' : 'End this session'}</small></span></button>
              </div>
            </motion.nav>
          </motion.div>
        )}
      </AnimatePresence>
      <motion.main key={pageKey} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .18 }} onClickCapture={(event) => { if (!workspaceView) return; const anchor = (event.target as HTMLElement).closest('a'); if (!anchor || anchor.target || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return; const target = new URL(anchor.href, window.location.origin); if (target.origin !== window.location.origin || target.searchParams.has(WORKSPACE_VIEW_QUERY_PARAMETER)) return; event.preventDefault(); target.searchParams.set(WORKSPACE_VIEW_QUERY_PARAMETER, workspaceView); navigate(`${target.pathname}${target.search}${target.hash}`); }}>
        <Outlet />
      </motion.main>
      {session.role === 'buyer' && location.pathname !== '/chatbot' && <SerraWidget />}
      {(session.role === 'buyer' || session.role === 'dealer') && <SupportReporter open={supportOpen} onClose={() => setSupportOpen(false)} role={session.role} pageContext={location.pathname} />}
    </div>
  );
}

import { ArrowRight, ChevronDown, Crown, LogOut, UserRound, WalletCards } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { planDetailLine, upgradeHint } from '@/helpers/plans';
import { planLabel, planStatusClass, planTone } from '@/helpers/subscription';
import { client } from '@/services/platform/client';
import { useDemoStore } from '@/services/platform/demoStore';
import type { Session } from '@/types/domain';

interface ProfileMenuProps {
  session: Session;
  /** Keeps read-only preview mode on every link. */
  previewSearch: string;
  /** Buyers and dealers get the plan rows; staff and preview modes do not. */
  showAccount: boolean;
  signOutDisabled: boolean;
  onSignOut: () => void;
}

const REFRESH_AFTER_MS = 30_000;
const menuItems = (root: HTMLElement | null) => Array.from(root?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? []);

/** The avatar button in the header and the menu it opens: profile, account and plan, upgrade, sign out. */
export function ProfileMenu({ session, previewSearch, showAccount, signOutDisabled, onSignOut }: ProfileMenuProps) {
  const [open, setOpen] = useState(false);
  const setSession = useDemoStore((state) => state.setSession);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const lastRefresh = useRef(0);
  const menuId = useId();
  const subscription = showAccount ? session.subscription ?? null : null;

  useEffect(() => {
    if (!open) return;
    menuItems(wrapRef.current)[0]?.focus();
    const close = (event: PointerEvent) => { if (!wrapRef.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  // Usage changes as quotes or requests are used, so the plan is refreshed when the menu opens (at most every 30 seconds).
  useEffect(() => {
    if (!open || !showAccount || Date.now() - lastRefresh.current < REFRESH_AFTER_MS) return;
    lastRefresh.current = Date.now();
    void client.auth.me().then(setSession).catch(() => undefined);
  }, [open, showAccount, setSession]);

  const close = () => setOpen(false);
  const path = (target: string) => `${target}${previewSearch}`;

  function onKeyDown(event: KeyboardEvent) {
    if (!open) return;
    if (event.key === 'Escape') { event.preventDefault(); close(); triggerRef.current?.focus(); return; }
    if (event.key === 'Tab') { close(); return; }
    const list = menuItems(wrapRef.current);
    const at = list.indexOf(document.activeElement as HTMLElement);
    const move = event.key === 'ArrowDown' ? at + 1 : event.key === 'ArrowUp' ? at - 1 : event.key === 'Home' ? 0 : event.key === 'End' ? list.length - 1 : null;
    if (move === null) return;
    event.preventDefault();
    list[(move + list.length) % list.length]?.focus();
  }

  return (
    <div className="profile-menu-wrap desktop-header-action" ref={wrapRef} onKeyDown={onKeyDown}>
      <button type="button" ref={triggerRef} className={`profile-menu ${open ? 'open' : ''}`} onClick={() => setOpen((value) => !value)} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined} aria-label={`Account menu for ${session.fullName}`}>
        <span className="avatar">{session.avatarInitials}</span>
        <span className="profile-meta"><strong>{session.fullName}</strong><span>{session.role}</span></span>
        <ChevronDown className="profile-chevron" size={16} aria-hidden="true" />
      </button>
      {open && (
        <div className="profile-dropdown" id={menuId} role="menu" aria-label="Account menu">
          <div className="profile-dropdown-head">
            <span className="avatar avatar-lg" aria-hidden="true">{session.avatarInitials}</span>
            <span><strong>{session.fullName}</strong><small>{session.email}</small></span>
          </div>
          <div className="menu-group" role="none">
            <Link className="menu-item" role="menuitem" to={path('/profiles')} onClick={close}>
              <UserRound size={18} /><span className="menu-item-text"><strong>Profile</strong><small>Your details and preferences</small></span>
            </Link>
            {showAccount && (
              <Link className="menu-item" role="menuitem" to="/account" onClick={close}>
                <WalletCards size={18} />
                <span className="menu-item-text"><strong>Account</strong><small>{subscription ? planDetailLine(subscription) : 'Your plan and billing'}</small></span>
                {subscription && <span className={`status ${planStatusClass[planTone(subscription)]}`}>{planLabel(subscription)}</span>}
              </Link>
            )}
          </div>
          {subscription && !subscription.isPremium && (
            <Link className="menu-upgrade" role="menuitem" to="/billing" onClick={close}>
              <span className="menu-upgrade-icon"><Crown size={17} /></span>
              <span className="menu-item-text"><strong>Upgrade to Premium</strong><small>{upgradeHint(subscription)}</small></span>
              <ArrowRight size={16} />
            </Link>
          )}
          <div className="menu-group menu-group-end" role="none">
            <button type="button" className="menu-item menu-item-danger" role="menuitem" disabled={signOutDisabled} title={signOutDisabled ? 'Sign out is unavailable in theme preview' : undefined} onClick={() => { close(); onSignOut(); }}>
              <LogOut size={18} /><span className="menu-item-text"><strong>Sign out</strong></span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

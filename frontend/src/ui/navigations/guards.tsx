import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { client } from '@/services/platform/client';
import { useDemoStore } from '@/services/platform/demoStore';
import { FullScreenLoader } from '@/ui/reusables/PageLoading/PageLoading';
import type { Role } from '@/types/domain';

export function RequireSession({ children }: { children: ReactNode }) {
  const session = useDemoStore((state) => state.session);
  const setSession = useDemoStore((state) => state.setSession);
  const location = useLocation();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    const token = window.localStorage.getItem('drivedeal.accessToken');
    if (!token) { setSession(null); setChecked(true); return; }
    let active = true;
    void client.auth.me().then((fresh) => { if (active) setSession(fresh); }).catch(() => {
      window.localStorage.removeItem('drivedeal.accessToken');
      window.localStorage.removeItem('drivedeal.refreshToken');
      if (active) setSession(null);
    }).finally(() => { if (active) setChecked(true); });
    return () => { active = false; };
  }, []);

  if (!checked) return <FullScreenLoader label="Securing your session" />;
  return session && window.localStorage.getItem('drivedeal.accessToken') ? children : <Navigate to="/login" state={{ next: location.pathname }} replace />;
}

export function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const role = useDemoStore((state) => state.session?.role);
  return role && roles.includes(role) ? children : <Navigate to="/unauthorized" replace />;
}

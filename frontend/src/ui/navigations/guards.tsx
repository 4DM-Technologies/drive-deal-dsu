import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useDemoStore } from '@/services/platform/demoStore';
import type { Role } from '@/types/domain';

export function RequireSession({ children }: { children: ReactNode }) {
  const session = useDemoStore((state) => state.session);
  const location = useLocation();
  return session ? children : <Navigate to="/login" state={{ next: location.pathname }} replace />;
}

export function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const role = useDemoStore((state) => state.session?.role);
  return role && roles.includes(role) ? children : <Navigate to="/unauthorized" replace />;
}

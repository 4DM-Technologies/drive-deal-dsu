import { useLocation } from 'react-router-dom';
import { useDemoStore } from '@/services/platform/demoStore';
import type { Role, Session } from '@/types/domain';

const previewRoles = new Set<Role>(['buyer', 'dealer', 'support']);

export function useEffectiveSession(): Session | null {
  const session = useDemoStore((state) => state.session);
  const location = useLocation();
  if (!session || !['support-admin', 'admin'].includes(session.role)) return session;
  const params = new URLSearchParams(location.search);
  const themePreviewRole = params.get('themePreview') === '1' ? params.get('adminPreview') as Role | null : null;
  const workspaceRole = params.get('workspaceView') as Role | null;
  const previewRole = themePreviewRole ?? workspaceRole;
  if (!previewRole || !previewRoles.has(previewRole) || (workspaceRole && !['buyer', 'dealer'].includes(workspaceRole))) return session;
  return {
    ...session,
    role: previewRole,
    fullName: previewRole === 'buyer' ? 'Rahul Sharma' : previewRole === 'dealer' ? 'Navee Motors' : 'Maya Lewis',
    avatarInitials: previewRole === 'buyer' ? 'RS' : previewRole === 'dealer' ? 'NM' : 'ML',
  };
}

export function previewQuery(search: string): string {
  const params = new URLSearchParams(search);
  return params.get('themePreview') === '1' || params.has('workspaceView') ? search : '';
}

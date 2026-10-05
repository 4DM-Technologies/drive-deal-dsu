import { CalendarDays, Clock3, Mail, MapPin, Phone, Search, ShieldCheck, UserRound, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { relativeTime } from '@/helpers/dateTime';
import { PageLoading } from '@/ui/reusables/PageLoading/PageLoading';
import { client } from '@/services/platform/client';
import { useDemoStore } from '@/services/platform/demoStore';
import { EmptyState } from '@/ui/reusables/EmptyState/EmptyState';
import type { SupportMember } from '@/types/domain';

export function SupportMembers() {
  const session = useDemoStore((state) => state.session);
  const [members, setMembers] = useState<SupportMember[]>([]);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<SupportMember | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [membersLoaded, setMembersLoaded] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    void client.support.members().then(setMembers).catch(() => setError('Support member data could not be loaded from the database.')).finally(() => setMembersLoaded(true));
  }, []);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return members;
    return members.filter((member) => `${member.name} ${member.email} ${member.role}`.toLowerCase().includes(term));
  }, [members, query]);

  async function openMember(member: SupportMember) {
    setSelected(member);
    setLoadingDetail(true);
    setError('');
    try { setSelected(await client.support.member(member.id)); }
    catch { setError('Member details could not be refreshed. Showing the saved information.'); }
    finally { setLoadingDetail(false); }
  }

  if (!membersLoaded) return <PageLoading label="Loading team members" />;
  return <div className="shell page-content members-page">
    <div className="page-heading"><div><span className="eyebrow">Support team</span><h1>Support members</h1><p>Find a teammate and review their account. Administrator permissions are managed in the protected administration workspace.</p></div><div className="members-summary"><strong>{members.length}</strong><span>team members</span></div></div>
    {error && <div className="inline-warning" role="alert">{error}</div>}
    <div className="card card-pad members-toolbar"><label className="search-field"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name, email, or role" aria-label="Search support members" /><span>{filtered.length} found</span></label></div>
    {filtered.length === 0 ? <div className="card"><EmptyState title="No support members found" description="Try a different name, email, or role." /></div> : <div className="support-member-grid">{filtered.map((member) => {
      const isSelf = member.email === session?.email;
      const adminEnabled = member.role === 'support-admin';
      return <article className="card support-member-card" key={member.id} tabIndex={0} onClick={() => void openMember(member)} onKeyDown={(event) => { if (event.key === 'Enter') void openMember(member); }}>
        <div className="member-identity"><span className="member-avatar"><UserRound size={20} /></span><span><strong>{member.name}</strong><small>{member.email}</small></span></div>
        <div className="member-role-copy"><span>{adminEnabled ? 'Support administrator' : 'Support agent'}</span>{isSelf && <small>Signed-in account</small>}</div>
        <div className="member-access-control"><span className="member-access-readonly">{isSelf ? 'Signed-in account' : member.status === 'suspended' ? 'Account unavailable' : 'Permissions managed in Administration'}</span></div>
      </article>;
    })}</div>}
    {selected && <div className="member-drawer-backdrop" onMouseDown={() => setSelected(null)}><aside className="member-drawer" role="dialog" aria-modal="true" aria-labelledby="member-detail-title" onMouseDown={(event) => event.stopPropagation()}><header><div><span className="eyebrow">Support member profile</span><h2 id="member-detail-title">{selected.name}</h2><p>{selected.role === 'support-admin' ? 'Support administrator' : 'Support agent'}</p></div><button className="modal-close" onClick={() => setSelected(null)} aria-label="Close member details"><X /></button></header>{loadingDetail && <div className="member-loading"><span className="dots"><i /><i /><i /></span> Refreshing account details</div>}<div className="member-detail-list"><div><Mail size={17} /><span><small>Email</small><strong>{selected.email}</strong></span></div><div><Phone size={17} /><span><small>Phone</small><strong>{selected.phone || 'Not provided'}</strong></span></div><div><MapPin size={17} /><span><small>Location</small><strong>{selected.address || 'Not provided'}</strong></span></div><div><Clock3 size={17} /><span><small>Last sign-in</small><strong>{selected.lastLoginAt ? relativeTime(selected.lastLoginAt) : 'No sign-in recorded'}</strong></span></div><div><CalendarDays size={17} /><span><small>Member since</small><strong>{selected.createdAt ? new Date(selected.createdAt).toLocaleDateString('en-US', { dateStyle: 'medium' }) : 'Not available'}</strong></span></div></div>{selected.role === 'support-admin' && selected.email !== session?.email && <div className="member-reauth-note"><ShieldCheck size={17} /><span><strong>Administrator access enabled</strong><small>Any future role change will require this member to sign in again.</small></span></div>}</aside></div>}
  </div>;
}

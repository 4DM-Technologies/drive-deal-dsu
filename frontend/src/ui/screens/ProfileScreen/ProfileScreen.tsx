import { ArrowRight, Building2, Check, Globe, LockKeyhole, Mail, MapPin, Phone, Plus, Save, ShieldCheck, UserRound, WalletCards, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { planLabel, planStatusClass, planTone, usageSummary } from '@/helpers/subscription';
import { client } from '@/services/platform/client';
import { useDemoStore } from '@/services/platform/demoStore';

const roleLabels = { buyer: 'Buyer', dealer: 'Verified dealer', support: 'Support specialist', 'support-admin': 'Support administrator', admin: 'Administrator' } as const;

export default function ProfileScreen() {
  const session = useDemoStore((state) => state.session);
  const setSession = useDemoStore((state) => state.setSession);
  const [fullName, setFullName] = useState(session?.fullName ?? '');
  const [phone, setPhone] = useState(session?.phone ?? '');
  const [address, setAddress] = useState(session?.address ?? '');
  const [branchName, setBranchName] = useState(session?.branchName ?? '');
  const [website, setWebsite] = useState(session?.website ?? '');
  const [syncedSession, setSyncedSession] = useState(session);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [draft, setDraft] = useState<string[]>([]);
  const [saved, setSavedPreferences] = useState<string[]>([]);
  const [newPreference, setNewPreference] = useState('');
  const [prefsSaved, setPrefsSaved] = useState(false);
  const [prefsError, setPrefsError] = useState('');
  const isBuyer = session?.role === 'buyer';
  const isDealer = session?.role === 'dealer';
  const [prefsLoading, setPrefsLoading] = useState(isBuyer);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const profileDirty = useMemo(() => session ? (fullName !== session.fullName || phone !== (session.phone ?? '') || address !== (session.address ?? '') || branchName !== (session.branchName ?? '') || website !== (session.website ?? '')) : false, [address, branchName, fullName, phone, session, website]);

  useEffect(() => {
    void client.auth.me().then(setSession).catch(() => undefined);
  }, [setSession]);

  // Reset the editable fields whenever the session object is replaced (initial
  // `auth.me()` response, or a profile save). React's "adjust state when a prop
  // changes" pattern does this during render instead of in an effect: an effect
  // would first paint the stale values and then force a second render, which is
  // what the react-hooks/set-state-in-effect rule flags.
  if (session !== syncedSession) {
    setSyncedSession(session);
    setFullName(session?.fullName ?? '');
    setPhone(session?.phone ?? '');
    setAddress(session?.address ?? '');
    setBranchName(session?.branchName ?? '');
    setWebsite(session?.website ?? '');
  }

  useEffect(() => {
    if (!isBuyer) return;
    void client.profiles.getPreferences().then((prefs) => {
      const features = prefs.mustHaveFeatures ?? [];
      setDraft(features);
      setSavedPreferences(features);
    }).catch(() => setPrefsError('Sera’s saved preferences could not be loaded.')).finally(() => setPrefsLoading(false));
  }, [isBuyer]);

  function addPreference() {
    const value = newPreference.trim();
    if (!value || draft.some((item) => item.toLowerCase() === value.toLowerCase())) return;
    setDraft((items) => [...items, value]);
    setNewPreference('');
  }

  async function saveProfile() {
    if (!fullName.trim()) { setProfileError('Enter your full name.'); return; }
    setSavingProfile(true);
    setProfileError('');
    try {
      const updated = await client.profiles.update({ fullName: fullName.trim(), phone: phone.trim(), address: address.trim(), ...(isDealer ? { branchName: branchName.trim(), website: website.trim() } : {}) });
      // PATCH /profiles/me returns no subscription block, so keep the plan we already have.
      setSession({ ...updated, subscription: updated.subscription ?? session?.subscription ?? null });
      setProfileSaved(true);
      window.setTimeout(() => setProfileSaved(false), 2200);
    } catch (cause) {
      setProfileError(cause instanceof Error ? cause.message : 'Your profile could not be saved.');
    } finally {
      setSavingProfile(false);
    }
  }

  async function savePreferences() {
    setPrefsError('');
    try {
      const result = await client.profiles.savePreferences({ mustHaveFeatures: draft });
      const features = result.mustHaveFeatures ?? draft;
      setSavedPreferences(features);
      setPrefsSaved(true);
      window.setTimeout(() => setPrefsSaved(false), 2200);
    } catch (cause) {
      setPrefsError(cause instanceof Error ? cause.message : 'Preferences could not be saved.');
    }
  }

  if (!session) return null;
  const roleLabel = roleLabels[session.role];

  return <div className="shell page-content profile-page">
    <header className="profile-hero">
      <div className="profile-identity"><div className="profile-avatar" aria-hidden="true">{session.avatarInitials}</div><div><span className="eyebrow">Account settings</span><h1>{session.fullName}</h1></div><span className="profile-role"><ShieldCheck size={15} /> {roleLabel}</span></div>
      <p>Manage the details connected to your Deal&amp;Drive workspace.</p>
    </header>
    <div className="profile-layout"><main className="profile-main">
      <section className="card profile-panel"><div className="profile-section-head"><div><span className="eyebrow">Personal details</span><h2>Contact information</h2><p>Used for account security and marketplace communication.</p></div></div>
        <form className="profile-form" onSubmit={(event) => { event.preventDefault(); void saveProfile(); }}>
          <div className="field"><label htmlFor="profile-name">Full name</label><div className="input-with-icon"><UserRound /><input id="profile-name" name="name" className="input" autoComplete="name" value={fullName} onChange={(event) => setFullName(event.target.value)} required /></div></div>
          <div className="field"><label htmlFor="profile-email">Email address</label><div className="input-with-icon"><Mail /><input id="profile-email" name="email" className="input" value={session.email} type="email" autoComplete="email" readOnly /></div><small>Contact support to change your sign-in email.</small></div>
          <div className="field"><label htmlFor="profile-phone">Phone number</label><div className="input-with-icon"><Phone /><input id="profile-phone" name="tel" className="input" type="tel" autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="(469) 555-0142" /></div></div>
          <div className="field"><label htmlFor="profile-address">Location or mailing address</label><div className="input-with-icon"><MapPin /><input id="profile-address" name="street-address" className="input" autoComplete="street-address" value={address} onChange={(event) => setAddress(event.target.value)} placeholder="Frisco, TX" /></div></div>
          {isDealer && <><div className="field"><label htmlFor="profile-branch">Branch name</label><div className="input-with-icon"><Building2 /><input id="profile-branch" name="organization" className="input" autoComplete="organization" value={branchName} onChange={(event) => setBranchName(event.target.value)} /></div></div><div className="field"><label htmlFor="profile-website">Dealership website</label><div className="input-with-icon"><Globe /><input id="profile-website" name="url" className="input" type="url" autoComplete="url" value={website} onChange={(event) => setWebsite(event.target.value)} placeholder="https://" /></div></div></>}
          {profileError && <div className="inline-warning profile-form-wide" role="alert">{profileError}</div>}
          <div className="profile-form-actions profile-form-wide"><span aria-live="polite">{profileSaved ? <><Check size={16} /> Changes saved</> : profileDirty ? 'You have unsaved changes' : 'Profile is up to date'}</span><button className="button button-primary" disabled={savingProfile || !profileDirty}><Save size={17} />{savingProfile ? 'Saving…' : 'Save changes'}</button></div>
        </form>
      </section>
      {isBuyer && <section className="preference-editor" aria-labelledby="preference-title">
        <div className="preference-editor-head">
          <div className="profile-section-head">
            <span className="eyebrow">Sera’s memory</span>
            <h2 id="preference-title">Vehicle preferences</h2>
            <p>Choose what Sera should remember for future recommendations.</p>
          </div>
          {!prefsLoading && <span className="preference-count">{draft.length} {draft.length === 1 ? 'preference' : 'preferences'}</span>}
        </div>
        <div className="preference-saved" aria-busy={prefsLoading}>
          <span className="preference-label">Saved preferences</span>
          <div className="preference-chips">
            {prefsLoading
              ? <><span className="skeleton chip-skeleton" /><span className="skeleton chip-skeleton wide" /><span className="skeleton chip-skeleton" /></>
              : draft.length
                ? draft.map((chip) => <button key={chip} type="button" className="preference-chip" onClick={() => setDraft((items) => items.filter((item) => item !== chip))} aria-label={`Remove ${chip}`}>{chip}<X size={14} /></button>)
                : <p className="preference-empty">No preferences saved yet. Add one below to personalize Sera’s guidance.</p>}
          </div>
        </div>
        <div className="preference-add-wrap">
          <label className="preference-label" htmlFor="new-preference">Add a preference</label>
          <div className="preference-add">
            <input id="new-preference" name="preference" className="input" value={newPreference} onChange={(event) => setNewPreference(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addPreference(); } }} placeholder="Try “third-row seating” or “hybrid”" />
            <button className="button button-secondary" type="button" onClick={addPreference} disabled={!newPreference.trim()}><Plus size={16} /> Add</button>
          </div>
        </div>
        {prefsError && <div className="inline-warning" role="alert">{prefsError}</div>}
        <div className="preference-footer">
          <span aria-live="polite"><strong>{dirty ? 'Unsaved changes' : prefsSaved ? 'Preferences saved' : 'Up to date'}</strong><small>Only saved preferences are used by Sera.</small></span>
          <button className="button button-primary" onClick={() => void savePreferences()} disabled={!dirty}>{prefsSaved ? <Check size={17} /> : <Save size={17} />}{prefsSaved ? 'Saved' : 'Save preferences'}</button>
        </div>
      </section>}
    </main><aside className="profile-aside" aria-label="Account overview">
      {(isDealer || isBuyer) && <Link to="/account" className="card profile-side-card profile-account-card"><span className="profile-side-icon"><WalletCards size={18} /></span><div><span className="eyebrow">Membership</span><h3>Plan &amp; billing</h3><p>{session.subscription ? usageSummary(session.subscription) : 'Manage your plan and payment details.'}</p><span className="profile-account-foot">{session.subscription ? <span className={`status ${planStatusClass[planTone(session.subscription)]}`}>{planLabel(session.subscription)}</span> : <span />}<span className="profile-account-link">Manage <ArrowRight size={15} /></span></span></div></Link>}
      <section className="card profile-side-card profile-security-card"><span className="profile-side-icon"><LockKeyhole size={18} /></span><div><span className="eyebrow">Privacy</span><h3>Your details stay private</h3><p>Contact information is shared only when the marketplace contact gate opens.</p></div></section>
      {isDealer && <section className="card profile-side-card"><span className="profile-side-icon"><Building2 size={18} /></span><div><span className="eyebrow">Business account</span><h3>{session.dealershipName || 'Dealer account'}</h3><dl><div><dt>License</dt><dd>{session.dealerLicense || 'On file'}</dd></div><div><dt>Branch</dt><dd>{session.branchName || 'Primary location'}</dd></div></dl></div></section>}
    </aside></div>
  </div>;
}

import { Check, Plus, Save, Sparkles, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { client } from '@/services/platform/client';
import { useDemoStore } from '@/services/platform/demoStore';

export default function ProfileScreen() {
  const session = useDemoStore((state) => state.session);
  const setSession = useDemoStore((state) => state.setSession);
  const [fullName, setFullName] = useState(session?.fullName ?? '');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [draft, setDraft] = useState<string[]>([]);
  const [saved, setSavedPreferences] = useState<string[]>([]);
  const [newPreference, setNewPreference] = useState('');
  const [prefsSaved, setPrefsSaved] = useState(false);
  const [prefsError, setPrefsError] = useState('');
  const isBuyer = session?.role === 'buyer';
  const [prefsLoading, setPrefsLoading] = useState(isBuyer);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

  useEffect(() => {
    if (!isBuyer) return;
    void client.profiles.getPreferences().then((prefs) => {
      const features = prefs.mustHaveFeatures ?? [];
      setDraft(features);
      setSavedPreferences(features);
    }).catch(() => {}).finally(() => setPrefsLoading(false));
  }, [isBuyer]);

  function addPreference() {
    const value = newPreference.trim();
    if (!value || draft.some((item) => item.toLowerCase() === value.toLowerCase())) return;
    setDraft((items) => [...items, value]);
    setNewPreference('');
  }

  async function saveProfile() {
    setSavingProfile(true);
    setProfileError('');
    try {
      const updated = await client.profiles.update({ fullName, phone, address });
      setSession(updated);
      setProfileSaved(true);
      window.setTimeout(() => setProfileSaved(false), 1800);
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
      window.setTimeout(() => setPrefsSaved(false), 1800);
    } catch (cause) {
      setPrefsError(cause instanceof Error ? cause.message : 'Preferences could not be saved.');
    }
  }

  return <div className="shell page-content profile-page"><div className="page-heading"><div><span className="eyebrow">Account & advisor controls</span><h1>Your profile</h1><p>Keep your contact details accurate and correct what Sera remembers about your buying preferences.</p></div></div><div className="grid profile-grid"><section className="card card-pad"><span className="eyebrow">Personal details</span><h2>Contact and location</h2><form className="grid" onSubmit={(event) => { event.preventDefault(); void saveProfile(); }}><div className="field"><label>Full name</label><input className="input" value={fullName} onChange={(event) => setFullName(event.target.value)} /></div><div className="field"><label>Email</label><input className="input" defaultValue={session?.email} type="email" disabled /></div><div className="field"><label>Phone</label><input className="input" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="(469) 555-0142" /></div><div className="field"><label>Home area</label><input className="input" value={address} onChange={(event) => setAddress(event.target.value)} placeholder="Frisco, TX" /></div>{profileError && <div className="inline-warning" role="alert">{profileError}</div>}<button className="button button-primary" disabled={savingProfile}><Save size={17} />{profileSaved ? 'Saved' : savingProfile ? 'Saving…' : 'Save profile'}</button></form></section>{isBuyer && <section className="card card-pad preference-editor"><div className="preference-heading"><div className="memory-icon"><Sparkles /></div><div><span className="eyebrow">Sera’s memory</span><h2>Buying preferences</h2></div></div><p className="muted">Add, remove, and save the signals Sera uses. Changes affect future guidance; they never publish a request automatically.</p><div className="preference-chips" aria-busy={prefsLoading}>{prefsLoading ? <><span className="skeleton chip-skeleton" /><span className="skeleton chip-skeleton wide" /><span className="skeleton chip-skeleton" /></> : draft.map((chip) => <button key={chip} type="button" className="preference-chip" onClick={() => setDraft((items) => items.filter((item) => item !== chip))}>{chip}<X size={13} /><span className="sr-only">Remove</span></button>)}</div><div className="preference-add"><input className="input" value={newPreference} onChange={(event) => setNewPreference(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addPreference(); } }} placeholder="e.g. third-row seating" /><button className="button button-secondary" type="button" onClick={addPreference} disabled={!newPreference.trim()}><Plus size={16} /> Add</button></div>{prefsError && <div className="inline-warning" role="alert">{prefsError}</div>}<div className="preference-footer"><span><strong>{draft.length} saved signals</strong><small>Advisor conversations · 86% confidence</small></span><button className="button button-primary" onClick={() => void savePreferences()} disabled={!dirty}>{prefsSaved ? <Check size={17} /> : <Save size={17} />}{prefsSaved ? 'Preferences saved' : 'Save preferences'}</button></div></section>}</div></div>;
}

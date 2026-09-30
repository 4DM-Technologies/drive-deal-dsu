import { Check, Plus, Save, Sparkles, X } from 'lucide-react';
import { useState } from 'react';
import { useDemoStore } from '@/services/platform/demoStore';

export default function ProfileScreen() {
  const session = useDemoStore((state) => state.session);
  const preferences = useDemoStore((state) => state.preferences);
  const updatePreferences = useDemoStore((state) => state.updatePreferences);
  const [draft, setDraft] = useState(preferences);
  const [newPreference, setNewPreference] = useState('');
  const [saved, setSaved] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(preferences);

  function addPreference() {
    const value = newPreference.trim();
    if (!value || draft.some((item) => item.toLowerCase() === value.toLowerCase())) return;
    setDraft((items) => [...items, value]);
    setNewPreference('');
  }

  function savePreferences() {
    updatePreferences(draft);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1800);
  }

  return <div className="shell page-content profile-page"><div className="page-heading"><div><span className="eyebrow">Account & advisor controls</span><h1>Your profile</h1><p>Keep your contact details accurate and correct what Serra remembers about your buying preferences.</p></div></div><div className="grid profile-grid"><section className="card card-pad"><span className="eyebrow">Personal details</span><h2>Contact and location</h2><form className="grid" onSubmit={(event) => { event.preventDefault(); setSaved(true); window.setTimeout(() => setSaved(false), 1800); }}><div className="field"><label>Full name</label><input className="input" defaultValue={session?.fullName} /></div><div className="field"><label>Email</label><input className="input" defaultValue={session?.email} type="email" /></div><div className="field"><label>Phone</label><input className="input" defaultValue="(469) 555-0142" /></div><div className="field"><label>Home area</label><input className="input" defaultValue="Frisco, TX" /></div><button className="button button-primary"><Save size={17} />{saved ? 'Saved' : 'Save profile'}</button></form></section><section className="card card-pad preference-editor"><div className="preference-heading"><div className="memory-icon"><Sparkles /></div><div><span className="eyebrow">Serra’s memory</span><h2>Buying preferences</h2></div></div><p className="muted">Add, remove, and save the signals Serra uses. Changes affect future guidance; they never publish a request automatically.</p><div className="preference-chips">{draft.map((chip) => <button key={chip} type="button" className="preference-chip" onClick={() => setDraft((items) => items.filter((item) => item !== chip))}>{chip}<X size={13} /><span className="sr-only">Remove</span></button>)}</div><div className="preference-add"><input className="input" value={newPreference} onChange={(event) => setNewPreference(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addPreference(); } }} placeholder="e.g. third-row seating" /><button className="button button-secondary" type="button" onClick={addPreference} disabled={!newPreference.trim()}><Plus size={16} /> Add</button></div><div className="preference-footer"><span><strong>{draft.length} saved signals</strong><small>Advisor conversations · 86% confidence</small></span><button className="button button-primary" onClick={savePreferences} disabled={!dirty}>{saved ? <Check size={17} /> : <Save size={17} />}{saved ? 'Preferences saved' : 'Save preferences'}</button></div></section></div></div>;
}

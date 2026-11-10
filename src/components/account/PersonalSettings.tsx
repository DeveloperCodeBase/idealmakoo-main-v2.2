'use client';

import Link from 'next/link';
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type PointerEvent, type ReactNode } from 'react';
import { Bell, Camera, Check, CheckCheck, ChevronRight, CircleAlert, ContactRound, Globe2, ImagePlus, Laptop, LoaderCircle, LockKeyhole, Monitor, Moon, Paintbrush, RotateCcw, RotateCw, Save, ShieldCheck, SlidersHorizontal, Sparkles, Sun, Trash2, Type, Upload, UserRound } from 'lucide-react';
import { useApp } from '@/components/providers/AppProvider';
import { Modal } from '@/components/ui/Primitives';
import { localeNames, locales, type Locale } from '@/lib/i18n';
import { changedPreferredLocale } from '@/lib/locale-routing';
import { USER_PROFILE_LIMITS, type UserPreferences, type UserProfile, type UserSettings, type UserSettingsIssue } from '@/lib/user-settings';
import { DEFAULT_AVATAR_CROP, calculateAvatarCrop, decodeAvatar, drawAvatarPreview, encodeAvatar, type AvatarCrop, type DecodedAvatar } from '@/lib/avatar';
import { accountText } from './account-copy';
import { personalSettingsText, type PersonalSettingsKey } from './personal-settings-copy';
import { UserAvatar } from './UserAvatar';
import styles from './personal-settings.module.css';

type SettingsSection = 'profile' | 'preferences';
type Copy = (key: PersonalSettingsKey) => string;

export function PersonalSettings({ section, embedded = false }: { section: SettingsSection; embedded?: boolean }) {
  const app = useApp();
  const text: Copy = key => personalSettingsText(app.locale, key);
  if (!app.session) return <section className={styles.empty}><UserRound size={32} /><h2>{text('signIn')}</h2><p>{text('signInHelp')}</p><Link className="btn btn-primary" href={app.href('auth/login')}>{text('signIn')}</Link></section>;
  if(app.settingsError) return <section className={styles.empty} role="alert"><CircleAlert size={26}/><p>{app.settingsError}</p><button className="btn" onClick={()=>window.location.reload()}>{text("reload")}</button></section>;
  if (!app.settingsReady || !app.userSettings || app.userSettings.ownerId !== app.session.id) return <section className={styles.empty} role="status"><LoaderCircle className={styles.spinner} size={25} /><p>{text('loading')}</p></section>;
  return <SettingsForm key={`${app.session.id}:${section}`} section={section} embedded={embedded} settings={app.userSettings} />;
}

function SettingsForm({ section, embedded, settings }: { section: SettingsSection; embedded: boolean; settings: UserSettings }) {
  const app = useApp();
  const text: Copy = key => personalSettingsText(app.locale, key);
  const formId = useId();
  const errorRef = useRef<HTMLDivElement>(null);
  const [baseline, setBaseline] = useState(settings);
  const [profile, setProfile] = useState<UserProfile>(settings.profile);
  const [preferences, setPreferences] = useState<UserPreferences>(settings.preferences);
  const [issues, setIssues] = useState<UserSettingsIssue[]>([]);
  const [error, setError] = useState<PersonalSettingsKey | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [saving,setSaving] = useState(false);
  const [avatarReset, setAvatarReset] = useState(0);
  const [deviceTheme, setDeviceTheme] = useState<'dark' | 'light'>(app.theme);
  const dirty = section === 'profile' ? JSON.stringify(profile) !== JSON.stringify(baseline.profile) : JSON.stringify(preferences) !== JSON.stringify(baseline.preferences);
  const externalChange = settings.revision !== baseline.revision;
  const roleName = accountText(app.locale, `role_${app.role}`, app.t);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') { setDeviceTheme(app.theme); return; }
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const sync = () => setDeviceTheme(media.matches ? 'dark' : 'light');
    sync(); media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, [app.theme]);

  useEffect(() => {
    if (!dirty && settings.revision !== baseline.revision) {
      setBaseline(settings); setProfile(settings.profile); setPreferences(settings.preferences); setIssues([]); setError(null);
    }
  }, [settings, dirty, baseline.revision]);
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty]);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);

  const reset = () => {
    setBaseline(settings); setProfile(settings.profile); setPreferences(settings.preferences);
    setIssues([]); setError(null); setAvatarBusy(false); setAvatarReset(value => value + 1);
  };
  const setField = <K extends keyof UserProfile>(key: K, value: UserProfile[K]) => {
    setProfile(current => ({ ...current, [key]: value }));
    setIssues(current => current.filter(issue => issue !== `profile.${key}`));
    if (error !== 'conflict') setError(null);
  };
  const setPreference = <K extends keyof UserPreferences>(key: K, value: UserPreferences[K]) => {
    setPreferences(current => ({ ...current, [key]: value }));
    setIssues(current => current.filter(issue => issue !== `preferences.${key}`));
    if (error !== 'conflict') setError(null);
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!dirty || avatarBusy || saving) return;
    setSaving(true);
    const result = section === 'profile' ? await app.saveProfile(profile, baseline.revision) : await app.savePreferences(preferences, baseline.revision);
    setSaving(false);
    if (!result.ok) {
      setIssues(result.issues || []);
      setError(result.reason === 'conflict' ? 'conflict' : result.reason === 'validation' ? 'validation' : result.reason === 'session' ? 'signInHelp' : 'saveError');
      return;
    }
    setBaseline(result.settings); setProfile(result.settings.profile); setPreferences(result.settings.preferences); setIssues([]); setError(null);
    app.notify(text('saved'));
    const requestedLanguage = section === 'preferences' ? changedPreferredLocale(app.locale, baseline.preferences.language, result.settings.preferences.language) : null;
    if (requestedLanguage) app.switchLocale(requestedLanguage);
  };
  const profileField = (key: Exclude<keyof UserProfile, 'avatar'>, options: { type?: string; full?: boolean; help?: PersonalSettingsKey; rows?: number; autoComplete?: string } = {}) => {
    const issue = issues.includes(`profile.${key}` as UserSettingsIssue);
    const errorKey: PersonalSettingsKey = key === 'name' ? 'invalidName' : key === 'contactEmail' ? 'invalidEmail' : key === 'website' ? 'invalidWebsite' : key === 'phone' ? 'invalidPhone' : 'validation';
    const id = `${formId}-${key}`;
    const common = { id, value: profile[key], onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setField(key, event.target.value), maxLength: USER_PROFILE_LIMITS[key], required: key === 'name', 'aria-invalid': issue || undefined, 'aria-describedby': issue ? `${id}-error` : options.help ? `${id}-help` : undefined, autoComplete: options.autoComplete, dir: key === 'phone' || key === 'contactEmail' || key === 'website' ? 'ltr' as const : 'auto' as const };
    return <div className={`${styles.field} ${options.full ? styles.full : ''}`} key={key}>
      <label htmlFor={id}>{text(key)}{key === 'name' && <span className={styles.required} aria-hidden="true"> *</span>}</label>
      {options.rows ? <textarea {...common} rows={options.rows} /> : <input {...common} type={options.type || 'text'} minLength={key === 'name' ? 2 : undefined} />}
      {options.help && <small id={`${id}-help`}>{text(options.help)}</small>}
      {options.rows && <small className={styles.counter}><bdi>{Array.from(profile[key]).length} / {USER_PROFILE_LIMITS[key]}</bdi></small>}
      {issue && <small id={`${id}-error`} className={styles.fieldError}>{text(errorKey)}</small>}
    </div>;
  };

  return <section className={styles.settings} data-embedded={embedded} data-section={section} dir={app.dir} lang={app.locale} aria-labelledby={`${formId}-title`}>
    <header className={styles.heading}>
      <div><span className={styles.eyebrow}><span />{text('personalSpace')}</span><h2 id={`${formId}-title`}>{text(section)}</h2><p>{text(section === 'profile' ? 'profileIntro' : 'preferencesIntro')}</p></div>
      <span className={styles.headingIcon} aria-hidden="true">{section === 'profile' ? <UserRound size={27} /> : <SlidersHorizontal size={27} />}</span>
    </header>
    <form noValidate onSubmit={submit} aria-busy={saving}>
      <fieldset disabled={saving} style={{border:0,padding:0,margin:0,minWidth:0}}>
      {externalChange && dirty && <div className={styles.notice} role="status"><CircleAlert size={19} /><div><p>{text('conflict')}</p><button type="button" className={styles.textButton} onClick={reset}>{text('reload')}</button></div></div>}
      {error && <div ref={errorRef} className={styles.error} role="alert" tabIndex={-1}><CircleAlert size={20} /><p>{text(error)}</p>{error === 'conflict' && <button type="button" onClick={reset} className={styles.textButton}>{text('reload')}</button>}</div>}
      {section === 'profile' ? <div className={styles.profileGrid}>
        <div className={styles.mainColumn}>
          <SettingsCard title={text('photo')} icon={<Camera size={20} />}>
            <AvatarField key={avatarReset} name={profile.name || app.displayName} value={profile.avatar} onChange={value => setField('avatar', value)} onBusyChange={setAvatarBusy} text={text} />
            {profile.avatar !== baseline.profile.avatar && <p className={styles.draftNote}><Check size={15} />{text(profile.avatar ? 'photoDraft' : 'photoRemoved')}</p>}
            {issues.includes('profile.avatar') && <p className={styles.fieldError}>{text('photoError')}</p>}
          </SettingsCard>
          <SettingsCard title={text('identity')} description={text('identityHelp')} icon={<UserRound size={20} />}>
            <div className={styles.formGrid}>{profileField('name', { autoComplete: 'name' })}{profileField('profession', { autoComplete: 'organization-title' })}{profileField('organization', { full: true, autoComplete: 'organization' })}{profileField('bio', { full: true, rows: 4, help: 'bioHint' })}</div>
          </SettingsCard>
          <SettingsCard title={text('contact')} description={text('contactHelp')} icon={<ContactRound size={20} />}>
            <div className={styles.formGrid}>{profileField('contactEmail', { type: 'email', autoComplete: 'email', help: 'contactEmailHelp' })}{profileField('phone', { type: 'tel', autoComplete: 'tel' })}{profileField('website', { full: true, type: 'url', autoComplete: 'url' })}{profileField('country', { autoComplete: 'country-name' })}{profileField('city', { autoComplete: 'address-level2' })}{profileField('address', { full: true, rows: 3, autoComplete: 'street-address' })}</div>
          </SettingsCard>
        </div>
        <aside className={styles.aside}>
          <div className={`${styles.card} ${styles.profilePreview}`} data-liquid-surface="">
            <span className={styles.previewLabel}>{text('livePreview')}</span><div className={styles.avatarHalo}><UserAvatar name={profile.name || app.displayName} src={profile.avatar} size={104} /></div>
            <h3 dir="auto">{profile.name.trim() || app.displayName}</h3><span className={styles.rolePill}>{roleName}</span>
            {(profile.profession || profile.organization) && <p dir="auto">{[profile.profession, profile.organization].filter(Boolean).join(' · ')}</p>}
            {profile.bio && <p className={styles.previewBio} dir="auto">{profile.bio}</p>}
            {(profile.city || profile.country) && <small dir="auto">{[profile.city, profile.country].filter(Boolean).join(' · ')}</small>}
          </div>
          <SettingsCard title={text('access')} icon={<ShieldCheck size={19} />}>
            <dl className={styles.readonly}><div><dt>{text(app.session?.email?'loginEmail':'phone')}</dt><dd dir="ltr">{app.session?.email||app.session?.phone||'—'}</dd></div><div><dt>{text('role')}</dt><dd>{roleName}</dd></div></dl>
            <p className={styles.smallPrint}>{text('accessHelp')}</p>
            <Link className={styles.relatedLink} href={app.href('account/security')}><LockKeyhole size={17} /><span>{text('security')}</span><ChevronRight className={styles.directional} size={17} /></Link>
            <Link className={styles.relatedLink} href={app.href('account/notifications')}><Bell size={17} /><span>{text('notifications')}</span><ChevronRight className={styles.directional} size={17} /></Link>
          </SettingsCard>
        </aside>
      </div> : <div className={styles.preferenceGrid}>
        <SettingsCard title={text('appearance')} description={text('appearanceHelp')} icon={<Paintbrush size={20} />} className={styles.full}>
          <fieldset className={styles.themeChoices}><legend className={styles.srOnly}>{text('appearance')}</legend>{(['dark', 'light', 'system'] as const).map(theme => {
            const Icon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Laptop;
            return <label className={styles.themeChoice} data-selected={preferences.theme === theme} key={theme}>
              <input type="radio" name={`${formId}-theme`} value={theme} checked={preferences.theme === theme} onChange={() => setPreference('theme', theme)} />
              <span className={styles.themeSample} data-mode={theme} aria-hidden="true"><span className={styles.sampleBar}><i /><i /><i /></span><span className={styles.sampleBody}><span className={styles.sampleSidebar}><i /><i /><i /></span><span className={styles.samplePane}><i /><i /><span><b /><b /></span></span></span></span>
              <span className={styles.themeTitle}><Icon size={18} /><strong>{text(theme)}</strong><span className={styles.choiceMark}><Check size={14} /></span></span><small>{text(theme === 'dark' ? 'darkHelp' : theme === 'light' ? 'lightHelp' : 'systemHelp')}</small>
            </label>;
          })}</fieldset>
        </SettingsCard>
        <SettingsCard title={text('languageAndTime')} icon={<Globe2 size={20} />}>
          <div className={styles.formGrid}>
            <div className={`${styles.field} ${styles.full}`}><label htmlFor={`${formId}-language`}>{text('language')}</label><select id={`${formId}-language`} value={preferences.language} onChange={event => setPreference('language', event.target.value as Locale)} aria-describedby={`${formId}-language-help`}>{locales.map(locale => <option key={locale} value={locale} lang={locale}>{localeNames[locale]}</option>)}</select><small id={`${formId}-language-help`}>{text('languageHelp')}</small></div>
            <TimezoneField id={`${formId}-timezone`} value={preferences.timezone} onChange={value => setPreference('timezone', value)} invalid={issues.includes('preferences.timezone')} text={text} />
          </div>
        </SettingsCard>
        <SettingsCard title={text('movement')} icon={<Sparkles size={20} />}>
          <Toggle id={`${formId}-motion`} title={text('reducedMotion')} help={text('reducedMotionHelp')} checked={preferences.motion === 'reduced'} onChange={value => setPreference('motion', value ? 'reduced' : 'system')} />
          <Toggle id={`${formId}-effects`} title={text('liquidEffects')} help={text('liquidEffectsHelp')} checked={preferences.effects} onChange={value => setPreference('effects', value)} />
        </SettingsCard>
        <SettingsCard title={text('reading')} icon={<Type size={20} />}>
          <Choice name={`${formId}-font-size`} title={text('fontSize')} value={preferences.fontSize} options={['standard', 'large']} text={text} onChange={value => setPreference('fontSize', value)} />
          <Choice name={`${formId}-density`} title={text('density')} value={preferences.density} options={['comfortable', 'compact']} text={text} onChange={value => setPreference('density', value)} />
          <Choice name={`${formId}-sidebar`} title={text('sidebar')} value={preferences.sidebar} options={['expanded', 'collapsed']} text={text} onChange={value => setPreference('sidebar', value)} />
          <p className={styles.smallPrint}>{text('sidebarHelp')}</p>
        </SettingsCard>
        <div className={`${styles.card} ${styles.preferencesPreview}`} data-liquid-surface="">
          <span className={styles.previewLabel}>{text('livePreview')}</span>
          <div className={styles.preferenceSample} data-preview-theme={preferences.theme === 'system' ? deviceTheme : preferences.theme} data-font-size={preferences.fontSize} data-density={preferences.density}>
            <div className={styles.preferenceSampleUser}><UserAvatar name={app.displayName} src={settings.profile.avatar} size={42} /><span><strong dir="auto">{app.displayName}</strong><small>{roleName}</small></span><CheckCheck size={20} /></div>
            <h3>{text('previewText')}</h3><div className={styles.previewLines} aria-hidden="true"><i /><i /><i /></div>
            <span className={styles.previewLocale}><Globe2 size={16} /><span lang={preferences.language}>{localeNames[preferences.language]}</span><span className={styles.previewDivider} /><bdi>{preferences.timezone}</bdi></span>
          </div>
          <p className={styles.smallPrint}>{text('personalOnly')}</p>
        </div>
      </div>}
      <div className={styles.localNotice}><Monitor size={17} /><p>{text('localNote')}</p></div>
      <div className={styles.saveBar} data-liquid-surface="">
        <span className={styles.saveStatus} data-dirty={dirty} role="status">{dirty ? <span className={styles.statusDot} /> : <CheckCheck size={18} />}<span>{text(dirty ? 'unsaved' : 'allSaved')}</span></span>
        <div className={styles.saveButtons}><button type="button" className={styles.secondaryButton} onClick={reset} disabled={saving || (!dirty && !avatarBusy)}><RotateCcw size={16} />{text('discard')}</button><button type="submit" className={styles.primaryButton} disabled={saving || !dirty || avatarBusy}><Save size={17} />{text('save')}</button></div>
      </div>
      </fieldset>
    </form>
  </section>;
}

function SettingsCard({ title, description, icon, className = '', children }: { title: string; description?: string; icon: ReactNode; className?: string; children: ReactNode }) {
  return <section className={`${styles.card} ${className}`} data-liquid-surface=""><header className={styles.cardHeading}><span className={styles.cardIcon} aria-hidden="true">{icon}</span><div><h3>{title}</h3>{description && <p>{description}</p>}</div></header>{children}</section>;
}

function Choice<T extends PersonalSettingsKey>({ name, title, value, options, text, onChange }: { name: string; title: string; value: T; options: readonly T[]; text: Copy; onChange: (value: T) => void }) {
  return <fieldset className={styles.choiceGroup}><legend>{title}</legend><div>{options.map(option => <label className={styles.segment} data-selected={value === option} key={option}><input type="radio" name={name} checked={value === option} value={option} onChange={() => onChange(option)} /><span>{text(option)}</span><Check size={15} aria-hidden="true" /></label>)}</div></fieldset>;
}

function Toggle({ id, title, help, checked, onChange }: { id: string; title: string; help: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <div className={styles.toggleRow}><div><label htmlFor={id}>{title}</label><p id={`${id}-help`}>{help}</p></div><label className={styles.switch}><input id={id} type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} aria-describedby={`${id}-help`} /><span aria-hidden="true" /></label></div>;
}

function TimezoneField({ id, value, onChange, invalid, text }: { id: string; value: string; onChange: (value: string) => void; invalid: boolean; text: Copy }) {
  const zones = useMemo(() => {
    const common = ['Asia/Tehran', 'Europe/Istanbul', 'Asia/Dubai', 'Europe/Moscow', 'Europe/London', 'UTC'];
    let all: string[] = [];
    try { all = Intl.supportedValuesOf('timeZone'); } catch { /* The common list also supports older engines. */ }
    return [...new Set([...common, value, ...all])].filter(Boolean);
  }, [value]);
  return <div className={`${styles.field} ${styles.full}`}><label htmlFor={id}>{text('timezone')}</label><select id={id} dir="ltr" value={value} onChange={event => onChange(event.target.value)} aria-invalid={invalid || undefined} aria-describedby={invalid ? `${id}-error` : `${id}-help`}>{zones.map(zone => <option key={zone} value={zone}>{zone}</option>)}</select><small id={`${id}-help`}>{text('timezoneHelp')}</small>{invalid && <small id={`${id}-error`} className={styles.fieldError}>{text('invalidTimezone')}</small>}</div>;
}

function AvatarField({ name, value, onChange, onBusyChange, text }: { name: string; value: string | null; onChange: (value: string | null) => void; onBusyChange: (busy: boolean) => void; text: Copy }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const decodedRef = useRef<DecodedAvatar | null>(null);
  const generation = useRef(0);
  const dragDepth = useRef(0);
  const [decoded, setDecoded] = useState<DecodedAvatar | null>(null);
  const [loading, setLoading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<PersonalSettingsKey | null>(null);
  const errorId = useId();
  useEffect(() => { onBusyChange(loading || !!decoded); }, [loading, decoded, onBusyChange]);
  useEffect(() => () => { generation.current += 1; decodedRef.current?.dispose(); decodedRef.current = null; }, []);
  const close = () => { generation.current += 1; decodedRef.current?.dispose(); decodedRef.current = null; setDecoded(null); setLoading(false); };
  const choose = async (files: FileList | null) => {
    if (!files?.length) return;
    setError(null);
    if (files.length !== 1) { setError('onePhoto'); return; }
    const token = ++generation.current;
    decodedRef.current?.dispose(); decodedRef.current = null; setDecoded(null); setLoading(true);
    try {
      const image = await decodeAvatar(files[0]);
      if (token !== generation.current) { image.dispose(); return; }
      decodedRef.current = image; setDecoded(image);
    } catch { if (token === generation.current) setError('photoError'); }
    finally { if (token === generation.current) setLoading(false); }
  };
  return <>
    <div className={styles.photoDrop} data-drag-over={dragOver} onDragEnter={event => { event.preventDefault(); dragDepth.current += 1; setDragOver(true); }} onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; }} onDragLeave={event => { event.preventDefault(); dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragOver(false); }} onDrop={event => { event.preventDefault(); dragDepth.current = 0; setDragOver(false); void choose(event.dataTransfer.files); }}>
      <div className={styles.photoCircle}><UserAvatar name={name} src={value} size={94} /><span aria-hidden="true"><ImagePlus size={18} /></span></div>
      <div className={styles.photoDetails}><p>{text('photoHelp')}</p><small>{text('photoFormat')}</small><div className={styles.photoButtons}><button type="button" className={styles.secondaryButton} onClick={() => inputRef.current?.click()} aria-describedby={error ? errorId : undefined} disabled={loading}>{loading ? <LoaderCircle className={styles.spinner} size={16} /> : <Upload size={16} />}{text(loading ? 'readingPhoto' : value ? 'replacePhoto' : 'choosePhoto')}</button>{value && <button type="button" className={styles.removeButton} onClick={() => { setError(null); onChange(null); }} disabled={loading}><Trash2 size={16} />{text('removePhoto')}</button>}</div></div>
      <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" className={styles.fileInput} tabIndex={-1} aria-label={text('choosePhoto')} onChange={event => { void choose(event.target.files); event.target.value = ''; }} />
    </div>
    {error && <p id={errorId} role="alert" className={styles.fieldError}>{text(error)}</p>}
    {decoded && <AvatarCropDialog avatar={decoded} text={text} onCancel={close} onApply={photo => { onChange(photo); close(); }} />}
  </>;
}

function AvatarCropDialog({ avatar, text, onCancel, onApply }: { avatar: DecodedAvatar; text: Copy; onCancel: () => void; onApply: (value: string) => void }) {
  const id = useId();
  const alive = useRef(true);
  const drag = useRef<{ id: number; x: number; y: number; crop: AvatarCrop; size: number } | null>(null);
  const [crop, setCrop] = useState<AvatarCrop>({ ...DEFAULT_AVATAR_CROP });
  const [circle, setCircle] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  // Modal creates its portal after this component's first effect. A callback
  // ref paints when the actual canvas attaches, including that delayed mount.
  const canvasRef = useCallback((canvas: HTMLCanvasElement | null) => {
    if (!canvas) return;
    try { drawAvatarPreview(canvas, avatar, crop, 512); setError(false); } catch { setError(true); }
  }, [avatar, crop]);
  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
  const onPointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    if (busy || drag.current || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, crop: { ...crop }, size: event.currentTarget.getBoundingClientRect().width };
  };
  const onPointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    const state = drag.current; if (!state || state.id !== event.pointerId || !state.size) return;
    const { maxOffsetX: xRange, maxOffsetY: yRange } = calculateAvatarCrop(avatar.width, avatar.height, state.crop, 512);
    setCrop(current => ({ ...current, offsetX: xRange > .001 ? clamp(state.crop.offsetX + (event.clientX - state.x) * (512 / state.size) / xRange, -1, 1) : 0, offsetY: yRange > .001 ? clamp(state.crop.offsetY + (event.clientY - state.y) * (512 / state.size) / yRange, -1, 1) : 0 }));
  };
  const stopDrag = (event: PointerEvent<HTMLCanvasElement>) => { if (drag.current?.id === event.pointerId) drag.current = null; };
  const cancel = () => { alive.current = false; onCancel(); };
  const apply = async () => {
    if (busy) return;
    setBusy(true); setError(false);
    try { const data = await encodeAvatar(avatar, crop); if (alive.current) { alive.current = false; onApply(data); } }
    catch { if (alive.current) setError(true); }
    finally { if (alive.current) setBusy(false); }
  };
  return <Modal title={text('cropPhoto')} onClose={cancel} className={styles.cropModal}>
    <div className={styles.cropContent}>
      <p id={`${id}-help`} className={styles.cropHelp}>{text('cropHelp')}</p>
      <div className={styles.cropStage} data-circle={circle}><canvas ref={canvasRef} width={512} height={512} aria-label={text('cropPreview')} aria-describedby={`${id}-help`} role="img" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={stopDrag} onPointerCancel={stopDrag} onLostPointerCapture={stopDrag} /><span className={styles.cropMask} aria-hidden="true" /><span className={styles.cropGrid} aria-hidden="true" /></div>
      <div className={styles.cropToolbar}><button type="button" className={styles.secondaryButton} onClick={() => setCrop(current => ({ ...current, rotation: ((current.rotation + 90) % 360) as AvatarCrop['rotation'], offsetX: 0, offsetY: 0 }))} disabled={busy}><RotateCw size={17} />{text('rotate')}</button><button type="button" className={styles.secondaryButton} onClick={() => setCrop({ ...DEFAULT_AVATAR_CROP })} disabled={busy}><RotateCcw size={17} />{text('resetCrop')}</button><button type="button" className={styles.shapeButton} aria-pressed={circle} aria-label={text('circularPreview')} onClick={() => setCircle(current => !current)}><span data-circle={circle} aria-hidden="true" /></button></div>
      <div className={styles.cropControls}>{(['zoom', 'offsetX', 'offsetY'] as const).map(key => <label key={key} htmlFor={`${id}-${key}`}><span>{text(key === 'zoom' ? 'zoom' : key === 'offsetX' ? 'horizontalPosition' : 'verticalPosition')}<bdi>{`${Math.round(crop[key] * 100)}%`}</bdi></span><input id={`${id}-${key}`} type="range" min={key === 'zoom' ? 1 : -1} max={key === 'zoom' ? 3 : 1} step={.01} value={crop[key]} dir="ltr" onChange={event => setCrop(current => ({ ...current, [key]: Number(event.target.value) }))} disabled={busy} /></label>)}</div>
      {error && <p className={styles.fieldError} role="alert">{text('photoError')}</p>}
      <div className={styles.cropActions}><button type="button" className={styles.secondaryButton} onClick={cancel}>{text('cancel')}</button><button type="button" className={styles.primaryButton} onClick={() => void apply()} disabled={busy || error}>{busy ? <LoaderCircle className={styles.spinner} size={17} /> : <Check size={17} />}{text('usePhoto')}</button></div>
    </div>
  </Modal>;
}

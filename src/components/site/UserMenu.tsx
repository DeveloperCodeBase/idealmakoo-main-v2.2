'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Bell, ChevronDown, ChevronRight, LayoutDashboard, LogOut, Settings2, ShieldCheck, UserRound } from 'lucide-react';
import { useApp } from '@/components/providers/AppProvider';
import { accountText } from '@/components/account/account-copy';
import { UserAvatar } from '@/components/account/UserAvatar';
import { Modal } from '@/components/ui/Primitives';
import { roleLandingRoute } from '@/lib/auth';
import styles from './UserMenu.module.css';

/** A native viewport dialog keeps account navigation usable above glass and 3D surfaces. */
export default function UserMenu({ workspace = false }: { workspace?: boolean }) {
  const app = useApp();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [app.pathname, app.locale, app.session?.id]);
  const session = app.session;
  if (!session) return null;
  const text = (key: string) => accountText(app.locale, key, app.t);
  const settings = app.userSettings?.ownerId === session.id ? app.userSettings : null;
  const name = app.displayName || session.name;
  // The narrow layout visibly shows the avatar initials while the full name is
  // hidden. Voice users must be able to activate the label they can see.
  const initials = name.trim().split(/\s+/u).filter(Boolean).slice(0, 2).map(part => Array.from(part)[0]).join('').toLocaleUpperCase() || 'IM';
  const staff = session.role !== 'customer';
  const personalBase = workspace && staff ? 'admin' : 'account';
  const links = [
    { path: `${personalBase}/profile`, label: text('profile'), icon: UserRound },
    { path: `${personalBase}/preferences`, label: text('personalPreferences'), icon: Settings2 },
    { path: 'account/notifications', label: text('notifications'), icon: Bell },
    { path: 'account/security', label: text('security'), icon: ShieldCheck },
    { path: 'account', label: text('overview'), icon: LayoutDashboard },
    ...(staff ? [{ path: roleLandingRoute(session.role), label: text('staffWorkspace'), icon: LayoutDashboard }] : []),
  ];
  return <>
    <button type="button" className={`${styles.trigger} ${workspace ? styles.workspaceTrigger : styles.siteTrigger}`} aria-label={`${text('profileMenu')} · ${name} · ${initials}`} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)} title={name}>
      <UserAvatar name={name} src={settings?.profile.avatar} size={32} decorative />
      <span className={styles.triggerName} dir="auto">{name}</span>
      <ChevronDown className={styles.triggerChevron} size={13} aria-hidden="true" />
    </button>
    {open && <Modal title={text('personalAccount')} onClose={() => setOpen(false)} className={styles.dialog}>
      <div className={styles.identity}>
        <UserAvatar name={name} src={settings?.profile.avatar} size={62} decorative />
        <div><strong dir="auto">{name}</strong><span dir="ltr">{session.email}</span><small>{text(`role_${session.role}`)}</small></div>
      </div>
      <nav className={styles.links} aria-label={text('personalAccount')} dir={app.dir}>
        {links.map(({ path, label, icon: Icon }) => <Link key={path} href={app.href(path)} onClick={() => setOpen(false)}><Icon size={19} aria-hidden="true" /><span>{label}</span><ChevronRight className={styles.directionArrow} size={16} aria-hidden="true" /></Link>)}
      </nav>
      <button type="button" className={styles.logout} onClick={() => { setOpen(false); app.signOut(); }}><LogOut size={18} aria-hidden="true" />{text('logout')}</button>
    </Modal>}
  </>;
}

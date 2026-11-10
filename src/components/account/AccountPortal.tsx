'use client';
import Link from "next/link";
import { safeAccountReturn, withAccountReturn } from "@/lib/account-return";
import { demoMode } from "@/lib/api";
import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowRight, Bell, Bookmark, Building2, ChevronRight, CircleHelp, Clock3, FileText, Grid2X2, LayoutDashboard, LockKeyhole, LogOut, Menu, MessageSquare, ShieldCheck, Settings2, UserRound } from "lucide-react";
import { useApp } from "@/components/providers/AppProvider";
import { canViewRequest } from "./portal-data";
import { Modal } from '@/components/ui/Primitives';
import { UserAvatar } from "./UserAvatar";
import styles from "./account.module.css";
import drawerStyles from "@/components/site/mobile-drawer.module.css";
import {useAccountText, EmptyState} from './portal-ui';
import dynamic from 'next/dynamic';
import {AccountBodyLoading} from './AccountBodyState';
const PersonalSettings=dynamic(()=>import('./PersonalSettings').then(module=>module.PersonalSettings),{loading:AccountBodyLoading});
const ProductionOrganizations=dynamic(()=>import('./ProductionOrganizations'),{loading:AccountBodyLoading});
const OrganizationsPanel=dynamic(()=>import('./AccountPanels').then(module=>module.OrganizationsPanel),{loading:AccountBodyLoading});
const RequestsPanel=dynamic(()=>import('./AccountRequests').then(module=>module.RequestsPanel),{loading:AccountBodyLoading});
const QuickMatrix=dynamic(()=>import('./AccountPanels').then(module=>module.QuickMatrix),{loading:AccountBodyLoading});
const WishlistCenter=dynamic(()=>import('@/components/wishlists/WishlistCenter'),{loading:AccountBodyLoading});
const SavedPanel=dynamic(()=>import('./AccountPanels').then(module=>module.SavedPanel),{loading:AccountBodyLoading});
const TenderCenter=dynamic(()=>import('@/components/tenders/TenderCenter'),{loading:AccountBodyLoading});
const Bookings=dynamic(()=>import('./Bookings'),{loading:AccountBodyLoading});
const AccountDataRooms=dynamic(()=>import('@/components/resources/AccountDataRooms'),{loading:AccountBodyLoading});
const ProductionNotifications=dynamic(()=>import('./ProductionNotifications'),{loading:AccountBodyLoading});
const NotificationPreferences=dynamic(()=>import('./NotificationPreferences'),{loading:AccountBodyLoading});
const CommunicationChannels=dynamic(()=>import('./CommunicationChannels'),{loading:AccountBodyLoading});
const NotificationsPanel=dynamic(()=>import('./AccountPanels').then(module=>module.NotificationsPanel),{loading:AccountBodyLoading});
const ProductionSecurity=dynamic(()=>import('./ProductionSecurity'),{loading:AccountBodyLoading});
const SecurityPanel=dynamic(()=>import('./AccountPanels').then(module=>module.SecurityPanel),{loading:AccountBodyLoading});
const OverviewPanel=dynamic(()=>import('./AccountPanels').then(module=>module.OverviewPanel),{loading:AccountBodyLoading});
const AccountGuide=dynamic(()=>import('./AccountGuide'),{loading:AccountBodyLoading});
const nav = [
  ["", "overview", LayoutDashboard], ["profile", "profile", UserRound], ["preferences", "personalPreferences", Settings2], ["organizations", "organizations", Building2],
  ["requests", "requests", MessageSquare], ["quick-matrix", "quickMatrix", Grid2X2], ["saved", "savedItems", Bookmark],
  ["bookings", "bookings", Clock3], ["data-rooms", "dataRooms", LockKeyhole], ["tenders", "tenders", FileText], ["notifications", "notifications", Bell], ["security", "security", ShieldCheck],
] as const;

export function AccountPortal({ section = "", body }: { section: string; body?: ReactNode }) {
  const { theme, dir, locale, role, session, sessionReady, signOut, requests, saved, href, displayName, userSettings } = useApp();
  const text = useAccountText();
  const sectionName = section.split("/")[0];
  const normalized = sectionName === "overview" ? "" : sectionName === "settings" ? "preferences" : sectionName;
  const current = nav.find(item => item[0] === normalized) || nav[0];
  const ownRequests = useMemo(() => demoMode?requests.filter(request => canViewRequest(request, session)):requests, [requests, session]);
  const needsSession = ["profile", "preferences", "organizations", "security", "notifications", "data-rooms", "bookings", "tenders"].includes(normalized);
  const name = session ? displayName || session.name : text("guest");
  const avatar = userSettings?.ownerId === session?.id ? userSettings?.profile.avatar : null;
  const [mobile, setMobile] = useState(false);
  const [help,setHelp]=useState(false);
  const [returnTo,setReturnTo]=useState("");
  const loginHref=withAccountReturn(href("auth/login"),returnTo);
  useEffect(()=>{setReturnTo(safeAccountReturn(window.location.pathname+window.location.search,locale));},[section,locale]);
  useEffect(() => { setMobile(false);setHelp(false); }, [section, locale, session?.id]);
  useEffect(() => {
    const viewport = window.matchMedia('(max-width: 767px)');
    const closeOnDesktop = () => { if (!viewport.matches) setMobile(false); };
    const closeForSearch = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') setMobile(false); };
    viewport.addEventListener('change', closeOnDesktop);
    window.addEventListener('keydown', closeForSearch);
    return () => { viewport.removeEventListener('change', closeOnDesktop); window.removeEventListener('keydown', closeForSearch); };
  }, []);
  // Both layouts use the same permitted destinations, account identity and counts.
  const sidebarContent = <>
    <div className={styles.userCard}>{session ? <Link href={href("account/profile")} className={styles.userIdentity} title={text("profile")}><UserAvatar name={name} src={avatar} size={62} decorative /><strong dir="auto">{name}</strong></Link> : <><span className={styles.userAvatar}><UserRound size={23} /></span><strong>{name}</strong></>}<small dir="ltr">{session?.email || "IDEAL MAKOO"}</small><span className={styles.userStatus}><span className={styles.liveDot} />{text(session ? `role_${session.role}` : "guest")}</span></div>
    <nav aria-label={text("account")}>{nav.map(([path, label, Icon]) => <Link key={path} href={href(`account${path ? `/${path}` : ""}`)} className={current[0] === path ? styles.activeNav : ""} aria-current={current[0] === path ? "page" : undefined}><Icon size={18} /><span>{text(label)}</span>{path === "requests" && ownRequests.length > 0 && <b>{new Intl.NumberFormat(locale).format(ownRequests.length)}</b>}{path === "saved" && saved.length > 0 && <b>{new Intl.NumberFormat(locale).format(saved.length)}</b>}</Link>)}</nav>
    {session && session.role !== "customer" && <Link className={styles.sidebarWorkspace} href={href("admin")}><LayoutDashboard size={17} />{text("staffWorkspace")}</Link>}
    {session ? <button type="button" className={styles.sidebarLogout} onClick={() => { setMobile(false); signOut(); }}><LogOut size={17} />{text("logout")}</button> : <Link className={styles.sidebarLogout} href={loginHref}><LogOut size={17} />{text("signIn")}</Link>}
  </>;
  return (
    <div className={styles.portal} data-page-shell="account" data-theme={theme} dir={dir}>
      <div className={styles.portalHeading}><div><span className={styles.eyebrow}>IDEAL MAKOO · {text("account")}</span><h1>{text("portalTitle")}</h1><p>{text("portalIntro")}</p></div><Link className={styles.secondaryButton} href={href("products")}>{text("browseProducts")}<ArrowRight className={styles.directionArrow} size={17} /></Link></div>
      <button type="button" className={styles.mobileAccountMenu} aria-haspopup="dialog" aria-expanded={mobile} onClick={() => setMobile(true)}><Menu size={21} aria-hidden="true" /><span>{text("personalAccount")}<small>{text(current[1])}</small></span><ChevronRight className={styles.directionArrow} size={18} aria-hidden="true" /></button>
      <div className={styles.portalLayout}>
        <aside className={`${styles.portalSidebar} ${styles.desktopSidebar}`} data-liquid-surface="">{sidebarContent}</aside>
        <section className={styles.portalContent} aria-labelledby="portal-account-title portal-section-title">
          <div className={styles.sectionBreadcrumb}><span id="portal-account-title">{text("account")}</span><ChevronRight className={styles.directionArrow} size={13} /><span id="portal-section-title">{text(current[1])}</span><button type="button" className={styles.textLink} style={{marginInlineStart:'auto',display:'inline-flex',alignItems:'center',gap:6}} aria-haspopup="dialog" onClick={()=>setHelp(true)}><CircleHelp size={16}/>{text('pageHelp')}</button></div>
          {sessionReady && !session && <div className={styles.localNotice}><ShieldCheck size={18} /><p>{text("guestIntro")}</p><Link href={loginHref}>{text("signIn")}</Link></div>}
          {!sessionReady ? <AccountBodyLoading/> : needsSession && !session ? <EmptyState icon="profile" title={text("signIn")} body={text("guestIntro")} href={loginHref} action={text("signIn")} /> : body!=null ? <Fragment key={JSON.stringify([session?.id||'guest',role,locale,section])}>{body}</Fragment> : (normalized === "profile" || normalized === "preferences") ? <PersonalSettings key={`${session!.id}:${normalized}`} section={normalized} embedded /> : normalized === "organizations" ? !demoMode?<ProductionOrganizations key={session!.id} session={session!} requests={ownRequests}/>:<OrganizationsPanel key={session!.id} session={session!} requests={ownRequests} /> : normalized === "requests" ? <RequestsPanel requests={ownRequests} section={section} /> : normalized === "quick-matrix" ? <QuickMatrix /> : normalized === "saved" ? !demoMode&&session?<WishlistCenter/>:<SavedPanel /> : normalized === "tenders" ? <TenderCenter mode="own"/> : normalized === "bookings" ? <Bookings/> : normalized === "data-rooms" ? <AccountDataRooms/> : normalized === "notifications" ? !demoMode?<><ProductionNotifications/><NotificationPreferences key={session?.id}/><CommunicationChannels/></>:<NotificationsPanel requests={ownRequests} /> : normalized === "security" ? !demoMode?<ProductionSecurity session={session!} requests={ownRequests}/>:<SecurityPanel key={session!.id} session={session!} requests={ownRequests} /> : <OverviewPanel requests={ownRequests} name={name} />}
        </section>
      </div>
      {mobile && <Modal title={text("personalAccount")} className={`${drawerStyles.drawer} ${styles.accountDrawer}`} onClose={() => setMobile(false)}><div className={`${styles.portalSidebar} ${styles.drawerSidebar}`} onClick={event => { if (event.target instanceof Element && event.target.closest('a[href]')) setMobile(false); }}>{sidebarContent}</div></Modal>}
      {help&&<Modal title={text('pageHelp')} onClose={()=>setHelp(false)}><AccountGuide section={normalized}/></Modal>}
    </div>
  );
}

export default AccountPortal;

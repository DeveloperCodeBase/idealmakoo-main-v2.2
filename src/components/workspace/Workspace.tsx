'use client';
import dynamic from 'next/dynamic';
import {useSearchParams} from 'next/navigation';

import {demoMode} from '@/lib/api';
import {liveText} from '@/lib/live-copy';
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { Activity, ArrowUpRight, Bell, BookOpen, Box, CalendarDays, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, ClipboardList, Clock, CloudOff, Command, FileText, FolderOpen, Gauge, Globe2, GraduationCap, Image as ImageIcon, KanbanSquare, Languages, LayoutDashboard, LayoutTemplate, ListTree, Mail, Menu, MessageSquare, Moon, PanelLeftClose, PanelLeftOpen, Search, Settings, ShieldCheck, Sparkles, Sun, Users, X, BriefcaseBusiness, Handshake, ScanLine, Network, Database, LockKeyhole, UserRound, Settings2 } from 'lucide-react';
import { authorize, canonicalWorkspaceSection, roleLandingRoute } from '@/lib/auth';
import { Brand } from '@/components/site/Navigation';
import UserMenu from '@/components/site/UserMenu';
import { UserAvatar } from '@/components/account/UserAvatar';
import { accountText } from '@/components/account/account-copy';
import { siteControlCopy } from './site-control-copy';
import { roleExperience, deskCopy } from './role-content';
import { useApp } from '@/components/providers/AppProvider';
import { useWorkspaceStore } from './store';
import { WorkspaceRouteStoreProvider } from './WorkspaceRouteContext';
import { L, localized, roleNames, workspaceLocales, workspaceRoles, wt } from './i18n';
import { Modal, safeDate } from './ui';
import { useDialogPortalTarget, useViewportDialog } from '@/components/ui/dialog-runtime';
import './workspace.css';
import './workspace-role.css';

function WorkspaceModuleLoading() {
  const {locale}=useApp();
  return <div className="ws-card" role="status"><p>{liveText('loading',locale)||wt('loading',locale)}</p></div>;
}
// Keep the authorized shell/store eager. Feature code is requested only for the
// selected permitted body or an explicitly opened dialog; server policy remains authoritative.
const OperationsInsights=dynamic(()=>import('./OperationsInsights'),{loading:WorkspaceModuleLoading});
const WorkspaceAssistant=dynamic(()=>import('./WorkspaceAssistant'),{loading:()=>null});
const ProductionNotifications=dynamic(()=>import('@/components/account/ProductionNotifications'),{loading:WorkspaceModuleLoading});
const AutomationRules=dynamic(()=>import('./AutomationRules'),{loading:WorkspaceModuleLoading});
const ContextualHelp=dynamic(()=>import('./ContextualHelp'),{loading:WorkspaceModuleLoading});
const CrmGroups=dynamic(()=>import('./CrmGroups'),{loading:WorkspaceModuleLoading});
const ResourceManagement=dynamic(()=>import('./ResourceManagement'),{loading:WorkspaceModuleLoading});
const CompanyCertificatePanel=dynamic(()=>import('@/components/company/CompanyCertificatePanel'),{loading:WorkspaceModuleLoading});
const EventSessions=dynamic(()=>import('./EventSessions'),{loading:WorkspaceModuleLoading});
const CrmRouting=dynamic(()=>import('./CrmRouting'),{loading:WorkspaceModuleLoading});
const CrmInboxPanel=dynamic(()=>import('./CrmInboxPanel'),{loading:WorkspaceModuleLoading});
const TransferCenter=dynamic(()=>import('./TransferCenter'),{loading:WorkspaceModuleLoading});
const CampaignCenter=dynamic(()=>import('./CampaignCenter'),{loading:WorkspaceModuleLoading});
const NotificationTemplateCenter=dynamic(()=>import('./NotificationTemplateCenter'),{loading:WorkspaceModuleLoading});
const PrivacyCenter=dynamic(()=>import('@/components/account/PrivacyCenter'),{loading:WorkspaceModuleLoading});
const StaffManagement=dynamic(()=>import('./StaffManagement'),{loading:WorkspaceModuleLoading});
const StaffLifecycle=dynamic(()=>import('./StaffLifecycle'),{loading:WorkspaceModuleLoading});
const ProductionOrganizations=dynamic(()=>import('@/components/account/ProductionOrganizations'),{loading:WorkspaceModuleLoading});
const TenderManager=dynamic(()=>import('@/components/tenders/TenderManager'),{loading:WorkspaceModuleLoading});
const LiveMonitoring=dynamic(()=>import('./LiveMonitoring'),{loading:WorkspaceModuleLoading});
const ProductWorkspace=dynamic(()=>import('./ProductWorkspace'),{loading:WorkspaceModuleLoading});
const SiteSettings=dynamic(()=>import('./SiteSettings'),{loading:WorkspaceModuleLoading});
const CrmActivityDesk=dynamic(()=>import('./CrmOperations').then(module=>module.CrmActivityDesk),{loading:WorkspaceModuleLoading});
const CrmReports=dynamic(()=>import('./CrmOperations').then(module=>module.CrmReports),{loading:WorkspaceModuleLoading});
const CrmSuccessDesk=dynamic(()=>import('./CrmOperations').then(module=>module.CrmSuccessDesk),{loading:WorkspaceModuleLoading});
const PersonalSettings=dynamic(()=>import('@/components/account/PersonalSettings').then(module=>module.PersonalSettings),{loading:WorkspaceModuleLoading});
const SiteControlCenter=dynamic(()=>import('./SiteControlCenter').then(module=>module.SiteControlCenter),{loading:WorkspaceModuleLoading});
const Overview=dynamic(()=>import('./Overview').then(module=>module.Overview),{loading:WorkspaceModuleLoading});
const RecordsDesk=dynamic(()=>import('./Records').then(module=>module.RecordsDesk),{loading:WorkspaceModuleLoading});
const RecordDetail=dynamic(()=>import('./Records').then(module=>module.RecordDetail),{loading:WorkspaceModuleLoading});
const Pipeline=dynamic(()=>import('./Pipeline').then(module=>module.Pipeline),{loading:WorkspaceModuleLoading});
const PageBuilder=dynamic(()=>import('./CMS').then(module=>module.PageBuilder),{loading:WorkspaceModuleLoading});
const ContentStudio=dynamic(()=>import('./Studio').then(module=>module.ContentStudio),{loading:WorkspaceModuleLoading});
const MediaLibrary=dynamic(()=>import('./Studio').then(module=>module.MediaLibrary),{loading:WorkspaceModuleLoading});
const FormBuilder=dynamic(()=>import('./Editorial').then(module=>module.FormBuilder),{loading:WorkspaceModuleLoading});
const PublicationCalendar=dynamic(()=>import('./Editorial').then(module=>module.PublicationCalendar),{loading:WorkspaceModuleLoading});
const ReviewDesk=dynamic(()=>import('./Editorial').then(module=>module.ReviewDesk),{loading:WorkspaceModuleLoading});
const TranslationDesk=dynamic(()=>import('./Editorial').then(module=>module.TranslationDesk),{loading:WorkspaceModuleLoading});
const MigrationRegistry=dynamic(()=>import('./Administration').then(module=>module.MigrationRegistry),{loading:WorkspaceModuleLoading});
const Monitoring=dynamic(()=>import('./Administration').then(module=>module.Monitoring),{loading:WorkspaceModuleLoading});
const RoleMatrix=dynamic(()=>import('./Administration').then(module=>module.RoleMatrix),{loading:WorkspaceModuleLoading});
const WorkspaceSettings=dynamic(()=>import('./Administration').then(module=>module.WorkspaceSettings),{loading:WorkspaceModuleLoading});
const CrmTools=dynamic(()=>import('./CrmTools').then(module=>module.CrmTools),{loading:WorkspaceModuleLoading});

const navGroups = [
  { key: 'personalAccount', items: [
    { key: 'profile', path: 'profile', icon: UserRound },
    { key: 'preferences', path: 'preferences', icon: Settings2 },
  ] },
  { key: 'content', items: [
    { key: 'overview', path: '', icon: LayoutDashboard },
    { key: 'site-control', path: 'content', icon: LayoutTemplate },
    { key: 'ai', path: 'ai', icon: Sparkles },
    { key: 'pages', path: 'pages', icon: LayoutTemplate },
    { key: 'products', path: 'products', icon: Box },
    { key: 'research', path: 'research', icon: BookOpen },
    { key: 'knowledge', path: 'knowledge', icon: BookOpen },
    { key: 'glossary', path: 'glossary', icon: BookOpen },
    { key: 'news', path: 'news', icon: FileText },
    { key: 'events', path: 'events', icon: CalendarDays },
    { key: 'resources', path: 'resources', icon: FolderOpen },
    { key: 'media', path: 'media', icon: ImageIcon },
    { key: 'translations', path: 'translations', icon: Languages },
    { key: 'reviews', path: 'reviews', icon: ShieldCheck },
    { key: 'publications', path: 'publications', icon: CalendarDays },
    { key: 'forms', path: 'forms', icon: ClipboardList },
    { key: 'menus', path: 'menus', icon: ListTree },
    { key: 'hr', path: 'hr', icon: BriefcaseBusiness },
  ] },
  { key: 'operations', items: [
    { key: 'crm', path: 'crm', icon: Gauge },
    { key: 'leads', path: 'crm/leads', icon: Users },
    { key: 'accounts', path: 'crm/accounts', icon: Network },
    { key: 'contacts', path: 'crm/contacts', icon: Users },
    { key: 'opportunities', path: 'crm/opportunities', icon: KanbanSquare },
    { key: 'activities', path: 'crm/activities', icon: Clock },
    { key: 'quotes', path: 'crm/quotes', icon: FileText },
    { key: 'pricebooks', path: 'crm/pricebooks', icon: BookOpen },
    { key: 'samples', path: 'crm/samples', icon: ScanLine },
    { key: 'handoffs', path: 'crm/handoffs', icon: BriefcaseBusiness },
    { key: 'partners', path: 'crm/partners', icon: Handshake },
    { key: 'tickets', path: 'crm/cases', icon: MessageSquare },
    { key: 'segments', path: 'crm/segments', icon: Users },
    { key: 'campaigns', path: 'crm/campaigns', icon: Mail },
    { key: 'inbox', path: 'crm/inbox', icon: MessageSquare },
    { key: 'automations', path: 'crm/automations', icon: Network },
    { key: 'success', path: 'crm/customer-success', icon: Handshake },
    { key: 'reports', path: 'crm/reports', icon: Gauge },
    { key: 'data', path: 'crm/data', icon: Database },
  ] },
  { key: 'system', items: [
    { key: 'monitoring', path: 'monitoring', icon: Activity },
    { key: 'communications', path: 'communications', icon: Bell },
    { key: 'staff', path: 'staff', icon: Users },
    { key: 'roles', path: 'roles', icon: ShieldCheck },
    { key: 'migration', path: 'migration', icon: Globe2 },
    { key: 'settings', path: 'settings', icon: Settings },
  ] },
];

export function Workspace({ section = '', body }: { section: string; body?: ReactNode }) {
  const app=useApp();
  return <WorkspaceScreen key={`${app.session?.id||'guest'}:${app.role}`} section={section} body={body}/>;
}
function WorkspaceScreen({section,body}:{section:string;body?:ReactNode}) {
  const app = useApp();
  const searchParams=useSearchParams();
  const openedRecord=useRef('');
  const { locale, dir, theme, role, notify } = app;
  const store = useWorkspaceStore(locale, role, notify, app.session?.id || role, app.session || {});
  const active = canonicalWorkspaceSection(section) || 'overview';
  const routeAllowed=authorize(role,section);
  const label=(key:string)=>key==='site-control'?localized(siteControlCopy.title,locale):wt(key,locale);
  const personalSettings = app.userSettings?.ownerId === app.session?.id ? app.userSettings : null;
  const collapsed = personalSettings?.preferences.sidebar === 'collapsed';
  const compact = personalSettings ? personalSettings.preferences.density === 'compact' : store.state.settings.compact;
  const [mobile, setMobile] = useState(false);
  const [mobileViewport, setMobileViewport] = useState(false);
  const sidebarCollapsed = collapsed && !mobileViewport;
  const mobileMenuRef = useRef<HTMLButtonElement>(null);
  const mobileCloseRef = useRef<HTMLButtonElement>(null);
  const mobileDialogRef = useRef<HTMLDialogElement>(null);
  const dialogTarget = useDialogPortalTarget();
  const [groups, setGroups] = useState<Record<string, boolean>>({ personalAccount: true, content: true, operations: true, system: true });
  const [command, setCommand] = useState(false);
  const [search, setSearch] = useState('');
  const [help, setHelp] = useState(false);
  const [notifications, setNotifications] = useState(false);
  const [readNotifications, setReadNotifications] = useState(false);
  const [detail, setDetail] = useState<string | null>(null);
  const [dataCollection, setDataCollection] = useState('leads');
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => { setMobile(false); setNotifications(false); }, [section, locale]);
  const linkedRecord=searchParams.get('record')||'';
  useEffect(()=>{if(!store.loaded||!linkedRecord||openedRecord.current===linkedRecord)return;const found=store.state.records.find(record=>record.id===linkedRecord||record.requestId===linkedRecord);if(found){openedRecord.current=linkedRecord;setDetail(found.id);}},[linkedRecord,store.loaded,store.state.records]);
  useEffect(() => {
    const viewport = window.matchMedia('(max-width: 980px)');
    const syncViewport = () => {
      setMobileViewport(viewport.matches);
      if (!viewport.matches) setMobile(false);
    };
    syncViewport();
    viewport.addEventListener('change', syncViewport);
    return () => viewport.removeEventListener('change', syncViewport);
  }, []);
  // The native top layer keeps the glass drawer above every page stacking
  // context and makes background focus/scroll restoration one shared lifecycle.
  useViewportDialog(mobileDialogRef, mobile && mobileViewport, dialogTarget,
    () => setMobile(false), { initialFocus: mobileCloseRef });
  useEffect(() => { const handler = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setMobile(false); setCommand(previous => !previous); } if (event.key === 'Escape') setMobile(false); }; window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler); }, []);
  const href = (path: string) => `/${locale}/admin${path ? `/${path}` : ''}`;
  const current = store.state.records.find(record => record.id === detail);
  const visibleGroups=navGroups.map(group=>({...group,items:group.items.filter(item=>authorize(role,item.path))})).filter(group=>group.items.length);
  const menus = visibleGroups.flatMap(group => group.items);
  const searchMenus = menus.filter(item => label(item.key).toLocaleLowerCase(locale).includes(search.toLocaleLowerCase(locale)));
  const searchRecords = search ? store.state.records.filter(record => record.status !== 'archived' && `${localized(record.title, locale)} ${record.id} ${record.organization || ''}`.toLocaleLowerCase(locale).includes(search.toLocaleLowerCase(locale))).slice(0, 8) : [];
  const count = (key: string) => key === 'reviews' ? store.state.records.filter(r => r.status === 'review').length : key === 'leads' ? store.state.records.filter(r => r.collection === 'leads' && r.status === 'new').length : 0;
  const toggleCollapse = async () => { const result = await app.savePreferences({ sidebar: collapsed ? 'expanded' : 'collapsed' }); if (!result.ok) notify(accountText(locale, 'storageError', app.t)); };
  const renderSection = () => {
    if(!store.loaded)return <div className="ws-card" role="status"><p>{store.error||liveText('loading',locale)||wt('loading',locale)}</p>{store.error&&<button className="btn" onClick={()=>void store.refresh().catch(()=>{})}>{wt('refresh',locale)}</button>}</div>;
    if (!routeAllowed) return <div className="ws-card ws-access-card"><span><LockKeyhole size={38}/></span><h2>{wt('denied',locale)}</h2><p>{localized(deskCopy.accessNote,locale)}</p><Link href={`/${locale}/${roleLandingRoute(role)}`} className="btn">{wt('workspace',locale)}<ArrowUpRight size={17}/></Link></div>;
    if(body!=null)return <WorkspaceRouteStoreProvider store={store}><Fragment key={JSON.stringify([app.session?.id||'guest',role,locale,section])}>{body}</Fragment></WorkspaceRouteStoreProvider>;
    if(active==='profile'||active==='preferences')return <PersonalSettings key={`${app.session?.id}:${active}`} section={active} embedded/>;
    if(active==='site-control')return <SiteControlCenter key={`${role}-${locale}-${store.loaded}`} store={store}/>;
    if(!demoMode&&active==='activities')return <CrmActivityDesk store={store}/>;
    if(!demoMode&&active==='reports')return <><CrmReports store={store}/><OperationsInsights key={`${app.session?.id}:${locale}`} store={store}/></>;
    if(!demoMode&&active==='success')return <CrmSuccessDesk store={store}/>;
    if(!demoMode&&active==='inbox')return <CrmInboxPanel store={store}/>;
    if(!demoMode&&active==='data')return <TransferCenter store={store}/>;
    if(!demoMode&&(active==='segments'||active==='campaigns'))return <CampaignCenter store={store} section={active}/>;
    if(!demoMode&&active==='communications')return <NotificationTemplateCenter key={`${app.session?.id}-${role}-${locale}`} store={store}/>;
    if(!demoMode&&active==='accounts')return <><CrmTools collection="accounts" store={store}/><RecordsDesk collection="accounts" store={store}/>{app.session&&store.permit('edit','accounts')&&app.session.crmAccess?.permissions.contact&&<ProductionOrganizations session={app.session} manage onChanged={()=>store.refresh()}/>}</>;
    if(!demoMode&&active==='partners')return <><CrmTools collection="partners" store={store}/><RecordsDesk collection="partners" store={store}/>{app.session&&store.permit('view','partners')&&<TenderManager session={app.session} onChanged={()=>store.refresh()}/>}</>;
    if (active === 'overview' || active === 'crm' || active === 'reports') return <><Overview store={store} crm={active !== 'overview'}/>{!demoMode&&active==='overview'&&<OperationsInsights key={`${app.session?.id}:${locale}`} store={store}/>}</>;
    if (active === 'pages') return <PageBuilder key={`${locale}-${store.loaded}`} store={store}/>;
    if(active==='automations'&&!demoMode)return <AutomationRules store={store}/>;
    if (active === 'products') return <ProductWorkspace store={store}/>;
    if (active === 'ai') return <ContentStudio store={store}/>;
    if (active === 'media') return <MediaLibrary store={store}/>;
    if (active === 'resources'&&!demoMode) return <><ResourceManagement store={store}/><CompanyCertificatePanel store={store}/></>;
    if (active === 'events'&&!demoMode) return <><RecordsDesk collection="events" store={store}/><EventSessions store={store}/></>;
    if (active === 'translations') return <TranslationDesk store={store}/>;
    if (active === 'reviews') return <ReviewDesk store={store}/>;
    if (active === 'publications') return <PublicationCalendar store={store}/>;
    if (active === 'forms') return <FormBuilder store={store}/>;
    if (active === 'menus') return <SiteSettings key={`menus-${locale}`} store={store} mode="menus"/>;
    if (active === 'samples'&&!demoMode) return <RecordsDesk collection="samples" store={store}/>;
    if (active === 'opportunities' || active === 'samples') return <><CrmTools key={`tools-${active}`} store={store} collection={active}/><Pipeline key={active} store={store} collection={active}/></>;
    if (active === 'monitoring'&&!demoMode) return <LiveMonitoring store={store} section={section.split('/').filter(Boolean).at(-1)==='monitoring'?'overview':section.split('/').filter(Boolean).at(-1)||'overview'}/>;
    if (active === 'monitoring') return <Monitoring store={store} section={section.split('/').filter(Boolean).at(-1) === 'monitoring' ? 'overview' : section.split('/').filter(Boolean).at(-1) || 'overview'}/>;
    if(active==='staff'&&!demoMode)return <><StaffManagement store={store}/>{app.session&&(role==='admin'||role==='superAdmin')&&<StaffLifecycle session={app.session} onChanged={()=>store.refresh()}/>}<CrmGroups store={store} kind="teams"/><CrmGroups store={store} kind="territories"/><CrmRouting store={store}/></>;
    if (active === 'roles') return <RoleMatrix store={store}/>;
    if (active === 'settings') return <><SiteSettings key={`settings-${locale}`} store={store} mode="settings"/><WorkspaceSettings store={store}/>{!demoMode&&<PrivacyCenter/>}</>;
    if (active === 'data') return <><label className="field" style={{maxWidth:420}}><span>{wt('type',locale)}</span><select className="input" value={dataCollection} onChange={event => setDataCollection(event.target.value)}>{['leads','accounts','contacts','activities','opportunities','quotes','pricebooks','samples','handoffs','partners','tickets','campaigns'].map(collection => <option key={collection} value={collection}>{wt(collection,locale)}</option>)}</select></label><CrmTools key={dataCollection} collection={dataCollection} store={store}/><WorkspaceSettings store={store} transferOnly/></>;
    if (active === 'migration') return <MigrationRegistry store={store}/>;
    return <><CrmTools collection={active} key={`tools-${active}`} store={store}/><RecordsDesk collection={active} key={active} store={store}/></>;
  };
  const sidebar = (
    <aside id="workspace-sidebar" className={`ws-sidebar glass ${mobile ? 'ws-sidebar-open' : ''}`} onClick={event => { if (event.target instanceof Element && event.target.closest('a[href]')) setMobile(false); }}><div className="ws-window-dots" aria-hidden="true"><i/><i/><i/></div><div className="ws-brand"><Brand small/><button ref={mobileCloseRef} type="button" className="ws-icon-button ws-mobile-close" onClick={() => setMobile(false)} aria-label={wt('close', locale)}><X size={18}/></button></div><button className="ws-sidebar-toggle ws-icon-button" onClick={toggleCollapse} disabled={!app.settingsReady} aria-label={wt(collapsed ? 'expandSidebar' : 'collapseSidebar', locale)}>{collapsed ? <PanelLeftOpen size={16}/> : <PanelLeftClose size={16}/>}</button><div className="ws-sidebar-rule"/><div className="ws-sidebar-scroll"><Link className="ws-workspace-profile" href={href("profile")} title={label("profile")}><UserAvatar name={app.displayName || app.session?.name || "IM"} src={personalSettings?.profile.avatar} size={38} className="ws-personal-avatar" decorative/><div><strong dir="auto">{app.displayName || app.session?.name}</strong><span>{localized(roleNames[role]||role,locale)}</span></div><i className="ws-status-light"/></Link>
      <nav className="ws-navigation" aria-label={wt('workspace', locale)}>{visibleGroups.map(group => <div className="ws-nav-group" key={group.key}><button className="ws-group-caption" aria-expanded={groups[group.key]} onClick={() => setGroups(previous => ({ ...previous, [group.key]: !previous[group.key] }))}><span>{wt(group.key, locale)}</span><ChevronDown size={13} style={{ transform: groups[group.key] ? 'rotate(0deg)' : 'rotate(-90deg)' }}/></button>{(groups[group.key] || sidebarCollapsed) && group.items.map(item => <Link key={item.path} href={href(item.path)} className={`ws-nav-item ${active === item.key ? 'active' : ''}`} aria-current={active === item.key ? 'page' : undefined} title={label(item.key)}><span className="ws-nav-icon"><item.icon size={20}/></span><span className="ws-nav-copy">{label(item.key)}</span>{count(item.key) > 0 && <span className="ws-nav-count">{count(item.key)}</span>}</Link>)}</div>)}</nav>
      <div className="ws-sidebar-bottom"><Link className="ws-nav-item" href={`/${locale}`} title={wt('openSite', locale)}><Globe2 size={20}/><span className="ws-nav-copy">{wt('openSite', locale)}</span><ArrowUpRight size={16}/></Link><div className="ws-sidebar-rule"/>{demoMode&&role==='superAdmin'&&<label className="ws-role-selector"><span>{wt('selectRole', locale)}</span><select value={role} onChange={event => app.setRole(event.target.value)} aria-label={wt('selectRole', locale)}>{workspaceRoles.map(r => <option key={r} value={r}>{localized(roleNames[r], locale)}</option>)}</select></label>}</div>
      </div>
    </aside>
  );
  return <div className={`ws-root ws-liquid-workspace ${compact ? 'ws-compact' : ''}`} lang={locale} dir={dir} data-collapsed={sidebarCollapsed} data-role={role}>
    <div className="ws-background-orbs" aria-hidden="true"><i/><i/><i/></div>
    {mobileViewport ? mobile && dialogTarget && createPortal(
      <dialog ref={mobileDialogRef} id="workspace-mobile-drawer"
        className={`ws-root ws-liquid-workspace ws-mobile-drawer ${compact ? 'ws-compact' : ''}`}
        lang={locale} dir={dir} data-collapsed={false} data-role={role} aria-label={wt('workspace', locale)}>
        <button type="button" className="ws-mobile-scrim" tabIndex={-1}
          aria-label={wt('close', locale)} onClick={() => setMobile(false)}/>
        {sidebar}
      </dialog>, dialogTarget) : sidebar}
    <main className="ws-shell glass" id="workspace-content"><header className="ws-topbar"><button ref={mobileMenuRef} type="button" className="ws-icon-button ws-mobile-menu" onClick={() => setMobile(open => !open)} aria-haspopup="dialog" aria-expanded={mobile && mobileViewport} aria-controls="workspace-mobile-drawer" aria-label={wt('workspace', locale)}><Menu size={21}/></button><button type="button" className="ws-command-trigger" aria-label={wt('search', locale)} aria-keyshortcuts="Control+k Meta+k" onClick={() => setCommand(true)}><Search size={17}/><span>{wt('search', locale)}</span><kbd>⌘ K</kbd></button><div className="ws-topbar-date"><span className="ws-status-light"/><time suppressHydrationWarning>{safeDate(new Date().toISOString(), locale, { weekday: 'short', month: 'short', day: 'numeric' })}</time></div><div className="ws-topbar-actions">{!demoMode&&<WorkspaceAssistant key={`${app.session?.id}:${locale}:${active}`} store={store} section={active}/>}<select className="ws-language-picker" value={locale} onChange={event => app.switchLocale(event.target.value as typeof locale)} aria-label={wt('language', locale)}>{workspaceLocales.map(lang => <option key={lang} value={lang}>{({ fa: 'فا', en: 'EN', tr: 'TR', ar: 'ع', ru: 'RU' })[lang]}</option>)}</select><button className="ws-icon-button" onClick={app.toggleTheme} aria-label={localized(theme === 'dark' ? L('تم روشن','Light theme','Açık tema','الوضع الفاتح','Светлая тема') : L('تم تیره','Dark theme','Koyu tema','الوضع الداكن','Тёмная тема'), locale)}>{theme === 'dark' ? <Sun size={17}/> : <Moon size={17}/>}</button><button className="ws-icon-button" onClick={() => { setNotifications(true); setReadNotifications(true); }} aria-label={wt('notifications', locale)}><Bell size={17}/>{demoMode&&!readNotifications && <i className="ws-notification-dot"/>}</button><button className="ws-icon-button" onClick={() => setHelp(true)} aria-label={wt('help', locale)}><CircleHelp size={17}/></button><UserMenu workspace/></div></header>
      <div className="ws-heading"><div><p className="ws-breadcrumb"><span>IDEAL MAKOO</span><ChevronRight size={13}/>{label(active === 'overview' ? 'workspace' : active)}</p><h1>{active==='overview'?localized(roleExperience[role]?.title||roleNames[role],locale):label(active)}</h1></div><span className="ws-demo-badge">{demoMode?<CloudOff size={14}/>:<ShieldCheck size={14}/>} {demoMode?wt('demo',locale):store.pending?'…':liveText('secureConnected',locale)}</span></div>
      {store.storageError && <p role="alert" className="ws-storage-error">{store.error||localized(L('ذخیره‌سازی مرورگر پر یا غیرفعال است؛ برای حفظ تغییرات فایل داده را دریافت کنید.','Browser storage is full or unavailable; export your data to retain changes.','Tarayıcı depolaması dolu veya kullanılamıyor; değişiklikleri korumak için veriyi dışa aktarın.','تخزين المتصفح ممتلئ أو غير متاح؛ صدّر البيانات لحفظ التغييرات.','Хранилище браузера заполнено или недоступно; экспортируйте данные для сохранения изменений.'), locale)}</p>}
      <div className="ws-page-content" aria-busy={store.pending}>{renderSection()}</div><footer className="ws-footer"><span><i className="ws-status-light"/>{demoMode?wt('local',locale):liveText('secureConnected',locale)}</span><span>IDEAL MAKOO · {localized(L('فرانت‌اند یکپارچه','Connected frontend','Bağlantılı ön yüz','واجهة متكاملة','Единый интерфейс'), locale)}</span></footer>
    </main>
    {command && <Modal title={wt('search', locale)} onClose={() => { setCommand(false); setSearch(''); }}><div className="ws-command-dialog"><label className="ws-search"><Search size={19}/><input ref={searchRef} autoFocus value={search} onChange={event => setSearch(event.target.value)} placeholder={wt('search', locale)} aria-label={wt('search', locale)}/></label><div className="ws-command-results">{searchMenus.slice(0, 12).map(item => <Link key={item.key} href={href(item.path)} onClick={() => { setCommand(false); setSearch(''); }}><item.icon size={18}/><span>{label(item.key)}</span><ArrowUpRight size={16}/></Link>)}{searchRecords.map(record => <button key={record.id} onClick={() => { setCommand(false); setDetail(record.id); setSearch(''); }}><FileText size={18}/><span>{localized(record.title, locale)}<small><bdi>{record.id}</bdi></small></span><ArrowUpRight size={16}/></button>)}</div></div></Modal>}
    {help && <Modal title={wt('help', locale)} onClose={() => setHelp(false)}><ContextualHelp store={store} section={active} route={section} links={menus} onNavigate={()=>setHelp(false)}/></Modal>}
    {notifications && <Modal title={wt('notifications', locale)} onClose={() => setNotifications(false)}>{!demoMode?<ProductionNotifications/>:<div className="ws-notifications">{store.state.audit.slice(0, 10).map(event => <div key={event.id}><span><Bell size={18}/></span><p>{localized(event.text, locale)}<small>{safeDate(event.at, locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</small></p></div>)}</div>}</Modal>}
    {current && <RecordDetail record={current} store={store} onClose={() => setDetail(null)}/>} 
  </div>;
}

export default Workspace;

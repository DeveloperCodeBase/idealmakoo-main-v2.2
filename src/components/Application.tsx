'use client';
import dynamic from 'next/dynamic';
import {demoMode} from '@/lib/api';
import Link from 'next/link';
import{Fragment,Suspense,type ReactNode}from 'react';
import{ArrowUpRight,LockKeyhole}from 'lucide-react';
import {useApp}from '@/components/providers/AppProvider';
import Navigation,{Brand,ThemeLanguage}from '@/components/site/Navigation';
import Footer from '@/components/site/Footer';
import {usePublications,usePublicSiteSnapshot} from '@/lib/publications';
import {isPublicPathVisible} from '@/lib/public-visibility';
import {GlossaryProvider} from '@/components/content/GlossaryTerms';
import {editablePublicTargets} from '@/lib/site-targets';
import {PublicationContent} from '@/components/site/PublicationRenderer';
import{authorize,demoUsers}from '@/lib/auth';
const loading=()=> <div className="site-loading"><span className="loading-orbit"/></div>;
// Public route components are selected on the server and passed as a stable slot.
// A client lazy boundary must not replace the streamed page during store hydration.
const Assistant=dynamic(()=>import('@/components/site/Assistant'),{loading:()=>null});
const PublicEngagement=dynamic(()=>import('@/components/site/PublicEngagement'),{loading:()=>null});
function PublicView({segments,children}:{segments:string[];children:ReactNode}){const[section]=segments;const path=segments.join('/');
 const{locale,t}=useApp();const publications=usePublications();const site=usePublicSiteSnapshot();const editable=editablePublicTargets.some(target=>target.mode==='replace'&&target.slug===path);const reserved=['auth','account','admin','api','inquiry-list','compare','contact','support','sample-request','quality-report','factory-visit','cooperation','technical-selection','tools','verify-product','products','research','resources'];const override=(editable||!reserved.includes(section||''))&&path?publications.find(item=>item.kind==='page'&&item.locale===locale&&item.slug.replace(/^\/+|\/+$/g,'')===path):undefined;
 if(!demoMode&&!isPublicPathVisible(site,locale,path))return <section className="container page-content"><h1>{t('notFound')}</h1><p>{t('unavailable')}</p></section>;
 if(override&&!editable)return <><div className="container page-content" data-managed-page={path}><PublicationContent item={override}/></div><Suspense fallback={null}><PublicEngagement path={path}/></Suspense></>;
 return <>{children}<Suspense fallback={null}><PublicEngagement path={path}/></Suspense></>;
}
export default function Application({segments=[],publicContent,accountContent,workspaceContent,authContent}:{segments?:string[];publicContent?:ReactNode;accountContent?:ReactNode;workspaceContent?:ReactNode;authContent?:ReactNode}){
 const{locale,t,href,theme,role,session,sessionReady,sessionError}=useApp();const[section,...rest]=segments;const isAdmin=section==='admin';
 if(isAdmin&&!sessionReady)return loading();
 if(isAdmin&&!demoMode&&session?.mfaEnrollmentRequired)return <section className="glass access-panel"><LockKeyhole size={43}/><h1>{t('mfa')}</h1><p>{t('staffMfaRequired')}</p><Link className="btn btn-primary" href={href('account/security')}>{t('mfa')}</Link></section>;
 if(isAdmin){const active=rest.join('/');if(session&&authorize(role,active))return <><div className="site-background"/><Suspense fallback={loading()}><Fragment key={`${session.id}:${role}`}>{workspaceContent}</Fragment></Suspense></>;return <><div className="site-background"/><div className="workspace-topbar"><Brand small/><div><span className="badge">{t(demoMode?'localMode':'secureConnected')}</span><ThemeLanguage/><Link href={href()} className="text-link">{t('home')}<ArrowUpRight size={14}/></Link></div></div>{<section className="glass access-panel"><LockKeyhole size={43}/><h1>{t(session?'accessDenied':'loginTitle').replace('\n',' ')}</h1><p>{sessionError||t(demoMode?'localAuth':session?'accessDenied':'signIn')}</p><Link className="btn btn-primary" href={href('auth/login')}>{t('signIn')}<ArrowUpRight size={17}/></Link>{session&&<><Link className="btn" href={href(role==='customer'?'account':demoUsers.find(u=>u.role===role)?.route||'admin')}>{t('workspace')}</Link></>}</section>}</>;}
 if(section==='auth')return <><div className="site-background"/><header className="auth-global-bar container"><Brand fetchPriority="high"/><ThemeLanguage/></header><Suspense fallback={loading()}>{authContent}</Suspense></>;
 return <><div className="site-background"/><a className="skip-link" href="#main-content">{t('discover')}</a><Navigation/><main id="main-content">{section==='account'?<Fragment key={`${session?.id||'guest'}:${role}`}>{accountContent}</Fragment>:<GlossaryProvider><PublicView segments={segments}>{publicContent}</PublicView></GlossaryProvider>}</main><Footer/><Assistant/></>;
}

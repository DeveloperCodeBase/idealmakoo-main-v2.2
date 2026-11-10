'use client';

import Link from 'next/link';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {ArrowRight,MessageSquare,RefreshCw,ShieldCheck} from 'lucide-react';
import {useApp} from '@/components/providers/AppProvider';
import {apiClient,ApiError,networkError} from '@/lib/api';
import type {FrontSession} from '@/lib/auth';
import type {Locale} from '@/lib/i18n';
import styles from './account.module.css';

import {otpCopy} from './otp-copy';
export {otpCopy} from './otp-copy';
export interface OtpSignInResult {user?:FrontSession;csrfToken?:string;mfaRequired?:boolean;challengeToken?:string;mfaEnrollmentRequired?:boolean}
interface OtpStatus {enabled:boolean;configured:boolean;expiresIn:number;retryAfter:number}
interface Challenge {challengeToken:string;expiresIn:number;retryAfter:number}
const digits=(value:string)=>value.replace(/[۰-۹٠-٩]/g,char=>String('۰۱۲۳۴۵۶۷۸۹'.includes(char)?'۰۱۲۳۴۵۶۷۸۹'.indexOf(char):'٠١٢٣٤٥٦٧٨٩'.indexOf(char)));

/** The challenge and code remain in memory; a phone is never remembered in storage. */
export default function CustomerOtp({onSignedIn}:{onSignedIn:(result:OtpSignInResult)=>void}){
 const {locale,href}=useApp(),c=(key:keyof typeof otpCopy)=>otpCopy[key][locale as Locale];
 const [status,setStatus]=useState<OtpStatus|null>(null),[phone,setPhone]=useState(''),[name,setName]=useState(''),[consent,setConsent]=useState(false),[code,setCode]=useState('');
 const [challenge,setChallenge]=useState<Challenge|null>(null),[expires,setExpires]=useState(0),[retryAt,setRetryAt]=useState(0),[clock,setClock]=useState(Date.now());
 const [error,setError]=useState(''),[busy,setBusy]=useState(false),[checking,setChecking]=useState(true),[check,setCheck]=useState(0);
 const pending=useRef<AbortController|null>(null),lifetime=useRef(0),active=useRef(false);
 useEffect(()=>{active.current=true;const epoch=++lifetime.current;const controller=new AbortController();setChecking(true);setError('');
  void apiClient.request<OtpStatus>('/auth/otp/status',{signal:controller.signal}).then(value=>{if(active.current&&lifetime.current===epoch)setStatus(value);}).catch(reason=>{if(active.current&&lifetime.current===epoch&&!controller.signal.aborted)setError(networkError(reason,locale));}).finally(()=>{if(active.current&&lifetime.current===epoch)setChecking(false);});
  return()=>{active.current=false;lifetime.current++;controller.abort();pending.current?.abort();pending.current=null;};
 },[locale,check]);
 useEffect(()=>{if(!challenge)return;const timer=setInterval(()=>setClock(Date.now()),1000);return()=>clearInterval(timer);},[challenge]);
 const current=(epoch:number,controller:AbortController)=>active.current&&lifetime.current===epoch&&pending.current===controller&&!controller.signal.aborted;
 async function send(event?:FormEvent){
  event?.preventDefault();if(pending.current||!status?.enabled||!status.configured)return;
  const number=digits(phone).replace(/[\s()-]/g,'');if(!/^(?:\+?98|0)?9\d{9}$/.test(number)){setError(c('invalid'));return;}
  if(!consent||Date.now()<retryAt)return;
  const epoch=lifetime.current,controller=new AbortController();pending.current=controller;setBusy(true);setError('');
  try{const result=await apiClient.request<Challenge>('/auth/otp/request',{method:'POST',signal:controller.signal,body:JSON.stringify({phone:number,name:name.trim()||undefined,locale,consent:true})});
   if(!current(epoch,controller))return;setChallenge(result);setCode('');setClock(Date.now());setExpires(Date.now()+result.expiresIn*1000);setRetryAt(Date.now()+result.retryAfter*1000);
  }catch(reason){if(current(epoch,controller))setError(networkError(reason,locale));}
  finally{if(pending.current===controller){pending.current=null;if(active.current&&lifetime.current===epoch)setBusy(false);}}
 }
 async function verify(event:FormEvent){event.preventDefault();if(pending.current||!challenge||Date.now()>=expires)return;
  const epoch=lifetime.current,controller=new AbortController();pending.current=controller;setBusy(true);setError('');
  try{const result=await apiClient.request<OtpSignInResult>('/auth/otp/verify',{method:'POST',signal:controller.signal,body:JSON.stringify({challengeToken:challenge.challengeToken,code:digits(code),name:name.trim()||undefined})});if(current(epoch,controller)){setCode('');onSignedIn(result);}}
  catch(reason){if(current(epoch,controller))setError(reason instanceof ApiError&&[400,401].includes(reason.status)?c('wrong'):networkError(reason,locale));}
  finally{if(pending.current===controller){pending.current=null;if(active.current&&lifetime.current===epoch)setBusy(false);}}
 }
 const remaining=Math.max(0,Math.ceil((retryAt-clock)/1000));
 return <section className={styles.otpPanel} data-customer-otp="true"><p className={styles.authDescription}>{c('intro')}</p>
  {checking?<p role="status">{c('wait')}</p>:!status?.enabled||!status.configured?<p className={styles.fieldHint}>{c('disabled')}</p>:null}
  {!challenge?<form className={styles.authForm} onSubmit={send}>
   <label className={styles.field}><span>{c('phone')}</span><div className={styles.inputWrap}><MessageSquare size={18}/><input name="otpPhone" disabled={busy} type="tel" inputMode="tel" autoComplete="tel" dir="ltr" required maxLength={24} placeholder="09121234567" value={phone} onChange={event=>setPhone(event.target.value)}/></div></label>
   <label className={styles.field}><span>{c('name')}</span><div className={styles.inputWrap}><input name="otpName" disabled={busy} autoComplete="name" maxLength={80} value={name} onChange={event=>setName(event.target.value)}/></div></label>
   <label className={styles.checkLabel}><input type="checkbox" disabled={busy} required checked={consent} onChange={event=>setConsent(event.target.checked)}/>{c('consent')}</label>
   <div className={styles.formOptions}><Link href={href('terms')}>{locale==='fa'?'شرایط استفاده':locale==='ar'?'الشروط':locale==='tr'?'Koşullar':locale==='ru'?'Условия':'Terms'}</Link><Link href={href('privacy')}>{locale==='fa'?'حریم خصوصی':locale==='ar'?'الخصوصية':locale==='tr'?'Gizlilik':locale==='ru'?'Конфиденциальность':'Privacy'}</Link></div>
   <button className={styles.primaryButton} type="submit" disabled={busy||checking||!status?.enabled||!status.configured||!consent}>{busy?c('wait'):c('send')}<ArrowRight size={18}/></button>
  </form>:<form className={styles.authForm} onSubmit={verify}><p role="status">{c('sent')}</p><p><bdi dir="ltr">{phone}</bdi></p><label className={styles.field}><span>{c('code')}</span><input className={styles.otpInput} name="smsCode" disabled={busy} dir="ltr" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" minLength={6} maxLength={6} required value={code} onChange={event=>setCode(digits(event.target.value).replace(/\D/g,''))}/></label><p className={styles.fieldHint}>{c('expiry')} <time dateTime={new Date(expires).toISOString()}>{new Date(expires).toLocaleTimeString(locale)}</time></p>
   <button className={styles.primaryButton} type="submit" disabled={busy||code.length!==6||clock>=expires}>{busy?c('wait'):c('verify')}<ShieldCheck size={18}/></button>
   <div className={styles.formOptions}><button className="btn" type="button" disabled={busy||remaining>0} onClick={()=>void send()}><RefreshCw size={16}/>{c('resend')}{remaining>0&&` (${remaining.toLocaleString(locale)})`}</button><button type="button" className="btn" disabled={busy} onClick={()=>{setChallenge(null);setCode('');setError('');setRetryAt(0);}}>{c('change')}</button></div>
  </form>}
  {error&&<p role="alert" className={styles.inlineError}>{error}</p>}{!checking&&(!status||!status.configured)&&<button type="button" className="btn" onClick={()=>setCheck(value=>value+1)}>{c('retry')}</button>}
  <p className={styles.authBottom}><ShieldCheck size={16}/>{c('secure')}</p>
 </section>;
}

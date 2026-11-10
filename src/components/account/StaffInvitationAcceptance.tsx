'use client';
import {useState,type FormEvent} from 'react';
import {ShieldCheck} from 'lucide-react';
import {useApp} from '@/components/providers/AppProvider';
import {apiClient,networkError} from '@/lib/api';
import {localized} from '@/lib/i18n';
import type {FrontSession} from '@/lib/auth';
import styles from './account.module.css';

const copy={
 title:localized('پذیرش دعوت کارکنان','Accept a staff invitation','Personel davetini kabul et','قبول دعوة موظف','Принять приглашение сотрудника'),
 help:localized('کد یک‌بارمصرف ارسال‌شده به ایمیل همین حساب را وارد کنید. ایمیل حساب باید تأیید شده باشد. پذیرش، نشست‌های فعلی را لغو می‌کند و سپس باید دوباره وارد شوید و MFA را تکمیل کنید.','Enter the single-use code sent to this account’s verified email. Acceptance revokes existing sessions; sign in again and complete MFA afterward.','Bu hesabın doğrulanmış e-postasına gelen tek kullanımlık kodu girin. Kabul mevcut oturumları kapatır; yeniden giriş yapın ve MFA’yı tamamlayın.','أدخل الرمز لمرة واحدة المرسل إلى بريد هذا الحساب المؤكد. يؤدي القبول إلى إلغاء الجلسات؛ ادخل مجددًا وأكمل MFA.','Введите одноразовый код из письма на подтверждённую почту этого аккаунта. Принятие отзывает сеансы; войдите снова и завершите MFA.'),
 code:localized('کد دعوت','Invitation code','Davet kodu','رمز الدعوة','Код приглашения'),
 verify:localized('ابتدا ایمیل همین حساب را تأیید کنید.','Verify this account’s email first.','Önce bu hesabın e-postasını doğrulayın.','أكد بريد هذا الحساب أولًا.','Сначала подтвердите почту этого аккаунта.'),
 accepted:localized('دعوت پذیرفته شد؛ دوباره وارد شوید.','Invitation accepted; sign in again.','Davet kabul edildi; yeniden giriş yapın.','قُبلت الدعوة؛ سجّل الدخول مجددًا.','Приглашение принято; войдите снова.')
};
export default function StaffInvitationAcceptance(props:{session:FrontSession}){return <AcceptanceBody key={props.session.id} {...props}/>;}
function AcceptanceBody({session}:{session:FrontSession}){
 const app=useApp(),[token,setToken]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),tr=(key:keyof typeof copy)=>copy[key][app.locale];
 const submit=async(event:FormEvent)=>{event.preventDefault();if(busy)return;setBusy(true);setError('');try{await apiClient.request<{accepted:true;signInRequired:true;mfaEnrollmentRequired:boolean}>('/staff/invitations/accept',{method:'POST',body:JSON.stringify({token:token.trim()})});setToken('');app.notify(tr('accepted'));await app.signOut();window.location.assign(app.href('auth/login'));}catch(cause){setError(networkError(cause,app.locale));}finally{setBusy(false);}};
 if(session.role!=='customer')return null;
 return <section className={styles.panel} aria-label={tr('title')}><div className={styles.panelTitle}><h2>{tr('title')}</h2><ShieldCheck size={20}/></div><p className={styles.smallNote}>{tr('help')}</p><p><bdi>{session.email}</bdi></p>{!session.emailVerified&&<p role="status">{tr('verify')}</p>}<form onSubmit={submit}><label className={styles.field}><span>{tr('code')}</span><input type="password" dir="ltr" autoComplete="off" spellCheck={false} minLength={64} maxLength={64} pattern="[a-fA-F0-9]{64}" required value={token} onChange={event=>setToken(event.target.value.toLowerCase())} disabled={busy}/></label>{error&&<p role="alert" className={styles.inlineError}>{error}</p>}<button className={styles.primaryButton} disabled={busy||!session.emailVerified||!/^[a-f0-9]{64}$/.test(token)}>{tr('title')}</button></form></section>;
}

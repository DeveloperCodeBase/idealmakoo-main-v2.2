"use client";

import Link from "next/link";
import {apiClient,ApiError,demoMode,networkError} from "@/lib/api";
import {safeAccountReturn,withAccountReturn} from "@/lib/account-return";
import type {FrontSession} from "@/lib/auth";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowRight, Check, ChevronDown, Eye, EyeOff, Fingerprint, Lock, Mail, ShieldCheck, Sparkles, UserRound } from "lucide-react";
import { useApp } from "@/components/providers/AppProvider";
import ToothExperience from "@/components/experience/ToothExperience";
import { demoUsers, roleLandingPath, type DemoUser } from "@/lib/auth";
import { readStore, writeStore } from "@/lib/storage";
import { accountText } from "./account-copy";
import CustomerOtp,{otpCopy,type OtpSignInResult} from './CustomerOtp';
import { buildLocalAccount, digestPassword, isValidPassword, normalizeVerificationCode, PENDING_KEY, readLocalAccounts, readPendingSignIn, saveLocalAccounts, savePendingSignIn, securityKey, type PendingSignIn, type SecurityPreferences } from "./auth-storage";
import styles from "./account.module.css";

let serverChallenge: {token:string;expiresAt:number;method?:'totp'|'email'|'sms';destination?:string}|null=null;
type AuthMode = "login" | "register" | "recover" | "mfa";
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function AuthPage({ mode: rawMode }: { mode: string }) {
  const mode: AuthMode = ["register", "recover", "mfa"].includes(rawMode) ? rawMode as AuthMode : "login";
  const { locale, dir, theme, t, href, signIn, notify, acceptSession } = useApp();
  const text = (key: string) => accountText(locale, key, t);
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);
  const [remember, setRemember] = useState(false);
  const [consent, setConsent] = useState(false);
  const [verification, setVerification] = useState("");
  const [pending, setPending] = useState<PendingSignIn | null>(null);
  const [error, setError] = useState("");
  const [complete, setComplete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [authMethod,setAuthMethod]=useState<'email'|'sms'>('email');
  const [resetToken,setResetToken]=useState("");
  const [serverMfaReady,setServerMfaReady]=useState(false);
  const [returnTo,setReturnTo]=useState("");
  const authHref=(path:string)=>withAccountReturn(href(path),returnTo);
  const pendingSubmission = useRef<AbortController | null>(null);
  const contextRef = useRef({ mode, locale });
  if (contextRef.current.mode !== mode || contextRef.current.locale !== locale) contextRef.current = { mode, locale };
  const context = contextRef.current;
  const methodRef=useRef(authMethod);methodRef.current=authMethod;
  const mountedContext = useRef<typeof context | null>(null);

  useEffect(() => {
    mountedContext.current = context;
    setBusy(false);
    setError("");
    setComplete(false);
    setReturnTo(safeAccountReturn(new URLSearchParams(window.location.search).get("returnTo"),locale));
    return () => {
      if (mountedContext.current !== context) return;
      mountedContext.current = null;
      pendingSubmission.current?.abort();
      pendingSubmission.current = null;
    };
  }, [context]);

  useEffect(() => {
    setError(""); setComplete(false); setVerification("");
    if (mode !== "recover") setResetToken("");
    if (mode === "mfa") {if(demoMode)setPending(readPendingSignIn());else setServerMfaReady(!!serverChallenge&&serverChallenge.expiresAt>Date.now());}
    if(mode==="recover"&&!demoMode){const token=new URLSearchParams(window.location.search).get("token");if(token){setResetToken(token);window.history.replaceState(null,"",window.location.pathname);}}
    if (mode === "login") {
      const remembered = readStore<string>("idealmakoo.auth.remembered-email.v1", "");
      setEmail(remembered); setRemember(Boolean(remembered));
    }
  }, [mode]);

  const finishSignIn = (user: { role: string; name: string; email: string; route: string }) => {
    const signedIn = signIn(user.role, user.name, user.email);
    if (!signedIn) return;
    writeStore("idealmakoo.auth.last-sign-in.v1", { email: user.email, createdAt: new Date().toISOString() });
    notify(t("welcome"));
    router.push(roleLandingPath(user.role, locale));
  };

  const finishOtpSignIn=(result:OtpSignInResult)=>{
    if(mountedContext.current!==context||contextRef.current!==context||methodRef.current!=='sms')return;
    if(result.mfaRequired&&result.challengeToken){serverChallenge={token:result.challengeToken,expiresAt:Date.now()+5*60*1000,method:result.mfaMethod,destination:result.mfaDestination};router.push(authHref('auth/mfa'));return;}
    if(!result.user)throw new Error('Invalid sign-in response');
    acceptSession(result.user,result.csrfToken);serverChallenge=null;notify(t('welcome'));
    router.push(returnTo||roleLandingPath(result.user.role,locale));
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (mountedContext.current !== context || contextRef.current !== context || pendingSubmission.current) return;
    setError("");
    setComplete(false);
    const normalizedEmail = email.trim().toLowerCase();
    if (mode !== "mfa" && !resetToken && !emailPattern.test(normalizedEmail)) { setError(t("validEmail")); return; }
    if (mode === "register") {
      if (normalizedEmail.endsWith(".invalid")) { setError(t("invalidLogin")); return; }
      if (name.trim().length < 2) { setError(t("fieldRequired")); return; }
      if (!isValidPassword(password)) { setError(text("passwordRules")); return; }
      if (password !== confirmPassword) { setError(text("passwordMismatch")); return; }
      if (!consent) { setError(text("agreeTerms")); return; }
    }
    const controller = new AbortController();
    pendingSubmission.current = controller;
    const current = () => mountedContext.current === context && contextRef.current === context && pendingSubmission.current === controller && !controller.signal.aborted;
    setBusy(true);
    try {
      if(!demoMode){
        if(mode==='recover'){
          if(resetToken){
            if(!isValidPassword(password)||password!==confirmPassword){setError(text('passwordRules'));return;}
            await apiClient.request('/auth/password/reset',{method:'POST',signal:controller.signal,body:JSON.stringify({token:resetToken,password})});
            if(!current())return;
            setResetToken('');setPassword('');setConfirmPassword('');notify(text('passwordChanged'));router.push(href('auth/login'));
          }else{
            await apiClient.request('/auth/password/forgot',{method:'POST',signal:controller.signal,body:JSON.stringify({email:normalizedEmail,locale})});
            if(!current())return;
            setComplete(true);
          }
          return;
        }
        if(mode==='mfa'&&(!serverChallenge||serverChallenge.expiresAt<=Date.now())){setError(text('expiredStep'));return;}
        type Result={user?:FrontSession;csrfToken?:string;mfaRequired?:boolean;challengeToken?:string;mfaMethod?:'totp'|'email'|'sms';mfaDestination?:string;mfaEnrollmentRequired?:boolean};
        const result=await apiClient.request<Result>(mode==='mfa'?'/auth/mfa/verify':mode==='register'?'/auth/register':'/auth/login',{method:'POST',signal:controller.signal,body:JSON.stringify(mode==='mfa'?{challengeToken:serverChallenge?.token,code:normalizeVerificationCode(verification)}:mode==='register'?{name:name.trim(),email:normalizedEmail,password}:{email:normalizedEmail,password})});
        // Cancellation prevents stale UI adoption; it cannot undo a login or
        // Set-Cookie response that the server has already processed.
        if(!current())return;
        if(result.mfaRequired&&result.challengeToken){serverChallenge={token:result.challengeToken,expiresAt:Date.now()+5*60*1000,method:result.mfaMethod,destination:result.mfaDestination};setPassword('');router.push(authHref('auth/mfa'));return;}
        if(!result.user)throw new Error('Invalid sign-in response');
        acceptSession(result.user,result.csrfToken);serverChallenge=null;setPassword('');setVerification('');
        if(remember)writeStore('idealmakoo.auth.remembered-email.v1',normalizedEmail);else localStorage.removeItem('idealmakoo.auth.remembered-email.v1');
        notify(t('welcome'));router.push(mode==='register'||result.mfaEnrollmentRequired||result.user.mfaEnrollmentRequired?authHref('account/security'):returnTo||roleLandingPath(result.user.role,locale));return;
      }
      if (mode === "recover") {
        if (!writeStore("idealmakoo.auth.recovery.v1", { email: normalizedEmail, requestedAt: new Date().toISOString() })) throw new Error("storage");
        setComplete(true);
        return;
      }
      if (mode === "register") {
        const accounts = readLocalAccounts();
        if (accounts.some(account => account.email === normalizedEmail) || demoUsers.some(account => account.email === normalizedEmail)) { setError(text("emailExists")); return; }
        const account = await buildLocalAccount(name, normalizedEmail, password);
        if (!current()) return;
        if (!saveLocalAccounts([...accounts, account])) throw new Error("storage");
        finishSignIn({ ...account, route: "account" });
        return;
      }
      if (mode === "mfa") {
        const step = readPendingSignIn();
        if (!step) { setError(text("expiredStep")); return; }
        const preferences = readStore<SecurityPreferences>(securityKey(step.id), { mfaEnabled: false, recoveryCodes: [] });
        const code = normalizeVerificationCode(verification);
        const recoveryIndex = preferences.recoveryCodes.indexOf(code);
        if (code !== "123456" && recoveryIndex < 0) { setError(text("wrongCode")); return; }
        if (recoveryIndex >= 0) writeStore(securityKey(step.id), { ...preferences, recoveryCodes: preferences.recoveryCodes.filter((_, index) => index !== recoveryIndex) });
        sessionStorage.removeItem(PENDING_KEY);
        finishSignIn(step);
        return;
      }
      const demo = demoUsers.find(user => user.email === normalizedEmail && user.password === password);
      const local = readLocalAccounts().find(user => user.email === normalizedEmail);
      const validCredentials = demo || (local && await digestPassword(password, local.salt) === local.passwordDigest);
      if (!current()) return;
      if (!validCredentials) { setError(text("wrongCredentials")); return; }
      const user = demo || { ...local!, route: "account" };
      if (remember) writeStore("idealmakoo.auth.remembered-email.v1", normalizedEmail);
      else localStorage.removeItem("idealmakoo.auth.remembered-email.v1");
      const preferences = readStore<SecurityPreferences>(securityKey(user.id), { mfaEnabled: false, recoveryCodes: [] });
      if (user.role !== "customer" || preferences.mfaEnabled) {
        savePendingSignIn({ id: user.id, role: user.role, name: user.name, email: user.email, route: user.route });
        router.push(href("auth/mfa"));
      } else finishSignIn(user);
    } catch(error) {
      if (current()) setError(error instanceof ApiError&&error.status===401?text(mode==="mfa"?"wrongCode":"wrongCredentials"):networkError(error,locale));
    } finally {
      if (pendingSubmission.current === controller) {
        pendingSubmission.current = null;
        if (mountedContext.current === context && contextRef.current === context) setBusy(false);
      }
    }
  };

  const fillDemo = (user: DemoUser) => {
    if (mode !== "login") { router.push(`${href("auth/login")}?demo=${encodeURIComponent(user.role)}`); return; }
    setEmail(user.email); setPassword(user.password); setError("");
    notify(text("formReady"));
    document.getElementById("ideal-auth-email")?.focus();
  };

  useEffect(() => {
    if (!demoMode || mode !== "login") return;
    const demo = demoUsers.find(user => user.role === new URLSearchParams(window.location.search).get("demo"));
    if (demo) { setEmail(demo.email); setPassword(demo.password); }
  }, [mode]);

  const strength = [password.length >= 8, /\p{L}/u.test(password) && /\d/.test(password), password.length >= 12, /[^\p{L}\d]/u.test(password)].filter(Boolean).length;
  const title = mode === "register" ? text("newBeginning") : mode === "recover" ? t("recover") : mode === "mfa" ? t("mfa") : text("welcomeBack");
  const description = mode === "recover" ? text("recoverIntro") : mode === "mfa" ? text("mfaIntro") : t("loginDescription");

  return (
    <main className={styles.authPage} data-page-shell="auth" data-theme={theme} dir={dir}>
      <div className={styles.authIntro} data-auth-region="intro"><span className={styles.liveDot} />{t("brand")}<span className={styles.introSeparator} />{t("account")}</div>
      <section className={styles.authBoard} data-auth-region="columns" aria-labelledby="auth-title">
        <div className={styles.authFormPane} data-auth-region="form">
          <div className={styles.tabs}>
            <Link href={authHref("auth/login")} className={mode === "login" ? styles.activeTab : ""} aria-current={mode === "login" ? "page" : undefined}>{t("signIn")}</Link>
            <Link href={authHref("auth/register")} className={mode === "register" ? styles.activeTab : ""} aria-current={mode === "register" ? "page" : undefined}>{t("register")}</Link>
          </div>
          <span className={styles.eyebrow}>{mode === "mfa" ? "02 / 02" : `IDEAL MAKOO · ${text("professionalAccess")}`}</span>
          <h1 id="auth-title">{title}<span className={styles.accentDot} /></h1>
          <p className={styles.authDescription}>{description}</p>
          {!demoMode&&(mode==='login'||mode==='register')&&<div className={styles.authMethods} role="group" aria-label={text('professionalAccess')}><button type="button" aria-pressed={authMethod==='sms'} disabled={busy} onClick={()=>setAuthMethod('sms')}>{locale==='fa'?'ثبت‌نام / ورود با پیامک':otpCopy.sms[locale]}</button><button type="button" aria-pressed={authMethod==='email'} disabled={busy} onClick={()=>setAuthMethod('email')}>{locale==='fa'?'ثبت‌نام / ورود با ایمیل و رمز':otpCopy.email[locale]}</button></div>}
          {!demoMode&&authMethod==='sms'&&(mode==='login'||mode==='register')?<CustomerOtp key={`${locale}:${mode}`} onSignedIn={finishOtpSignIn}/>:<form className={styles.authForm} onSubmit={submit} noValidate>
            {mode === "register" && <label className={styles.field}><span>{t("name")}</span><div className={styles.inputWrap}><UserRound size={18} /><input name="name" value={name} onChange={event => setName(event.target.value)} autoComplete="name" maxLength={80} required /></div></label>}
            {mode !== "mfa" && !resetToken && <label className={styles.field}><span>{t("email")}</span><div className={styles.inputWrap}><Mail size={18} /><input id="ideal-auth-email" name="email" type="email" dir="ltr" value={email} onChange={event => setEmail(event.target.value)} autoComplete="email" inputMode="email" placeholder="you@company.com" maxLength={254} required aria-invalid={Boolean(error)} /></div></label>}
            {(mode === "login" || mode === "register" || !!resetToken) && <label className={styles.field}><span>{t("password")}</span><div className={styles.inputWrap}><Lock size={18} /><input name="password" type={showPassword ? "text" : "password"} dir="ltr" value={password} onChange={event => setPassword(event.target.value)} onFocus={() => setPasswordFocused(true)} onBlur={() => setPasswordFocused(false)} autoComplete={mode === "register" || resetToken ? "new-password" : "current-password"} minLength={demoMode?8:12} maxLength={128} required /><button type="button" onClick={() => setShowPassword(value => !value)} aria-label={text(showPassword ? "hidePassword" : "showPassword")} aria-pressed={showPassword}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></div></label>}
            {(mode === "register" || !!resetToken) && <><div className={styles.passwordStrength} role="meter" aria-valuemin={0} aria-valuemax={4} aria-valuenow={strength} aria-label={text("passwordRules")}>{[1, 2, 3, 4].map(level => <i key={level} data-active={strength >= level} />)}</div><small className={styles.fieldHint}>{text("passwordRules")}</small><label className={styles.field}><span>{text("confirmPassword")}</span><div className={styles.inputWrap}><Lock size={18} /><input name="confirmPassword" type={showPassword ? "text" : "password"} dir="ltr" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} onFocus={() => setPasswordFocused(true)} onBlur={() => setPasswordFocused(false)} autoComplete="new-password" maxLength={128} required /></div></label>{!resetToken && <label className={styles.checkLabel}><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} />{text("agreeTerms")}</label>}<div className={styles.formOptions}><Link href={href("terms")}>{t("terms")}</Link><Link href={href("privacy")}>{t("privacy")}</Link></div></>}
            {mode === "login" && <div className={styles.formOptions}><label className={styles.checkLabel}><input type="checkbox" checked={remember} onChange={event => setRemember(event.target.checked)} />{text("rememberEmail")}</label><Link href={authHref("auth/recover")}>{t("recover")}</Link></div>}
            {mode === "mfa" && <><div className={styles.mfaIcon}><Fingerprint size={36} /></div><label className={styles.field}><span>{t("mfa")}</span><input className={styles.otpInput} value={verification} onChange={event => setVerification(normalizeVerificationCode(event.target.value))} autoComplete="one-time-code" inputMode="numeric" maxLength={20} placeholder="······" dir="ltr" required aria-describedby="mfa-help" /></label><p id="mfa-help" className={styles.demoCode} style={{fontWeight:800,fontSize:'1.05rem'}}>{demoMode?t("demoCode"):serverChallenge?.method==='sms'?(locale==='fa'?<>کد پیامک شد به شمارهٔ <bdi dir="ltr">{serverChallenge.destination||'تأییدشده'}</bdi></>:<>SMS code sent to <bdi dir="ltr">{serverChallenge.destination||'your verified phone'}</bdi></>):serverChallenge?.method==='email'?(locale==='fa'?<>کد ایمیل شد به <bdi dir="ltr">{serverChallenge.destination||'ایمیل تأییدشده'}</bdi></>:<>Email code sent to <bdi dir="ltr">{serverChallenge.destination||'your verified email'}</bdi></>):(locale==='fa'?'کد برنامهٔ Authenticator را وارد کنید.':'Enter your authenticator-app code.')}</p>{!(demoMode?pending:serverMfaReady) && <p className={styles.inlineError}>{text("expiredStep")}</p>}</>}
            {error && <p className={styles.inlineError} role="alert">{error}</p>}
            {complete && <p className={styles.successMessage} role="status"><Check size={19} />{t("localRecovery")}</p>}
            <button type="submit" className={styles.primaryButton} disabled={busy || (mode === "mfa" && !(demoMode?pending:serverMfaReady))}>{busy ? text("working") : mode === "register" ? t("register") : mode === "recover" ? t("recover") : mode === "mfa" ? t("verify") : t("signIn")}<ArrowRight className={styles.directionArrow} size={18} /></button>
          </form>}
          <p className={styles.authBottom}><ShieldCheck size={16} />{mode === "register" ? text("localRegister") : t("localAuth")}</p>
          {(mode === "recover" || mode === "mfa") && <Link className={styles.textLink} href={authHref("auth/login")}>{t("signIn")}</Link>}
        </div>
        <div className={styles.authVisualPane}>
          <div className={styles.visualOverline}><span>IDEAL MAKOO</span><Sparkles size={17} /></div>
          <div className={styles.authTooth}><ToothExperience variant="auth" theme={theme} locale={locale} privacy={passwordFocused && !showPassword} authMode={mode === "register" ? "signup" : "login"} showHint={false} /></div>
          <div className={styles.visualCaption}><span className={styles.visualPill}><span className={styles.liveDot} />{t("brandSub")}</span><h2>{t("loginTitle").split("\n").map((line, index) => <span key={index}>{line}</span>)}</h2><p>{t("loginDescription")}</p></div>
        </div>
      </section>
      {demoMode && <details className={styles.demoAccounts} data-auth-region="demos">
        <summary><ShieldCheck size={18} /><span>{text("demoAccounts")}</span><b>12</b><ChevronDown size={17} /></summary>
        <p>{text("demoIntro")}</p>
        <div className={styles.demoGrid}>{demoUsers.map(user => <button type="button" key={user.id} onClick={() => fillDemo(user)}><span>{text(`role_${user.role}`)}</span><small dir="ltr">{user.email}</small><code dir="ltr">{user.password}</code></button>)}</div>
      </details>}
    </main>
  );
}

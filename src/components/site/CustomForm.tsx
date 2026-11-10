'use client';
import {networkError} from '@/lib/api';

import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { CheckCircle2, ClipboardList, Send, ShieldCheck } from 'lucide-react';
import { useApp } from '@/components/providers/AppProvider';
import { validateFormValues, type PublicFormSchema } from '@/lib/form-schema';
import { downloadJson } from '@/lib/storage';

/** Uses the immutable schema copied into the published page, with the shared request pipeline. */
export default function CustomForm({ schema }: { schema: PublicFormSchema }) {
  const { locale, t, session, createRequest, href, notify } = useApp();
  const [values, setValues] = useState<Record<string, string>>({});
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<{ id: string; formId: string; version: number; values: Record<string, string> } | null>(null);
  const key = useRef('');
  const retry = useRef<{fingerprint:string;acceptedAt:string}|null>(null);
  useEffect(() => {
    key.current = crypto.randomUUID();
    if (session) setValues(previous => ({ ...previous, name: previous.name || session.name, email: previous.email || (session.email.endsWith('.invalid') ? '' : session.email) }));
  }, [schema.id, schema.version, session?.id]);
  const set = (id: string, value: string) => setValues(previous => ({ ...previous, [id]: value }));
  const visible = validateFormValues(schema, values).values;
  const failed = {fa:'فرم ذخیره نشد؛ ورودی‌ها و فضای ذخیره‌سازی مرورگر را بررسی کنید.',en:'The form could not be saved. Check the fields and browser storage.',tr:'Form kaydedilemedi. Alanları ve tarayıcı depolamasını kontrol edin.',ar:'تعذر حفظ النموذج. تحقق من الحقول ومساحة تخزين المتصفح.',ru:'Не удалось сохранить форму. Проверьте поля и хранилище браузера.'};
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !consent) return;
    const checked = validateFormValues(schema, values);
    if (checked.errors.length) { notify(failed[locale]); return; }
    const fingerprint=JSON.stringify({formId:schema.id,version:schema.version,locale,values:checked.values});
    if(retry.current?.fingerprint!==fingerprint){key.current=crypto.randomUUID();retry.current={fingerprint,acceptedAt:new Date().toISOString()};}
    setBusy(true);
    try {
      const request = await createRequest({kind:'cms_form', name:values.name.trim(), email:values.email.trim(), organization:values.organization?.trim() || '', message:[schema.title[locale], ...schema.fields.filter(field => field.id in checked.values).map(field => `${field.label[locale]}: ${checked.values[field.id]}`)].join('\n'), productIds:[], status:'received', messages:[], formId:schema.id, formVersion:schema.version, formValues:checked.values, consent:{purpose:'request_processing',acceptedAt:retry.current.acceptedAt}, idempotencyKey:key.current || (key.current = crypto.randomUUID())});
      setReceipt({id:request.id, formId:schema.id, version:schema.version, values:checked.values});
    } catch(reason) { notify(networkError(reason,locale)); } finally { setBusy(false); }
  }
  return <section className="request-form-shell glass embedded-form"><div className="form-heading"><span className="form-icon"><ClipboardList size={25}/></span><div><span className="eyebrow">{t('localMode')}</span><h2>{schema.title[locale]}</h2></div></div>{receipt ? <div className="request-success"><CheckCircle2 size={56}/><h3>{t('requestSuccess')}</h3><div className="tracking-code" dir="ltr">{receipt.id}</div><p>{t('localForm')}</p><Link className="btn btn-primary" href={href('account/requests') + `?id=${encodeURIComponent(receipt.id)}`}>{t('viewRequests')}</Link><button className="btn" onClick={() => downloadJson(receipt, `${receipt.id}.json`)}>{t('download')}</button></div> : <form onSubmit={submit}><div className="form-grid"><label className="field"><span>{schema.fields.find(field => field.id === 'name')?.label[locale] || t('fullName')} *</span><input className="input" autoComplete="name" required minLength={2} maxLength={160} value={values.name || ''} onChange={event => set('name', event.target.value)}/></label><label className="field"><span>{schema.fields.find(field => field.id === 'email')?.label[locale] || t('email')} *</span><input className="input" type="email" dir="ltr" autoComplete="email" required maxLength={160} value={values.email || ''} onChange={event => set('email', event.target.value)}/></label>{schema.fields.filter(field => !['name','email'].includes(field.id) && field.id in visible).map(field => <label className="field" key={field.id}><span>{field.label[locale]}{field.required ? ' *' : ''}</span>{field.type === 'textarea' ? <textarea className="input" rows={5} required={field.required} maxLength={4000} value={values[field.id] || ''} onChange={event => set(field.id, event.target.value)}/> : field.type === 'select' ? <select className="input" required={field.required} value={values[field.id] || ''} onChange={event => set(field.id, event.target.value)}><option value="">{t('select')}</option>{field.options?.map(option => <option value={option} key={option}>{option}</option>)}</select> : <input className="input" type={field.type} required={field.required} maxLength={300} dir={field.type === 'email' || field.type === 'date' ? 'ltr' : undefined} value={values[field.id] || ''} onChange={event => set(field.id, event.target.value)}/>}</label>)}</div><label className="consent-row"><input type="checkbox" required checked={consent} onChange={event => setConsent(event.target.checked)}/><span>{t('consent')} <Link href={href('privacy')}>{t('privacy')}</Link></span></label><div className="form-mode-note"><ShieldCheck size={16}/><p>{t('localForm')}</p></div><button type="submit" className="btn btn-primary" disabled={busy}>{busy ? '…' : t('submit')}<Send size={17}/></button></form>}</section>;
}

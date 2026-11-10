'use client';

import Link from 'next/link';
import {useSearchParams} from 'next/navigation';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {Eye,Flag,Heart,MessageSquare,Send} from 'lucide-react';
import {useApp} from '@/components/providers/AppProvider';
import {apiClient,ApiError,demoMode,networkError} from '@/lib/api';
import {usePublications} from '@/lib/publications';
import {publicationPath} from '@/lib/publication-path';
import {withAccountReturn} from '@/lib/account-return';
import './engagement.css';

const l=(fa:string,en:string,tr:string,ar:string,ru:string)=>({fa,en,tr,ar,ru});
const copy={
 title:l('دیدگاه شما','Your feedback','Görüşünüz','رأيك','Ваш отзыв'),
 views:l('بازدید','Views','Görüntülenme','المشاهدات','Просмотры'),
 likes:l('پسند','Likes','Beğeni','الإعجابات','Нравится'),
 comments:l('دیدگاه تأییدشده','Approved comments','Onaylı yorumlar','التعليقات المعتمدة','Одобренные комментарии'),
 like:l('پسندیدن','Like','Beğen','إعجاب','Нравится'),
 unlike:l('برداشتن پسند','Unlike','Beğeniyi kaldır','إلغاء الإعجاب','Убрать отметку'),
 comment:l('متن دیدگاه','Your comment','Yorumunuz','تعليقك','Ваш комментарий'),
 send:l('ارسال برای بررسی','Submit for review','İncelemeye gönder','إرسال للمراجعة','Отправить на проверку'),
 pending:l('دیدگاه ثبت شد و پس از تأیید مسئول مربوطه منتشر می‌شود.','Your comment was saved and will appear after approval.','Yorum kaydedildi; onaylandıktan sonra yayımlanır.','حُفظ تعليقك وسيظهر بعد الموافقة.','Комментарий сохранён и появится после одобрения.'),
 note:l('دیدگاه‌ها پیش از نمایش عمومی بررسی می‌شوند. اطلاعات تماس یا اطلاعات محرمانه را در دیدگاه ننویسید.','Comments are reviewed before publication. Keep contact and confidential information out of comments.','Yorumlar yayımlanmadan önce incelenir. İletişim ve gizli bilgileri yazmayın.','تُراجع التعليقات قبل نشرها. لا تكتب معلومات اتصال أو معلومات سرية.','Комментарии проверяются перед публикацией. Не указывайте контакты и конфиденциальные данные.'),
 login:l('برای ثبت دیدگاه، پسندیدن یا گزارش وارد شوید.','Sign in to comment, like or report.','Yorum, beğeni veya bildirim için giriş yapın.','سجّل الدخول للتعليق أو الإعجاب أو الإبلاغ.','Войдите, чтобы комментировать, ставить отметки и отправлять жалобы.'),
 report:l('گزارش محتوا','Report content','İçeriği bildir','الإبلاغ عن المحتوى','Пожаловаться на материал'),
 reportComment:l('گزارش این دیدگاه','Report this comment','Bu yorumu bildir','الإبلاغ عن التعليق','Пожаловаться на комментарий'),
 reason:l('دلیل گزارش','Reason for reporting','Bildirim nedeni','سبب الإبلاغ','Причина жалобы'),
 reportSaved:l('گزارش شما برای مسئول بررسی ثبت شد.','Your report was sent to the moderation queue.','Bildiriminiz inceleme kuyruğuna alındı.','أُدرج بلاغك في قائمة المراجعة.','Жалоба поступила на проверку.'),
 cancel:l('انصراف','Cancel','Vazgeç','إلغاء','Отмена'),
 sendReport:l('ثبت گزارش','Submit report','Bildirimi gönder','إرسال البلاغ','Отправить жалобу'),
 refresh:l('تازه‌سازی','Refresh','Yenile','تحديث','Обновить'),
 latest:l('۵۰ دیدگاه تأییدشدهٔ اخیر','Latest 50 approved comments','Son 50 onaylı yorum','أحدث ٥٠ تعليقًا معتمدًا','Последние 50 одобренных комментариев'),
 empty:l('هنوز دیدگاه تأییدشده‌ای ثبت نشده است.','There are no approved comments yet.','Henüz onaylı yorum yok.','لا توجد تعليقات معتمدة بعد.','Одобренных комментариев пока нет.'),
};
interface EngagementComment{id:string;name:string;body:string;createdAt:string}
interface Engagement {views:number;likes:number;comments:EngagementComment[];commentCount:number;liked:boolean}
const utilities=new Set(['contact','support','sample-request','quality-report','factory-visit','technical-selection','compare','inquiry-list','install','verify-product','privacy','terms']);
const lists=new Set(['','products','research','resources','news','blog','events','careers','videos','media','press-kit','knowledge','glossary','page','published']);

export default function PublicEngagement({path}:{path:string}){
 const {locale,session,sessionReady,href,pathname,t}=useApp(),publications=usePublications(),params=useSearchParams();
 const id=params.get('id')||params.get('slug'),publication=id?publications.find(item=>item.locale===locale&&(item.id===id||item.slug===id)):undefined;
 const canonical=publication?publicationPath(publication):path;
 const unresolved=['page','published','products/detail','news/detail','events/detail','knowledge/detail','research/detail'].includes(path)&&!publication;
 const interactive=!!canonical&&!unresolved&&!lists.has(canonical)&&!utilities.has(canonical)&&!canonical.startsWith('tools/')&&!canonical.startsWith('cooperation/')&&!canonical.startsWith('products/category/')&&canonical!=='careers/apply';
 const key=JSON.stringify([canonical,locale,session?.id||null,sessionReady]),latest=useRef(key);latest.current=key;
 const [state,setState]=useState<{key:string;data:Engagement|null;error:string;missing:boolean}>({key:'',data:null,error:'',missing:false});
 const [body,setBody]=useState(''),[reason,setReason]=useState(''),[reportTarget,setReportTarget]=useState<string|null|undefined>(undefined),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[revision,setRevision]=useState(0);
 const mutation=useRef<AbortController|null>(null),sequence=useRef(0);
 const c=(name:keyof typeof copy)=>copy[name][locale],current=state.key===key?state:{key,data:null,error:'',missing:false};
 useEffect(()=>{if(demoMode||!sessionReady||unresolved)return;
  let active=true;const controller=new AbortController(),order=++sequence.current;setNotice('');setBusy(false);setReportTarget(undefined);setBody('');setReason('');
  const read=async()=>{try{
   if(revision===0){
    try{await apiClient.request<{recorded:boolean}>('/public/engagement/view',{method:'POST',signal:controller.signal,body:JSON.stringify({path:canonical,locale})});}
    catch(error){if(controller.signal.aborted)return;if(error instanceof ApiError&&error.status===404){if(active&&latest.current===key)setState({key,data:null,error:'',missing:true});return;}}
   }
   if(!interactive)return;
   const result=await apiClient.request<Engagement>('/public/engagement?'+new URLSearchParams({path:canonical,locale}),{signal:controller.signal});
   if(active&&latest.current===key&&sequence.current===order)setState({key,data:result,error:'',missing:false});
  }catch(error){if(active&&latest.current===key&&!controller.signal.aborted){if(error instanceof ApiError&&error.status===404)setState({key,data:null,error:'',missing:true});else setState(previous=>({key,data:previous.key===key?previous.data:null,error:networkError(error,locale),missing:false}));}}};
  void read();return()=>{active=false;controller.abort();mutation.current?.abort();mutation.current=null;};
 },[key,canonical,locale,sessionReady,unresolved,revision,interactive]);
 async function command(action:'comment'|'like'|'report',value:Record<string,unknown>){
  if(mutation.current||!session)return;const controller=new AbortController(),order=++sequence.current;mutation.current=controller;setBusy(true);setNotice('');
  try{const result=await apiClient.request<Engagement|{id:string}>('/public/engagement/'+action,{method:'POST',signal:controller.signal,body:JSON.stringify({path:canonical,locale,...value})});
   if(latest.current!==key||controller.signal.aborted||sequence.current!==order)return;
   if(action==='like'&&'likes'in result)setState({key,data:result as Engagement,error:'',missing:false});
   else{setNotice(c(action==='comment'?'pending':'reportSaved'));if(action==='comment')setBody('');else{setReportTarget(undefined);setReason('');}}
  }catch(error){if(latest.current===key&&!controller.signal.aborted)setState(previous=>({...previous,key,error:networkError(error,locale)}));}
  finally{if(mutation.current===controller){mutation.current=null;if(latest.current===key)setBusy(false);}}
 }
 function submitComment(event:FormEvent){event.preventDefault();void command('comment',{body:body.trim()});}
 if(demoMode||!interactive||current.missing)return null;
 return <section className="public-engagement container" data-public-engagement={canonical} aria-label={c('title')}><div className="glass engagement-card"><header><h2>{c('title')}</h2><div className="engagement-counts">{current.data&&<><span><Eye size={17}/>{Number(current.data.views).toLocaleString(locale)} {c('views')}</span><span><Heart size={17}/>{Number(current.data.likes).toLocaleString(locale)} {c('likes')}</span><span><MessageSquare size={17}/>{Number(current.data.commentCount).toLocaleString(locale)} {c('comments')}</span></>}</div></header>
  {current.error&&<p role="alert">{current.error} <button type="button" className="btn" onClick={()=>setRevision(value=>value+1)}>{c('refresh')}</button></p>}
  {notice&&<p className="engagement-notice" role="status">{notice}</p>}
  {session?<><div className="engagement-actions"><button type="button" className="btn" aria-pressed={!!current.data?.liked} disabled={busy||!current.data} onClick={()=>void command('like',{liked:!current.data?.liked})}><Heart size={18} fill={current.data?.liked?'currentColor':'none'}/>{c(current.data?.liked?'unlike':'like')}</button><button type="button" className="btn" disabled={busy} onClick={()=>{setReportTarget(null);setReason('');}}><Flag size={17}/>{c('report')}</button></div>
   <form onSubmit={submitComment} className="engagement-form"><label className="field"><span>{c('comment')}</span><textarea className="input" rows={4} required minLength={3} maxLength={3000} value={body} onChange={event=>setBody(event.target.value)} disabled={busy}/></label><p>{c('note')}</p><button className="btn btn-primary" type="submit" disabled={busy||body.trim().length<3}><Send size={17}/>{c('send')}</button></form>
  </>:<Link className="btn" href={withAccountReturn(href('auth/login'),pathname+(params.size?'?'+params.toString():''))}>{c('login')}</Link>}
  {session&&reportTarget!==undefined&&<form className="engagement-form" onSubmit={event=>{event.preventDefault();void command('report',{reason:reason.trim(),...(reportTarget?{commentId:reportTarget}:{})});}}><h3>{c(reportTarget?'reportComment':'report')}</h3><label className="field"><span>{c('reason')}</span><textarea className="input" rows={3} minLength={5} maxLength={1500} required value={reason} onChange={event=>setReason(event.target.value)}/></label><div className="engagement-actions"><button type="submit" className="btn btn-primary" disabled={busy||reason.trim().length<5}>{c('sendReport')}</button><button type="button" className="btn" disabled={busy} onClick={()=>setReportTarget(undefined)}>{c('cancel')}</button></div></form>}
  <section className="engagement-comments"><h3>{c('latest')}</h3>{!current.data?<p role="status">{t('loading')}</p>:current.data.comments.length?current.data.comments.map(comment=><article key={comment.id}><header><strong>{comment.name}</strong><time dateTime={comment.createdAt}>{new Date(comment.createdAt).toLocaleDateString(locale)}</time></header><p>{comment.body}</p>{session&&<button className="btn" type="button" disabled={busy} onClick={()=>{setReportTarget(comment.id);setReason('');}}><Flag size={14}/>{c('reportComment')}</button>}</article>):<p>{c('empty')}</p>}</section>
 </div></section>;
}

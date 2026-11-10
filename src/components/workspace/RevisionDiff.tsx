'use client';
import {useMemo} from 'react';
import {compareRevisionText,diffRevisions,type TextSegment} from '@/lib/revision-diff';
import {editorWorkflowCopy as copy} from './editor-workflow-copy';
import {localized,type WorkspaceLocale} from './i18n';

const display=(value:unknown)=>value===undefined?'—':typeof value==='string'?value:JSON.stringify(value,null,2);
function Text({segments,side}:{segments:TextSegment[];side:'before'|'after'}){
  return <>{segments.map((part,index)=>!part.changed?<span key={index}>{part.value}</span>:side==='before'?<del key={index}>{part.value}</del>:<ins key={index}>{part.value}</ins>)}</>;
}
export default function RevisionDiff({before,after,locale}:{before:unknown;after:unknown;locale:WorkspaceLocale}){
  const result=useMemo(()=>diffRevisions(before,after),[before,after]);
  const c=(key:keyof typeof copy)=>localized(copy[key],locale);
  return <section data-revision-diff><p className="ws-muted">{c('diffScope')}</p>{result.truncated&&<p role="status">{c('bounded')}</p>}{!result.changes.length?<p>{c('noDifference')}</p>:<div className="ws-table-wrap"><table className="ws-table" style={{tableLayout:'fixed',minWidth:560}}><thead><tr><th scope="col" style={{width:'24%'}}>{c('fieldPath')}</th><th scope="col">{c('before')}</th><th scope="col">{c('after')}</th></tr></thead><tbody>{result.changes.map((change,index)=>{
    const a=display(change.before),b=display(change.after),long=a.length>12000||b.length>12000;
    const left=a.slice(0,12000),right=b.slice(0,12000),text=typeof change.before==='string'&&typeof change.after==='string'?compareRevisionText(left,right):null;
    return <tr key={index}><th scope="row" style={{verticalAlign:'top',overflowWrap:'anywhere'}}><code dir="ltr">{change.path.join(' › ')||'/'}</code><small style={{display:'block'}}>{c(change.kind)}</small>{change.numeric&&<small style={{display:'block'}}>{c('numeric')}</small>}</th><td style={{verticalAlign:'top',whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{text?<Text segments={text.before} side="before"/>:change.kind==='added'?'—':<del>{left}</del>}{long&&<p>{c('bounded')}</p>}</td><td style={{verticalAlign:'top',whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{text?<Text segments={text.after} side="after"/>:change.kind==='removed'?'—':<ins>{right}</ins>}{(long||text?.limited)&&<p className="ws-muted">{long?c('bounded'):c('textBounded')}</p>}</td></tr>;
  })}</tbody></table></div>}</section>;
}

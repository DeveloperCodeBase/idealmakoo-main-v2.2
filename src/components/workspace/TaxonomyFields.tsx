'use client';

import {useEffect,useState} from 'react';
import type {PageDraft} from '@/data/workspace-seed';
import {Field} from './ui';
import {localized,wt,type WorkspaceLocale} from './i18n';

import {taxonomyCopy,splitTaxonomyTags,validTaxonomy} from '@/lib/content-taxonomy';
export {taxonomyCopy,splitTaxonomyTags,validTaxonomy} from '@/lib/content-taxonomy';

/** Keep the typing buffer separate so a trailing comma does not disappear. */
export default function TaxonomyFields({value,locale,disabled,resetKey,onChange}:{value?:PageDraft['taxonomy'];locale:WorkspaceLocale;disabled:boolean;resetKey:string;onChange:(value:NonNullable<PageDraft['taxonomy']>)=>void}){
 const [tags,setTags]=useState(value?.tags.join(', ')||'');
 useEffect(()=>setTags(value?.tags.join(', ')||''),[resetKey]);
 return <><Field label={localized(taxonomyCopy.category,locale)}><input className="input" maxLength={120} disabled={disabled} value={value?.category||''} onChange={event=>onChange({category:event.target.value,tags:value?.tags||[]})}/></Field><Field label={wt('tags',locale)}><input className="input" maxLength={1800} disabled={disabled} value={tags} onChange={event=>{setTags(event.target.value);onChange({category:value?.category||'',tags:splitTaxonomyTags(event.target.value)});}}/><small>{localized(taxonomyCopy.hint,locale)}</small>{!validTaxonomy(value)&&<small role="alert">{localized(taxonomyCopy.invalid,locale)}</small>}</Field></>;
}

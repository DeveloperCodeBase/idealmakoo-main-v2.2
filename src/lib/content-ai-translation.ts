import type {Locale} from './i18n';

export interface MaskedTranslation {text:string;tokens:Record<string,string>;prefix:string}
export interface TranslationPart {key:string;index:number;text:string;separator:string}

/** URLs, code, placeholders, markup and technical numbers are immutable input
 * data. Random per-request markers cannot be manufactured by source content. */
export function maskTranslation(text:string,nonce:string):MaskedTranslation {
 if(!/^[a-f0-9]{24}$/.test(nonce))throw new Error('Invalid translation marker identity');
 const prefix=`__IM_${nonce}_`;if(text.includes(prefix))throw new Error('Translation marker collision');
 const tokens:Record<string,string>={};let index=0;
 const pattern=/```[\s\S]*?```|`[^`\n]+`|https?:\/\/[^\s<>\])]+|mailto:[^\s<>\])]+|[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}|(?<=\]\()(?:\/(?!\/)|#)[^\s)]*|\{\{[^{}\n]*\}\}|\$\{[^{}\n]*\}|<\/?[A-Za-z][^>\n]*>|\b[A-Z][A-Z0-9]*(?:[-_/][A-Z0-9]+)+\b|\b[A-Z]{2,}[A-Z0-9]*\b|[0-9۰-۹٠-٩]+(?:[.,٫٬:/%°−–-][0-9۰-۹٠-٩]+)*/g;
 const value=text.replace(pattern,match=>{const marker=prefix+index+++'__';tokens[marker]=match;return marker;});
 return{text:value,tokens,prefix};
}

export function unmaskTranslation(value:string,source:MaskedTranslation):string {
 if(typeof value!=='string'||value.length>180000)throw new Error('Invalid translation output');
 let result=value;
 for(const [marker,original] of Object.entries(source.tokens)){
  const occurrences=result.split(marker).length-1;
  if(occurrences!==1)throw new Error('The translation changed a protected value');
  result=result.replace(marker,()=>original);
 }
 if(result.includes(source.prefix)||/__IM_[a-f0-9]{24}_\d+__/.test(result))throw new Error('Unexpected translation marker');
 return result;
}

/** Split at text boundaries, never within code/URL/number markers. Exact
 * separators are retained and reinserted; no source tail can disappear. */
export function splitTranslation(key:string,text:string,limit=6000):TranslationPart[] {
 if(!/^[A-Za-z0-9_.-]{1,100}$/.test(key)||!Number.isSafeInteger(limit)||limit<256)throw new Error('Invalid translation segment request');
 const parts:TranslationPart[]=[];let rest=text,index=0;
 while(rest.length>limit){
  let cut=-1,separator='';
  for(const boundary of ['\n\n','\n',' ']){
   const candidate=rest.lastIndexOf(boundary,limit);
   if(candidate>=Math.floor(limit/3)){cut=candidate;separator=boundary;break;}
  }
  if(cut<0){
   cut=limit;const start=rest.lastIndexOf('__IM_',cut),end=start>=0?rest.indexOf('__',start+5):-1;
   if(start>=0&&end>=cut)cut=start||end+2;
   if(cut>0&&/[\uD800-\uDBFF]/.test(rest[cut-1]))cut--;
  }
  parts.push({key,index:index++,text:rest.slice(0,cut),separator});rest=rest.slice(cut+separator.length);
 }
 parts.push({key,index,text:rest,separator:''});return parts;
}

export function translationLanguageCheck(value:string,locale:Locale):boolean {
 // This catches script leakage, not semantic translation quality. Human review
 // remains mandatory. Protected brand names/code/URLs are excluded upstream.
 const prose=value.replace(/__IM_[a-f0-9]{24}_\d+__/g,'');
 if(['en','tr'].includes(locale))return !/[\p{Script=Arabic}\p{Script=Cyrillic}]/u.test(prose);
 if(locale==='ru')return !/\p{Script=Arabic}/u.test(prose);
 if(['fa','ar'].includes(locale))return !/\p{Script=Cyrillic}/u.test(prose);
 return false;
}

export function parseTranslationValues(text:string,keys:string[]):Record<string,string> {
 let value:unknown;try{value=JSON.parse(text);}catch{throw new Error('The provider did not return valid JSON');}
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype)throw new Error('Invalid translation object');
 const record=value as Record<string,unknown>,actual=Object.keys(record).sort(),expected=[...keys].sort();
 if(actual.length!==expected.length||actual.some((key,index)=>key!==expected[index]))throw new Error('The translation changed its field schema');
 if(Object.values(record).some(entry=>typeof entry!=='string'||entry.length>60000))throw new Error('Invalid translation field');
 return record as Record<string,string>;
}

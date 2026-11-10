// Use the URL parser's normal serialization, but never discard query strings,
// fragments or credentials when deciding whether an audit reached its page.
export function normalizePublicPageUrl(value){
 if(typeof value!=='string'||!/^https?:\/\//i.test(value)||/[\u0000-\u0020\u007f\\]/.test(value)||/^https?:\/\/[^/?#]*@/i.test(value))throw new Error('Expected an absolute HTTP(S) page URL without credentials, query or fragment.');
 const url=new URL(value);
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.href!==url.origin+url.pathname)throw new Error('Expected an absolute HTTP(S) page URL without credentials, query or fragment.');
 return url.href;
}

export function normalizeCanonicalOrigin(value){
 const url=new URL(normalizePublicPageUrl(value));
 if(!/^https?:\/\/[^/?#]+\/?$/i.test(value)||url.pathname!=='/')throw new Error('--canonical-origin must be an HTTP(S) origin without a path, credentials, query or fragment.');
 return url.origin;
}

export function samePublicPage(expected,actual){
 try{return normalizePublicPageUrl(expected)===normalizePublicPageUrl(actual);}catch{return false;}
}

// Inventory URLs identify the probed pages. Their canonical origin may be an
// explicitly supplied public origin when the same production build runs locally.
// Resolve alternates against those expected full URLs, never canonical pathnames.
export function metadataIdentityErrors(records,canonicalOrigin){
 const origin=normalizeCanonicalOrigin(canonicalOrigin);
 const expected=records.map(record=>{try{return origin+new URL(normalizePublicPageUrl(record.url)).pathname;}catch{return null;}});
 const byUrl=new Map(records.flatMap((record,index)=>expected[index]?[[expected[index],record]]:[]));
 return records.map((record,index)=>{
  const errors=[];
  if(!record.indexed||record.httpStatus!==200)return errors;
  const canonical=expected[index];
  if(!canonical){errors.push('Indexed inventory URL has an invalid page identity.');return errors;}
  if(record.canonicals?.length===1&&!samePublicPage(canonical,record.canonicals[0]))errors.push('Canonical does not match the expected origin and inventoried page.');
  if(record.alternates?.[record.locale]&&!samePublicPage(canonical,record.alternates[record.locale]))errors.push('Self hreflang does not match the inventoried page.');
  for(const [language,href]of Object.entries(record.alternates||{})){
   if(!['fa','en','tr','ar','ru','x-default'].includes(language)){errors.push('Unknown hreflang language: '+language);continue;}
   let targetUrl;try{targetUrl=normalizePublicPageUrl(href);}catch{errors.push(`Hreflang ${language} has an invalid absolute page URL.`);continue;}
   const target=byUrl.get(targetUrl);
   if(!target||!target.indexed||target.httpStatus!==200||target.noindex||target.canonicals?.length!==1||!samePublicPage(targetUrl,target.canonicals[0])){errors.push(`Hreflang target ${language} is not an audited indexable 200 page at its expected URL.`);continue;}
   if(language!=='x-default'){
    if(target.locale!==language)errors.push(`Hreflang ${language} does not match the target locale.`);
    if(!samePublicPage(canonical,target.alternates?.[record.locale]))errors.push(`Hreflang ${language} is not reciprocal.`);
   }else if(target.locale!=='fa'||!samePublicPage(href,record.alternates.fa))errors.push('x-default does not point to the available Persian source.');
  }
  return errors;
 });
}

export function lighthouseIdentityErrors(requestedUrl,{finalDisplayedUrl,httpUrl}){
 const errors=[];
 if(!samePublicPage(requestedUrl,finalDisplayedUrl))errors.push('Lighthouse finalDisplayedUrl does not match the requested page identity.');
 if(!samePublicPage(requestedUrl,httpUrl))errors.push('Independent HTTP URL does not match the requested page identity.');
 return errors;
}

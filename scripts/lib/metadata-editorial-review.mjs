/** Compare public indexable destinations within their own language. Shared
 * authentication titles, redirect aliases and missing pages are intentional. */
export function metadataEditorialReview(records){
 const groups=(field)=>{
  const values=new Map();
  for(const record of records){
   if(record.httpStatus!==200||record.indexed!==true||record.noindex||!record.locale||!Array.isArray(record[field])||record[field].length!==1)continue;
   const value=record[field][0]?.normalize('NFC').replace(/\s+/gu,' ').trim();if(!value)continue;
   const key=JSON.stringify([record.locale,value.toLocaleLowerCase(record.locale)]);
   const known=values.get(key)||{locale:record.locale,value,urls:[]};
   if(!known.urls.includes(record.url))known.urls.push(record.url);
   values.set(key,known);
  }
  return [...values.values()].filter(group=>group.urls.length>1).map(group=>({...group,urls:group.urls.sort()})).sort((a,b)=>a.locale.localeCompare(b.locale)||a.urls[0].localeCompare(b.urls[0]));
 };
 const titles=groups('titles'),descriptions=groups('descriptions');
 return {titles,descriptions,titleGroups:titles.length,descriptionGroups:descriptions.length,affectedPages:new Set([...titles,...descriptions].flatMap(group=>group.urls)).size};
}

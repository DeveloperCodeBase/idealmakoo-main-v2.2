/** Canonical public path for a reviewed publication, shared with server routing. */
export function publicationPath(publication:{slug:string;kind:string}):string {
 const slug=publication.slug.replace(/^\/+|\/+$/g,'');
 if(publication.kind==='page')return slug==='home'?'':slug;
 const prefixes:Record<string,string>={product:'products',products:'products',research:'research',article:'research',articles:'research',resources:'resources',resource:'resources',news:'news',events:'events',event:'events',hr:'careers',knowledge:'knowledge',glossary:'glossary'};
 const section=prefixes[publication.kind]||publication.kind;
 return slug===section||slug.startsWith(section+'/')?slug:`${section}/${slug}`;
}

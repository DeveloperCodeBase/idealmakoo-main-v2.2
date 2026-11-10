import type {PageBlock,PageDraft} from '@/data/workspace-seed';
import type {WorkspaceLocale} from '@/components/workspace/i18n';

/** A missing language starts with empty authored text. Stable block identities
 * retain the source template and links; no source approval or shared binding is
 * inherited by the new, independently editable draft. */
export function createPageTranslationDraft(source:PageDraft,input:{id:string;locale:WorkspaceLocale;author:string;authorId?:string;updatedAt:string}):PageDraft {
 if(input.locale===source.locale||!input.id||input.id===source.id)throw new Error('A translation requires a separate page identity and language.');
 const blocks=source.blocks.map((sourceBlock):PageBlock=>{
  const {shared:_shared,...block}=structuredClone(sourceBlock);
  const options=block.options?{...block.options}:undefined;
  if(options){delete options.ctaLabel;delete options.secondaryLabel;}
  return{...block,title:'',body:'',...(options?{options}:{})};
 });
 return{id:input.id,slug:source.slug,locale:input.locale,title:'',summary:'',status:'draft',version:1,author:input.author,authorId:input.authorId,updatedAt:input.updatedAt,blocks};
}

function stable(value:unknown):unknown {
 if(Array.isArray(value))return value.map(stable);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([,entry])=>entry!==undefined).sort(([a],[b])=>a.localeCompare(b,'en')).map(([key,entry])=>[key,stable(entry)]));
 return value;
}
const structure=(page:PageDraft)=>page.blocks.map(block=>({
 id:block.id,type:block.type,mediaUrl:block.mediaUrl,link:block.link,formId:block.formId,formSchema:block.formSchema,hidden:block.hidden,
 options:block.options?{productIds:block.options.productIds,secondaryLink:block.options.secondaryLink,visual:block.options.visual,tone:block.options.tone}:undefined,
}));

/** Used by the server creation policy: a translator may start an independent
 * locale variant but cannot introduce media, links, layout, form bindings or a
 * shared-block capability that was absent from its existing source. */
export function isPageTranslationStructure(source:PageDraft,target:PageDraft):boolean {
 return source.id!==target.id&&source.locale!==target.locale&&source.slug===target.slug&&!target.blocks.some(block=>block.shared)&&JSON.stringify(stable(structure(source)))===JSON.stringify(stable(structure(target)));
}

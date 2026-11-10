import type {Product} from '@/data/catalog';
import type {AIJob} from '@/data/workspace-seed';
import type {AiRequest,AiResult} from '@/lib/ai-client';
import type {WorkspaceLocale} from './i18n';

export const studioModes=['text','image','video','audio','translation','rewrite','document'] as const;
export type StudioMode=typeof studioModes[number];
export const REFERENCE_LIMIT=4*1024*1024;
const raster=['image/png','image/jpeg','image/webp'];
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const text=(value:unknown,max=120)=>typeof value==='string'?value.slice(0,max):'';
const validBase64=(value:string,max:number)=>{if(!value||value.length>max)return false;const compact=value.replace(/[\r\n]/g,'');return compact.length>0&&compact.length%4===0&&/^[A-Za-z0-9+/]+={0,2}$/.test(compact);};

export function studioLink(value:unknown):string|undefined {
 if(typeof value!=='string'||!value||/[\u0000-\u0020\\]/.test(value))return;
 if(/^\/(?!\/)/.test(value))return value;
 try{const url=new URL(value);if(['http:','https:'].includes(url.protocol)&&!url.username&&!url.password)return value;}catch{/* Invalid links are never rendered. */}
}
export function productReferenceImage(value:unknown):string|undefined {
 return typeof value==='string'&&/^\/media\/[a-zA-Z0-9_./-]+\.(png|jpg|jpeg|webp)$/i.test(value)&&!value.includes('..')?value:undefined;
}
export function validStudioReference(mime:string,size:number,head:Uint8Array):boolean {
 if(!Number.isInteger(size)||size<12||size>REFERENCE_LIMIT||!raster.includes(mime))return false;
 if(mime==='image/png')return [137,80,78,71,13,10,26,10].every((value,index)=>head[index]===value);
 if(mime==='image/jpeg')return head[0]===255&&head[1]===216&&head[2]===255;
 return String.fromCharCode(...head.slice(0,4))==='RIFF'&&String.fromCharCode(...head.slice(8,12))==='WEBP';
}
export function studioImageData(value:unknown):AiRequest['imageData']|undefined {
 if(typeof value!=='string'||value.length>5600100)return;
 const match=value.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\r\n]+)$/);
 return match&&validBase64(match[2],5600000)?{mimeType:match[1],data:match[2]}:undefined;
}
export function generatedStudioImage(value:unknown):AiResult['image']|undefined {
 if(!object(value)||typeof value.url!=='string'||typeof value.mimeType!=='string'||!raster.includes(value.mimeType)||typeof value.bytes!=='number'||!Number.isInteger(value.bytes)||value.bytes<1||value.bytes>12000000)return;
 const data=value.url.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\r\n]+)$/);
 const stored=value.url.match(/^\/api\/ai\/media\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.(png|jpg|webp)$/);
 const uuid='[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
 const privateAsset=new RegExp(`^/api/v1/(?:attachments/${uuid}|media/${uuid}/content)/?$`).test(value.url);
 if(stored&&`image/${stored[1]==='jpg'?'jpeg':stored[1]}`!==value.mimeType)return;
 if(!stored&&!privateAsset&&(!data||data[1]!==value.mimeType||!validBase64(data[2],15000000)))return;
 return {url:value.url,mimeType:value.mimeType,bytes:value.bytes};
}

interface StudioRequestOptions {
 mode:StudioMode;locale:WorkspaceLocale;brief:string;product:Product;audience:string;tone:string;sourceText?:string;
 referenceImage?:string;imageData?:AiRequest['imageData'];
}
/** Editor context is bounded and remains source data; the selected locale is the output locale. */
export function buildStudioRequest(input:StudioRequestOptions):AiRequest {
 const product=input.product;
 const facts=JSON.stringify({id:product.id,brand:product.brand,family:product.family,name:product.name,description:product.description,material:product.material,features:product.features,specifications:product.specs,sourceUrl:product.sourceUrl||null,resources:product.downloads.map(file=>({label:file.label,url:file.url,sourceUrl:file.sourceUrl}))}).slice(0,8000);
 const source=input.sourceText?.slice(0,8000)||'';
 return {
  mode:input.mode,locale:input.locale,
  prompt:`${input.brief.trim().slice(0,8000)}\n\nAudience: ${input.audience}\nTone: ${input.tone}\nOutput language: ${input.locale}${input.mode==='video'?'\nDeliver a video storyboard/script.':input.mode==='audio'?'\nDeliver a narration script.':''}`,
  context:`Source text for this editorial task:\n${source}\n\nSelected product record (local authored content may require review):\n${facts}`,
  ...(input.mode==='image'&&input.imageData?{imageData:input.imageData}:input.mode==='image'&&productReferenceImage(input.referenceImage)?{referenceImage:input.referenceImage}:{}),
 };
}

/** Persist only actual provider output. Legacy local-template history retains its separate origin. */
export function normalizeStudioJob(value:unknown):AIJob|null {
 if(!object(value)||typeof value.id!=='string'||!value.id.trim()||!studioModes.includes(value.mode as StudioMode)||typeof value.locale!=='string'||!['fa','en','tr','ar','ru'].includes(value.locale)||typeof value.output!=='string'||typeof value.prompt!=='string'||typeof value.productId!=='string'||typeof value.createdAt!=='string'||typeof value.status!=='string'||!['ready','draft'].includes(value.status))return null;
 const image=generatedStudioImage(value.image),provider=text(value.provider),model=text(value.model);
 if(value.mode==='image'&&provider&&!image)return null;
 const sources:NonNullable<AIJob['sources']>=Array.isArray(value.sources)?value.sources.flatMap(source=>{
  if(!object(source)||!studioLink(source.url)||typeof source.number!=='number'||!Number.isInteger(source.number)||source.number<1)return [];
  return [{id:text(source.id),number:source.number,title:text(source.title,500),url:source.url as string,kind:text(source.kind),...(studioLink(source.sourceUrl)?{sourceUrl:source.sourceUrl as string}:{})}];
 }).slice(0,24):[];
 return {id:value.id.slice(0,160),mode:value.mode as StudioMode,locale:value.locale as WorkspaceLocale,productId:value.productId.slice(0,160),prompt:value.prompt.slice(0,10000),output:value.output.slice(0,160000),createdAt:value.createdAt,status:value.status as AIJob['status'],
  ...(provider?{provider}:{}),...(model?{model}:{}),...(image?{image}:{}),sources,
  ...(typeof value.authorId==='string'?{authorId:value.authorId}:{}),...(typeof value.responseId==='string'?{responseId:value.responseId}:{}),
  tokens:typeof value.tokens==='number'&&Number.isFinite(value.tokens)&&value.tokens>=0?value.tokens:null,
  ...(typeof value.sourceText==='string'?{sourceText:value.sourceText.slice(0,8000)}:{}),...(typeof value.referenceLabel==='string'?{referenceLabel:value.referenceLabel.slice(0,250)}:{}),
 };
}
export function resultStudioJob(result:AiResult,base:Omit<AIJob,'output'|'status'>):AIJob|null {
 if(!result||typeof result.text!=='string'||typeof result.id!=='string'||!result.id.trim()||typeof result.provider!=='string'||!result.provider.trim()||typeof result.model!=='string'||!result.model.trim())return null;
 if(base.mode!=='image'&&!result.text.trim())return null;
 return normalizeStudioJob({...base,output:result.text,status:'ready',responseId:result.id,provider:result.provider,model:result.model,tokens:result.tokens,image:result.image,sources:result.sources});
}

export interface StudioTicket {id:number;actor:string;controller:AbortController;}
/** A late response cannot outlive cancellation, replacement, logout, or a role change. */
export class StudioRequestGate {
 private active:StudioTicket|null=null;
 private nextId=0;
 start(actor:string):StudioTicket {this.cancel();this.active={id:++this.nextId,actor,controller:new AbortController()};return this.active;}
 current(ticket:StudioTicket,actor:string,permitted:boolean):boolean {return this.active===ticket&&ticket.actor===actor&&!ticket.controller.signal.aborted&&permitted;}
 finish(ticket:StudioTicket){if(this.active===ticket)this.active=null;}
 cancel(){this.active?.controller.abort();this.active=null;}
}

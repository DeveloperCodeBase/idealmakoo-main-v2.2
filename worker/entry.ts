// Bundled after ai-handler.ts and the build-time public knowledge array.
// There are deliberately no runtime imports or embedded environment values.
declare const KNOWLEDGE:import('./ai-handler').KnowledgeEntry[];
declare const handleAi:typeof import('./ai-handler').handleAi;
declare const handleSourceArchive:typeof import('./download').handleSourceArchive;
declare const SOURCE_ARCHIVE:import('./download').SourceArchive;
export default {
 async fetch(request:Request,env:import('./ai-handler').AiEnv){
  const download=await handleSourceArchive(request,env.ASSETS,SOURCE_ARCHIVE);if(download)return download;
  const response=await handleAi(request,env,KNOWLEDGE);if(response)return response;
  if(!env.ASSETS)return new Response('Static asset binding unavailable',{status:503});
  if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405,headers:{Allow:'GET, HEAD'}});
  const url=new URL(request.url);let asset=await env.ASSETS.fetch(request);
  if(asset.status===404&&!url.pathname.split('/').pop()?.includes('.')){const indexUrl=new URL(request.url);indexUrl.pathname=url.pathname.replace(/\/$/,'')+'/index.html';asset=await env.ASSETS.fetch(new Request(indexUrl,{method:request.method,headers:request.headers}));}
  const result=new Response(asset.body,asset);result.headers.set('X-Content-Type-Options','nosniff');result.headers.set('Referrer-Policy','strict-origin-when-cross-origin');
  if(url.pathname==='/downloads/idealmakoo-source.zip')result.headers.set('Content-Disposition','attachment; filename="idealmakoo-source.zip"');
  if(/\/(admin|account|auth)(\/|$)/.test(url.pathname))result.headers.set('Cache-Control','private, no-store');
  if(url.pathname.startsWith('/media/official/')||url.pathname.startsWith('/fonts/'))result.headers.set('X-Public-Cache','1');
  return result;
 }
};

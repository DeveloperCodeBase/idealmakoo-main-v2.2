// Inspect server HTML without running application JavaScript. React's streamed
// Suspense segments are ordinary HTML, located after their temporary boundary.
// Resolve only the explicit B:<id> -> S:<id> protocol; unknown/incomplete markup
// remains a reported failure instead of counting unrelated headings globally.
const voidElements=new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
const idOf=node=>node.open?.match(/\bid\s*=\s*["']([^"']+)["']/i)?.[1];
const segmentId=node=>node.name==='div'&&/\bhidden(?:\s|=|>)/i.test(node.open)&&/^S:[\w-]+$/.test(idOf(node)||'')?idOf(node):null;
const countHeadings=html=>[...html.matchAll(/<h1\b/gi)].length;

function parse(html){
 const root={name:'#document',children:[]},stack=[root],errors=[];
 const tokens=/<!--[\s\S]*?-->|<\/?[A-Za-z][\w:-]*\b(?:[^>"']|"[^"]*"|'[^']*')*>/g;
 let cursor=0;
 for(const match of html.matchAll(tokens)){
  const parent=stack.at(-1);if(match.index>cursor)parent.children.push({text:html.slice(cursor,match.index)});
  const tag=match[0];cursor=match.index+tag.length;
  if(tag.startsWith('<!--')){parent.children.push({comment:tag.slice(4,-3),text:tag});continue;}
  const name=tag.match(/^<\/?([^\s/>]+)/)[1].toLowerCase();
  if(tag.startsWith('</')){
   const index=stack.findLastIndex(node=>node.name===name);
   if(index<1){errors.push(`Unmatched closing ${name} tag.`);continue;}
   if(index!==stack.length-1)errors.push(`Unclosed element before closing ${name}.`);
   stack[index].close=tag;stack.length=index;continue;
  }
  const node={name,open:tag,close:'',children:[]};parent.children.push(node);
  if(!voidElements.has(name)&&!tag.endsWith('/>'))stack.push(node);
 }
 if(cursor<html.length)stack.at(-1).children.push({text:html.slice(cursor)});
 if(stack.length!==1)errors.push('Unclosed server HTML element.');
 return{root,errors};
}

export function resolveStreamedMain(rawHtml){
 if(typeof rawHtml!=='string'||rawHtml.length>20*1024*1024)throw new Error('Server HTML exceeds the bounded audit input.');
 const html=rawHtml.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,'');
 const {root,errors}=parse(html),warnings=[],segments=new Map(),used=new Set(),unresolved=new Set();
 const walk=(node,visit)=>{visit(node);for(const child of node.children||[])walk(child,visit);};
 walk(root,node=>{const id=segmentId(node);if(id){if(segments.has(id))errors.push(`Duplicate streamed segment ${id}.`);else segments.set(id,node);}});
 let boundaryCount=0;
 function renderChildren(children,chain=[]){
  if(chain.length>32){errors.push('Streamed boundary nesting exceeds32.');return '';}
  const out=[];
  for(let index=0;index<children.length;index++){
   const node=children[index];
   if(node.comment==='$?'||node.comment==='$!'){
    let templateIndex=index+1;while(children[templateIndex]?.text?.trim()==='')templateIndex++;
    const template=children[templateIndex],id=template?.name==='template'?idOf(template):null;
    if(id?.startsWith('B:')){
     let depth=1,end=templateIndex+1;
     for(;end<children.length;end++){
      const comment=children[end].comment;
      if(comment==='/$'&&--depth===0)break;
      if(comment==='$'||comment==='$?'||comment==='$!')depth++;
     }
     const target='S:'+id.slice(2),segment=segments.get(target);
     if(end===children.length){errors.push(`Unclosed stream boundary ${id}.`);unresolved.add(id);}
     else if(!segment){errors.push(`Missing streamed HTML segment for ${id}.`);unresolved.add(id);}
     else if(chain.includes(target)){errors.push(`Cyclic streamed boundary ${id}.`);unresolved.add(id);}
     else{used.add(target);boundaryCount++;out.push(renderChildren(segment.children,[...chain,target]));index=end;continue;}
    }
   }
   if(segmentId(node))continue;
   if(node.name==='template'&&idOf(node)?.startsWith('B:'))unresolved.add(idOf(node));
   out.push(node.children?node.open+renderChildren(node.children,chain)+(node.close||''):node.text||'');
  }
  return out.join('');
 }
 const resolved=renderChildren(root.children),parsed=parse(resolved);
 errors.push(...parsed.errors);
 const mains=[];walk(parsed.root,node=>{if(node.name==='main')mains.push(node);});
 const serialize=node=>node.children?node.open+node.children.map(serialize).join('')+(node.close||''):node.text||'';
 const mainHtml=mains.length===1?mains[0].children.map(serialize).join(''):'';
 const rawMain=html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1]||'';
 if(unresolved.size)errors.push('Unresolved or unsupported server stream boundaries: '+[...unresolved].join(', '));
 const orphanSegments=[...segments.keys()].filter(id=>!used.has(id));
 if(orphanSegments.length)warnings.push('Unreferenced server stream segments require review: '+orphanSegments.join(', '));
 return{mainHtml,h1Count:countHeadings(mainHtml),mainCount:mains.length,errors:[...new Set(errors)],warnings,
  streaming:{segmentCount:segments.size,resolvedBoundaries:boundaryCount,unresolvedIds:[...unresolved],orphanSegments,rawMainH1Count:countHeadings(rawMain),rawDocumentH1Count:countHeadings(html)}};
}

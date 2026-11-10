export interface RevisionChange {
  path:string[];
  kind:'added'|'removed'|'changed'|'reordered';
  before?:unknown;
  after?:unknown;
  numeric:boolean;
}
export interface RevisionComparison {changes:RevisionChange[];truncated:boolean}
export interface TextSegment {value:string;changed:boolean}
export interface TextComparison {before:TextSegment[];after:TextSegment[];limited:boolean}
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const numeric=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)||typeof value==='string'&&/^-?\d+(?:\.\d+)?$/.test(value);

/** Compare the server-projected editable snapshots. Stable block/line/field IDs
 * keep a reorder separate from a text edit, and exact decimal strings are never
 * rounded through floating point. The visit/change limits bound browser work. */
export function diffRevisions(before:unknown,after:unknown,limits:{maxChanges?:number;maxNodes?:number}={}):RevisionComparison {
  const changes:RevisionChange[]=[];
  const maxChanges=Math.max(1,Math.min(limits.maxChanges??250,1000));
  const maxNodes=Math.max(1,Math.min(limits.maxNodes??15000,50000));
  let nodes=0,truncated=false;
  const add=(path:string[],kind:RevisionChange['kind'],left:unknown,right:unknown)=>{
    if(changes.length>=maxChanges){truncated=true;return;}
    changes.push({path,kind,before:left,after:right,numeric:numeric(left)&&numeric(right)});
  };
  const visit=(left:unknown,right:unknown,path:string[])=>{
    if(++nodes>maxNodes||changes.length>=maxChanges){truncated=true;return;}
    if(Object.is(left,right))return;
    if(left===undefined){add(path,'added',left,right);return;}
    if(right===undefined){add(path,'removed',left,right);return;}
    if(Array.isArray(left)&&Array.isArray(right)){
      const ids=(items:unknown[])=>items.every(item=>object(item)&&typeof item.id==='string')?items.map(item=>(item as Record<string,unknown>).id as string):null;
      const l=ids(left),r=ids(right);
      if(l&&r&&new Set(l).size===l.length&&new Set(r).size===r.length){
        const lmap=new Map(l.map((id,index)=>[id,left[index]])),rmap=new Map(r.map((id,index)=>[id,right[index]]));
        const commonLeft=l.filter(id=>rmap.has(id)),commonRight=r.filter(id=>lmap.has(id));
        if(commonLeft.some((id,index)=>id!==commonRight[index]))add(path,'reordered',l,r);
        for(const id of [...l,...r.filter(id=>!lmap.has(id))]){visit(lmap.get(id),rmap.get(id),[...path,`[${id}]`]);if(truncated)break;}
      }else for(let index=0;index<Math.max(left.length,right.length);index++){visit(left[index],right[index],[...path,`[${index+1}]`]);if(truncated)break;}
      return;
    }
    if(object(left)&&object(right)){
      for(const key of [...new Set([...Object.keys(left),...Object.keys(right)])].sort()){
        visit(Object.hasOwn(left,key)?left[key]:undefined,Object.hasOwn(right,key)?right[key]:undefined,[...path,key]);if(truncated)break;
      }
      return;
    }
    add(path,'changed',left,right);
  };
  visit(before,after,[]);
  return{changes,truncated};
}

/** Safe text-only word highlighting. Large bodies use a linear prefix/suffix
 * comparison and state that the middle is one bounded change, never raw HTML. */
export function compareRevisionText(before:string,after:string):TextComparison {
  if(before===after)return{before:[{value:before,changed:false}],after:[{value:after,changed:false}],limited:false};
  const left=before.match(/\s+|[^\s]+/gu)||[],right=after.match(/\s+|[^\s]+/gu)||[];
  const pack=(tokens:TextSegment[])=>tokens.reduce<TextSegment[]>((result,token)=>{if(!token.value)return result;const last=result.at(-1);if(last&&last.changed===token.changed)last.value+=token.value;else result.push({...token});return result;},[]);
  if(left.length*right.length>160000||Math.max(before.length,after.length)>30000){
    let prefix=0,suffix=0;
    while(prefix<before.length&&prefix<after.length&&before[prefix]===after[prefix])prefix++;
    while(suffix<before.length-prefix&&suffix<after.length-prefix&&before[before.length-1-suffix]===after[after.length-1-suffix])suffix++;
    const parts=(text:string)=>pack([{value:text.slice(0,prefix),changed:false},{value:text.slice(prefix,text.length-suffix),changed:true},{value:suffix?text.slice(-suffix):'',changed:false}]);
    return{before:parts(before),after:parts(after),limited:true};
  }
  const width=right.length+1,matrix=new Uint16Array((left.length+1)*width);
  for(let i=left.length-1;i>=0;i--)for(let j=right.length-1;j>=0;j--)matrix[i*width+j]=left[i]===right[j]?matrix[(i+1)*width+j+1]+1:Math.max(matrix[(i+1)*width+j],matrix[i*width+j+1]);
  const a:TextSegment[]=[],b:TextSegment[]=[];let i=0,j=0;
  while(i<left.length||j<right.length){
    if(i<left.length&&j<right.length&&left[i]===right[j]){a.push({value:left[i++],changed:false});b.push({value:right[j++],changed:false});}
    else if(i<left.length&&(j===right.length||matrix[(i+1)*width+j]>=matrix[i*width+j+1]))a.push({value:left[i++],changed:true});
    else b.push({value:right[j++],changed:true});
  }
  return{before:pack(a),after:pack(b),limited:false};
}

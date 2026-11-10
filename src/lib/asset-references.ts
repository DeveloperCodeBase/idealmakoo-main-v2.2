/** References to retained assets, including encoded URLs embedded in Markdown. */
export interface AssetReference {id:string;private:boolean}
export function assetReferences(value:unknown):AssetReference[]{
 const references=new Map<string,AssetReference>();
 const visit=(item:unknown):void=>{
  if(typeof item==='string'){
   let decoded=item;
   for(let pass=0;pass<3;pass++)decoded=decoded.replace(/(?:%[0-9a-f]{2})+/gi,encoded=>{try{return decodeURIComponent(encoded);}catch{return encoded;}});
   for(const match of decoded.matchAll(/\/api\/v1\/(?:media\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/content|attachments\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}))(?![a-zA-Z0-9_-])/gi)){
    const id=(match[1]||match[2]).toLowerCase(),isPrivate=!!match[2];references.set(id+':'+isPrivate,{id,private:isPrivate});
   }
  }else if(Array.isArray(item))item.forEach(visit);else if(item&&typeof item==='object')Object.values(item).forEach(visit);
 };
 visit(value);return [...references.values()];
}
export function referencesAsset(value:unknown,id:string):boolean{return assetReferences(value).some(reference=>reference.id===id.toLowerCase());}

import {isLocale} from './i18n';

const routeKey=(path:string)=>path.replace(/\/+$/,'')||'/';
const isHome=(path:string)=>{const parts=path.split('/').filter(Boolean);return parts.length===0||(parts.length===1&&isLocale(parts[0]));};

export interface NavigationScrollBinding {commit:(pathname:string)=>void;destroy:()=>void;}

/** Complete forward page navigation after menus release their scroll locks.
 * Native history restoration and explicit fragment navigation keep their position. */
export function bindNavigationScroll(doc:Document):NavigationScrollBinding {
 const view=doc.defaultView!;
 let previous=routeKey(view.location.pathname),popDestination:string|null=null;
 let firstFrame:number|null=null,secondFrame:number|null=null,destroyed=false;
 const cancel=()=>{
  if(firstFrame!==null)view.cancelAnimationFrame(firstFrame);
  if(secondFrame!==null)view.cancelAnimationFrame(secondFrame);
  firstFrame=null;secondFrame=null;
 };
 const top=(path:string)=>{
  cancel();
  // The second frame follows the route's passive dialog cleanup, including a
  // same-page home click that closes a mobile drawer without changing pathname.
  firstFrame=view.requestAnimationFrame(()=>{
   firstFrame=null;
   secondFrame=view.requestAnimationFrame(()=>{
    secondFrame=null;
    if(destroyed||routeKey(view.location.pathname)!==routeKey(path)||view.location.hash)return;
    const style=doc.documentElement.style,previousBehavior=style.scrollBehavior;
    style.scrollBehavior='auto';
    view.scrollTo({left:0,top:0,behavior:'instant'});
    style.scrollBehavior=previousBehavior;
   });
  });
 };
 const pop=()=>{popDestination=routeKey(view.location.pathname);cancel();};
 const click=(event:MouseEvent)=>{
  if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
  const target=event.target as Element|null;
  const anchor=target?.closest?.('a[href]') as HTMLAnchorElement|null;
  if(!anchor||anchor.hasAttribute('download')||(anchor.target&&anchor.target!=='_self'))return;
  let destination:URL;
  try{destination=new URL(anchor.href,view.location.href);}catch{return;}
  if(destination.origin!==view.location.origin||destination.hash)return;
  if(isHome(destination.pathname)&&routeKey(destination.pathname)===routeKey(view.location.pathname)){
   popDestination=null;top(destination.pathname);
  }
 };
 doc.addEventListener('click',click,true);
 doc.addEventListener('wheel',cancel,{passive:true});
 doc.addEventListener('touchmove',cancel,{passive:true});
 view.addEventListener('popstate',pop);view.addEventListener('hashchange',cancel);
 return {
  commit:(pathname:string)=>{
   const next=routeKey(pathname);if(destroyed||next===previous)return;
   previous=next;
   const restoring=popDestination===next;popDestination=null;
   if(restoring||view.location.hash)cancel();else top(next);
  },
  destroy:()=>{
   destroyed=true;cancel();doc.removeEventListener('click',click,true);
   doc.removeEventListener('wheel',cancel);doc.removeEventListener('touchmove',cancel);
   view.removeEventListener('popstate',pop);view.removeEventListener('hashchange',cancel);
  },
 };
}

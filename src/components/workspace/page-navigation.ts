export interface PageNavigationClick {
 href:string;
 currentHref:string;
 target?:string|null;
 download?:boolean;
 defaultPrevented?:boolean;
 button:number;
 altKey?:boolean;
 ctrlKey?:boolean;
 metaKey?:boolean;
 shiftKey?:boolean;
}

/** Ordinary internal page navigation only. Downloads, separate browsing
 * contexts and same-document anchors do not abandon this editor. */
export function guardedPageDestination(click:PageNavigationClick):string|null{
 if(click.defaultPrevented||click.button!==0||click.altKey||click.ctrlKey||click.metaKey||click.shiftKey||click.download)return null;
 const target=click.target?.trim().toLowerCase();if(target&&target!=='_self')return null;
 try{
  const current=new URL(click.currentHref),next=new URL(click.href,current);
  if(!['http:','https:'].includes(next.protocol)||next.origin!==current.origin||next.username||next.password)return null;
  if(next.pathname===current.pathname&&next.search===current.search)return null;
  // Preserve the checked origin when handing the URL to the router. Returning
  // only a pathname starting with "//" would reinterpret it as a new host.
  return next.href;
 }catch{return null;}
}

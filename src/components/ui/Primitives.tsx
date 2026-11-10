'use client';
import Link from 'next/link';
import {useId,useRef,type ReactNode,type ButtonHTMLAttributes,type RefObject} from 'react';
import {createPortal} from 'react-dom';
import {ArrowUpRight,X} from 'lucide-react';
import {useApp} from '@/components/providers/AppProvider';
import {useDialogPortalTarget,useViewportDialog} from './dialog-runtime';
import './modal.css';
export function GlassCard({children,className='',...rest}:React.HTMLAttributes<HTMLDivElement>){return <div {...rest} className={`glass ${className}`}>{children}</div>;}
export function GlowingButton({children,className='',...rest}:ButtonHTMLAttributes<HTMLButtonElement>){return <button className={`btn btn-primary ${className}`} {...rest}>{children}</button>;}
export function BiDiText({children}:{children:ReactNode}){return <bdi dir="ltr">{children}</bdi>;}
export function SectionTitle({eyebrow,title,description,action,href}:{eyebrow?:string;title:string;description?:string;action?:string;href?:string}){return <div className="section-heading"><div>{eyebrow&&<span className="eyebrow">{eyebrow}</span>}<h2>{title}</h2>{description&&<p>{description}</p>}</div>{href&&<Link href={href} className="text-link">{action}<ArrowUpRight size={18} className="directional"/></Link>}</div>;}
export function EmptyState({title,description,action,href,icon,headingLevel=3}:{title:string;description?:string;action?:string;href?:string;icon?:ReactNode;headingLevel?:2|3}){const Heading=headingLevel===2?'h2':'h3';return <div className="empty-state glass">{icon&&<div className="empty-icon">{icon}</div>}<Heading>{title}</Heading>{description&&<p>{description}</p>}{href&&<Link className="btn btn-primary" href={href}>{action}<ArrowUpRight size={17}/></Link>}</div>;}
export interface ModalProps {
 title:string;
 children:ReactNode;
 onClose:()=>void;
 className?:string;
 bodyClassName?:string;
 headerClassName?:string;
 closeButtonClassName?:string;
 restoreFocusTarget?:RefObject<HTMLElement|null>;
}
/** One stationary glass shell; only the content body scrolls, never its rim or heading. */
export function Modal({title,children,onClose,className='',bodyClassName='',headerClassName='',closeButtonClassName='',restoreFocusTarget}:ModalProps){
 const ref=useRef<HTMLDialogElement>(null),closeButton=useRef<HTMLButtonElement>(null),backdropDown=useRef(false);
 const titleId=useId(),portalTarget=useDialogPortalTarget();const {t,dir,locale,role}=useApp();
 useViewportDialog(ref,true,portalTarget,onClose,{initialFocus:closeButton,restoreFocusTarget});
 const outside=(x:number,y:number)=>{const r=ref.current?.getBoundingClientRect();return !!r&&(x<r.left||x>r.right||y<r.top||y>r.bottom);};
 if(!portalTarget)return null;
 return createPortal(<dialog ref={ref} className={`app-dialog liquid-dialog ${className}`} data-viewport-dialog="true" data-liquid-surface="" data-role={role} aria-labelledby={titleId} dir={dir} lang={locale} tabIndex={-1}
  onPointerDown={event=>{backdropDown.current=event.target===event.currentTarget&&outside(event.clientX,event.clientY);}}
  onPointerCancel={()=>{backdropDown.current=false;}}
  onClick={event=>{const close=backdropDown.current&&event.target===event.currentTarget&&outside(event.clientX,event.clientY);backdropDown.current=false;if(close)onClose();}}>
  <header className={`dialog-heading ${headerClassName}`}><h2 id={titleId} dir="auto">{title}</h2><button ref={closeButton} type="button" className={`icon-btn dialog-close ${closeButtonClassName}`} aria-label={t('close')} onClick={onClose}><X size={20} aria-hidden="true"/></button></header>
  <div className={`dialog-body ${bodyClassName}`}>{children}</div>
 </dialog>,portalTarget);
}

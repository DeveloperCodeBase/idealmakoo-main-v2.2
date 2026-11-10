'use client';
import './rich-text.css';
import {GlossaryText} from '@/components/content/GlossaryTerms';
import type {ReactNode} from 'react';
import type {AiSource} from '@/lib/ai-client';
import {safeAiLink} from '@/lib/ai-links';
import {parseRichText} from '@/lib/rich-text';
export {safeAiLink} from '@/lib/ai-links';
export function sourceTitle(source:AiSource,locale:string){const translated=source.title.split('\n').filter(s=>s.startsWith(locale+': ')).map(s=>s.slice(locale.length+2));return (translated.join(' · ')||source.title).slice(0,180);}
/** React text nodes only: model HTML and executable URL schemes never enter the DOM. */
export default function AiMarkdown({text,sources=[],locale,content=false,glossary=true}:{text:string;sources?:AiSource[];locale:string;content?:boolean;glossary?:boolean}){
 function inline(value:string,depth=0,annotate=true):ReactNode[]{if(depth>8)return[value];return value.split(/(\\[\\*_[\]`~]|\*\*[^\n]+?\*\*|__[^\n]+?__|\*[^*\n]+\*|_[^_\n]+_|~~[^~\n]+~~|`[^`\n]+`|\[[^\]\n]+\]\([^\s)]+\)|\[\d+\])/g).map((part,index)=>{
  if(/^\\[\\*_[\]`~]$/.test(part))return part.slice(1);
  if((part.startsWith('**')&&part.endsWith('**'))||(part.startsWith('__')&&part.endsWith('__')))return <strong key={index}>{inline(part.slice(2,-2),depth+1,annotate)}</strong>;
  if((part.startsWith('*')&&part.endsWith('*'))||(part.startsWith('_')&&part.endsWith('_')))return <em key={index}>{inline(part.slice(1,-1),depth+1,annotate)}</em>;
  if(part.startsWith('~~')&&part.endsWith('~~'))return <del key={index}>{inline(part.slice(2,-2),depth+1,annotate)}</del>;
  if(part.startsWith('`')&&part.endsWith('`'))return <code key={index}>{part.slice(1,-1)}</code>;
  const citation=part.match(/^\[(\d+)\]$/);if(citation){const source=sources.find(s=>s.number===Number(citation[1]));const href=source&&safeAiLink(source.url,locale);if(source&&href)return <a key={index} className="ai-citation" href={href} title={sourceTitle(source,locale)}>[{citation[1]}]</a>;}
  const link=part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);if(link){const href=safeAiLink(link[2],locale);if(href)return <a key={index} href={href} {...(href.startsWith('https:')?{target:'_blank',rel:'noopener noreferrer'}:{})}>{link[1]}</a>;return link[1];}return content&&glossary&&annotate?<GlossaryText key={index} text={part} locale={locale}/>:part;
 });}
 return <div className={`ai-prose${content?' rich-prose':''}`} dir={content&&['fa','ar'].includes(locale)?'rtl':content?'ltr':'auto'} lang={locale}>{parseRichText(text).map((block,index)=>{
  if(block.type==='code')return <pre key={index} dir="ltr"><code>{block.text}</code></pre>;
  if(block.type==='rule')return <hr key={index}/>;
  if(block.type==='heading'){const Heading=(content?`h${Math.min(6,Math.max(2,block.level))}`:'h4') as 'h2'|'h3'|'h4'|'h5'|'h6';return <Heading key={index}>{inline(block.text,0,false)}</Heading>;}
  if(block.type==='quote')return <blockquote key={index}>{inline(block.text)}</blockquote>;
  if(block.type==='list'){const List=block.ordered?'ol':'ul';return <List key={index}>{block.items.map((item,i)=><li key={i}>{inline(item)}</li>)}</List>;}
  if(block.type==='table')return <div className="ai-table-scroll" key={index}><table><thead><tr>{block.head.map((cell,i)=><th scope="col" key={i}>{inline(cell)}</th>)}</tr></thead><tbody>{block.rows.map((row,i)=><tr key={i}>{row.map((cell,j)=><td key={j}>{inline(cell)}</td>)}</tr>)}</tbody></table></div>;
  return <p key={index}>{inline(block.text)}</p>;
 })}</div>;
}

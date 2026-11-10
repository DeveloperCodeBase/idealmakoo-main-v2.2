export type RichBlock =
  | {type:'paragraph'|'quote';text:string}
  | {type:'heading';text:string;level:number}
  | {type:'code';text:string;language:string}
  | {type:'rule'}
  | {type:'list';ordered:boolean;items:string[]}
  | {type:'table';head:string[];rows:string[][]};

const cells=(line:string)=>line.trim().replace(/^\|/,'').replace(/\|$/,'').split(/(?<!\\)\|/).map(cell=>cell.trim().replace(/\\\|/g,'|'));
const tableSeparator=(line:string)=>line.includes('|')&&cells(line).every(cell=>/^:?-{3,}:?$/.test(cell));
const heading=/^(#{1,6})\s+(.+?)\s*#*$/;
const bullet=/^\s*[-+*]\s+(.+)$/;
const numbered=/^\s*\d+[.)]\s+(.+)$/;
const fence=/^\s*(`{3,}|~{3,})([^\s]*)\s*$/;
const rule=/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;

/** A bounded, text-only Markdown subset. It never parses or executes HTML. */
export function parseRichText(text:string):RichBlock[]{
  const lines=text.replace(/\r\n?/g,'\n').split('\n'),blocks:RichBlock[]=[];
  const boundary=(index:number)=>!lines[index]?.trim()||heading.test(lines[index])||fence.test(lines[index])||rule.test(lines[index])||bullet.test(lines[index])||numbered.test(lines[index])||/^\s*>/.test(lines[index])||(index+1<lines.length&&tableSeparator(lines[index+1]));
  for(let i=0;i<lines.length;){
    const line=lines[i];if(!line.trim()){i++;continue;}
    const code=line.match(fence);
    if(code){const content:string[]=[];const close=new RegExp('^\\s*'+code[1][0]+'{'+code[1].length+',}\\s*$');i++;while(i<lines.length&&!close.test(lines[i]))content.push(lines[i++]);if(i<lines.length)i++;blocks.push({type:'code',language:code[2].slice(0,40),text:content.join('\n')});continue;}
    const title=line.match(heading);if(title){blocks.push({type:'heading',text:title[2],level:title[1].length});i++;continue;}
    if(rule.test(line)){blocks.push({type:'rule'});i++;continue;}
    if(i+1<lines.length&&tableSeparator(lines[i+1])){const head=cells(line),rows:string[][]=[];i+=2;while(i<lines.length&&lines[i].trim()&&lines[i].includes('|')){const row=cells(lines[i++]);rows.push(head.map((_,index)=>row[index]||''));}blocks.push({type:'table',head,rows});continue;}
    const ordered=numbered.test(line),list=ordered?numbered:bullet;
    if(list.test(line)){const items:string[]=[];while(i<lines.length&&list.test(lines[i]))items.push(lines[i++].replace(list,'$1'));blocks.push({type:'list',ordered,items});continue;}
    if(/^\s*>/.test(line)){const content:string[]=[];while(i<lines.length&&/^\s*>/.test(lines[i]))content.push(lines[i++].replace(/^\s*>\s?/,''));blocks.push({type:'quote',text:content.join('\n')});continue;}
    const paragraph=[line];i++;while(i<lines.length&&!boundary(i))paragraph.push(lines[i++]);blocks.push({type:'paragraph',text:paragraph.join('\n')});
  }
  return blocks;
}

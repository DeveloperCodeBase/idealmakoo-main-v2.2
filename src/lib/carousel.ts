/** Geometry and morph timings ported from the supplied Glassy-Carousel-Source.zip.
 * dist/carousel.js cardPose / relativeIndex / _resize, source SHA256:
 * b2b0d4ec86820051192e8961adb8fdabaa755942792be218475d1546506778f9.
 */
export const CAROUSEL_MOTION={gather:350,expand:480,contract:440,spread:440,autoplay:4400} as const;
export const clamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(max,value));
export function boundedIndex(value:number,count:number,loop=false){if(!Number.isFinite(value)||count<1)return 0;const rounded=Math.round(value);return loop?((rounded%count)+count)%count:clamp(rounded,0,count-1);}
export function relativeIndex(index:number,selected:number,count:number,loop=false){let distance=index-selected;if(loop&&count>2){if(distance>count/2)distance-=count;if(distance< -count/2)distance+=count;}return distance;}
interface CardPose {x:number;y:number;z:number;rotateY:number;scale:number;opacity:number;brightness:number;zIndex:number;}
export function cardPose(distance:number,scale=1,gathered=false,spread=1):CardPose{
 // During a drag, interpolate the supplied fan's original resting poses. The
 // incoming card can reach the centre continuously instead of nudging the deck.
 if(Number.isFinite(distance)&&!Number.isInteger(distance)){
  const lower=Math.floor(distance),fraction=distance-lower;
  const a=cardPose(lower,scale,gathered,spread),b=cardPose(lower+1,scale,gathered,spread);
  const mix=(key:keyof CardPose)=>a[key]+(b[key]-a[key])*fraction;
  return {x:mix('x'),y:mix('y'),z:mix('z'),rotateY:mix('rotateY'),scale:mix('scale'),opacity:mix('opacity'),brightness:mix('brightness'),zIndex:Math.round(mix('zIndex'))};
 }
 const depth=Math.abs(distance),side=Math.sign(distance);
 if(gathered&&depth)return {x:side*9*scale,y:0,z:-60*scale,rotateY:side*-3,scale:.88,opacity:0,brightness:.75,zIndex:10-depth};
 return {x:side*(depth===1?146:146+(depth-1)*94)*scale*clamp(Number.isFinite(spread)?spread:1,1,1.65),y:(depth?7:0)*scale,z:-Math.min(depth,5)*76*scale,rotateY:side*-Math.min(27,19+depth*3),scale:depth?Math.max(.48,1-depth*.095):1,opacity:depth>3?0:depth===0?1:depth===1?.72:depth===2?.40:.19,brightness:depth===0?1:depth===1?.86:.75,zIndex:20-Math.ceil(depth)};
}
export function carouselSize(width:number,height:number,viewportHeight=height){
 const w=Math.max(160,Number.isFinite(width)&&width>0?width:720);
 const h=Math.max(420,Number.isFinite(height)&&height>0?height:620);
 const vh=Math.max(120,Number.isFinite(viewportHeight)&&viewportHeight>0?viewportHeight:h);
 const compact=w<640;
 // Image, two-line title, subtitle, caption and dock have separate physical budgets.
 // Type and touch targets do not shrink with the original fan's geometric scale.
 const cardWidth=Math.min(w-40,clamp(w*(compact?.68:.28),compact?190:244,compact?280:336));
 const cardPadding=12,copyHeight=compact?96:100;
 const dockWidth=Math.min(840,w-24),dockHeight=compact?116:80,dockBottom=32;
 const stageTop=compact?64:68,stageBottom=h-dockBottom-dockHeight-22;
 const stageHeight=stageBottom-stageTop;
 const posterHeight=Math.max(48,Math.min(cardWidth*.86,stageHeight-copyHeight-cardPadding*2));
 const cardHeight=posterHeight+copyHeight+cardPadding*2;
 const scale=cardWidth/240;
 const spread=clamp((w-cardWidth)/(5*146*scale),1,1.65);
 return {compact,scale,spread,cardWidth,cardHeight,cardPadding,copyHeight,posterHeight,stageTop,stageBottom,stageHeight,centerY:stageTop+stageHeight/2,
  panelWidth:Math.min(700,w-24),panelHeight:Math.min(720,vh-24),dockWidth,dockHeight,dockBottom};
}

/** Direction is chosen once; a vertical page gesture can never become a card activation. */
export function pointerIntent(dx:number,dy:number):'pending'|'horizontal'|'vertical'{
 if(!Number.isFinite(dx)||!Number.isFinite(dy))return 'vertical';
 if(Math.max(Math.abs(dx),Math.abs(dy))<10)return 'pending';
 if(Math.abs(dy)>=Math.abs(dx))return 'vertical';
 return 'horizontal';
}
export function suppressPointerActivation(dx:number,dy:number,cancelled=false){
 return cancelled||!Number.isFinite(dx)||!Number.isFinite(dy)||Math.hypot(dx,dy)>=10;
}
/** Pointer velocity projects a short throw, then settles on the original bounded fan. */
export function dragSelection(index:number,count:number,offset:number,velocity:number,scale:number,rtl=false,reduced=false){
 if(![offset,velocity,scale].every(Number.isFinite)||Math.abs(offset)<8||count<2)return boundedIndex(index,count);
 const projected=offset+(reduced?0:clamp(velocity,-2.2,2.2)*110);
 const threshold=Math.max(26,42*scale);
 if(Math.abs(projected)<threshold)return boundedIndex(index,count);
 const steps=clamp(Math.round(Math.abs(projected)/Math.max(95,146*scale)),1,3);
 return boundedIndex(index-Math.sign(projected)*(rtl?-1:1)*steps,count);
}
export function carouselUrl(value:unknown,media=false):string|undefined{
 if(typeof value!=='string')return;const url=value.trim();if(!url||/[\u0000-\u0020\\]/.test(url))return;
 if(/^\/(?!\/)/.test(url))return url;
 if(media&&/^data:image\/(png|jpeg|jpg|webp|gif|avif);base64,[a-z0-9+/=]+$/i.test(url))return url;
 try{const parsed=new URL(url);if(['http:','https:'].includes(parsed.protocol)&&!parsed.username&&!parsed.password)return url;}catch{/* Invalid URL. */}
}

/** Embedded carousels must never consume ordinary vertical page scrolling. */
export function wheelNavigationIntent(deltaX:number,deltaY:number,shiftKey:boolean,rtl=false):number|null {
 if(!Number.isFinite(deltaX)||!Number.isFinite(deltaY))return null;
 const horizontal=Math.abs(deltaX)>Math.abs(deltaY);
 if(!horizontal&&!shiftKey)return null;
 const value=horizontal?deltaX*(rtl?-1:1):deltaY;
 return value||null;
}

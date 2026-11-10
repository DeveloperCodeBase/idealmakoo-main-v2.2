import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTs} from './helpers/load-ts.mjs';
const {boundedIndex,relativeIndex,cardPose,carouselSize,dragSelection,wheelNavigationIntent,pointerIntent,suppressPointerActivation,carouselUrl,CAROUSEL_MOTION}=await loadTs('src/lib/carousel.ts');
const {dialogViewportFrame,centeredDialogBounds,lockDocumentScroll}=await loadTs('src/components/ui/dialog-runtime.ts');

test('original five-card reference geometry preserves centred focus, depth, fan rotation and gathering',()=>{
 const poses=[-2,-1,0,1,2].map(distance=>cardPose(distance));
 assert.deepEqual(poses.map(p=>p.x),[-240,-146,0,146,240]);
 assert.deepEqual(poses.map(p=>p.z),[-152,-76,-0,-76,-152]);
 assert.deepEqual(poses.map(p=>p.opacity),[.4,.72,1,.72,.4]);
 assert.equal(poses[1].rotateY,22);assert.equal(poses[3].rotateY,-22);assert.equal(poses[2].scale,1);
 assert.equal(cardPose(4).opacity,0);assert.equal(cardPose(2,1,true).opacity,0);assert.equal(cardPose(0,1,true).opacity,1);
 assert.deepEqual([CAROUSEL_MOTION.gather,CAROUSEL_MOTION.expand,CAROUSEL_MOTION.contract,CAROUSEL_MOTION.spread],[350,480,440,440]);
});

test('manual navigation keeps reference endpoints while optional looping and single/empty decks stay bounded',()=>{
 assert.equal(boundedIndex(-100,7),0);assert.equal(boundedIndex(100,7),6);assert.equal(boundedIndex(100,0),0);assert.equal(boundedIndex(-1,7,true),6);assert.equal(boundedIndex(NaN,7),0);
 assert.equal(relativeIndex(4,0,5),4);assert.equal(relativeIndex(4,0,5,true),-1);assert.equal(boundedIndex(3,1),0);
});

test('ordinary vertical page scrolling is preserved; horizontal and Shift gestures follow locale direction',()=>{
 for(const rtl of [false,true]){assert.equal(wheelNavigationIntent(0,120,false,rtl),null);assert.equal(wheelNavigationIntent(4,-80,false,rtl),null);assert.equal(wheelNavigationIntent(0,120,true,rtl),120);}
 assert.equal(wheelNavigationIntent(90,3,false,false),90);assert.equal(wheelNavigationIntent(90,3,false,true),-90);assert.equal(wheelNavigationIntent(0,0,true),null);assert.equal(wheelNavigationIntent(Infinity,0,false),null);
});

test('pointer throws snap to bounded cards, mirror for RTL and omit velocity projection in reduced motion',()=>{
 assert.equal(dragSelection(2,7,-90,0,1,false),3);assert.equal(dragSelection(2,7,-90,0,1,true),1);
 assert.equal(dragSelection(0,7,600,2,1,false),0);assert.equal(dragSelection(6,7,-600,-2,1,false),6);
 assert.equal(dragSelection(2,7,-10,-1,1,false,false),3);assert.equal(dragSelection(2,7,-10,-1,1,false,true),2);
 assert.equal(dragSelection(2,7,-3,-2,1),2);assert.equal(dragSelection(0,1,-200,-2,1),0);assert.equal(dragSelection(2,7,NaN,-2,1),2);
});

test('responsive fan reserves non-overlapping physical areas for caption, image, two-line copy and dock',()=>{
 for(const width of [280,320,360,390,768,1366,1920])for(const height of [420,width<640?570:620]){
  const size=carouselSize(width,height,800);
  assert.ok(size.cardWidth<=width-40,`${width}: centred card fits with side-card space`);
  assert.ok(size.posterHeight>=48,`${width}: image retains its own area even in a short fullscreen view`);
  assert.ok(size.copyHeight>=96,`${width}: title and subtitle never borrow image height`);
  assert.ok(size.centerY-size.cardHeight/2>=size.stageTop-.001,`${width}: card starts after caption`);
  assert.ok(size.centerY+size.cardHeight/2<=size.stageBottom+.001,`${width}: card ends before dock`);
  const dockTop=height-size.dockBottom-size.dockHeight;
  assert.ok(dockTop-size.stageBottom>=22,`${width}: non-reflected content cannot intersect dock`);
  assert.ok(size.dockWidth<=width-24);
  if(size.compact){assert.equal(size.dockHeight,116);assert.ok(size.dockWidth-16>=3*44+2*44+12,'five 44px controls fit below independent title');}
  else assert.ok(size.dockWidth-20-3*44-2*44-24>=160,'desktop retains a real title column');
 }
});

test('fan coordinates mirror in RTL without moving the selected card or changing allocated typography',()=>{
 for(const width of [320,360,390,768,1366]){
  const size=carouselSize(width,width<640?570:620,800);
  for(const distance of [-3,-2,-1,0,1,2,3]){
   const left=cardPose(distance,size.scale,false,size.spread),right=cardPose(-distance,size.scale,false,size.spread);
   assert.equal(left.x===0?0:left.x,right.x===0?0:-right.x);
   assert.equal(left.y,right.y);assert.equal(left.z,right.z);assert.equal(left.scale,right.scale);
   assert.equal(left.opacity,right.opacity);
   if(distance===0){assert.equal(left.x===0,true);assert.equal(left.rotateY===0,true);}
  }
 }
});

test('centred native popup fits mobile, desktop, keyboard-reduced and offset visual viewports at every transition scale',()=>{
 for(const width of [320,360,390,768,1366])for(const height of [280,360,640,900])for(const rtl of [false,true]){
  const viewport={width,height,offsetLeft:rtl?37:0,offsetTop:rtl?85:0};
  const bounds=centeredDialogBounds(viewport,780,760),frame=dialogViewportFrame(viewport);
  assert.ok(bounds.width<=width-frame.gutter*2+.001);
  assert.ok(bounds.height<=height-frame.gutter*2+.001);
  assert.equal(bounds.left+bounds.width/2,frame.centerX);assert.equal(bounds.top+bounds.height/2,frame.centerY);
  for(const scale of [.975,.988,1]){
   const left=frame.centerX-bounds.width*scale/2,top=frame.centerY-bounds.height*scale/2;
   assert.ok(left>=viewport.offsetLeft+frame.gutter-.001);
   assert.ok(top>=viewport.offsetTop+frame.gutter-.001);
   assert.ok(left+bounds.width*scale<=viewport.offsetLeft+width-frame.gutter+.001);
   assert.ok(top+bounds.height*scale<=viewport.offsetTop+height-frame.gutter+.001);
  }
 }
});

test('popup resize, orientation and close/reopen do not reuse a carousel document offset',()=>{
 const portrait={width:390,height:844,offsetLeft:0,offsetTop:0};
 const open=centeredDialogBounds(portrait,780,760);
 const keyboard=centeredDialogBounds({...portrait,height:340,offsetTop:130},780,760);
 assert.equal(keyboard.width,open.width);assert.ok(keyboard.height<open.height);assert.equal(keyboard.top,130+keyboard.gutter);
 const landscape=centeredDialogBounds({width:844,height:390},780,760);
 assert.ok(landscape.width>open.width);assert.ok(landscape.height<open.height);
 assert.deepEqual(centeredDialogBounds(portrait,780,760),open);
 assert.deepEqual(centeredDialogBounds({...portrait,documentScrollY:5000,carouselLeft:700,rtl:true},780,760),open,'document/card offsets cannot leak into physical popup coordinates');
 for(const input of [{width:NaN,height:Infinity},{width:1,height:1},{width:320,height:640,offsetLeft:NaN,offsetTop:Infinity}]){
  const frame=dialogViewportFrame(input);assert.ok(Object.values(frame).every(Number.isFinite));assert.ok(frame.width>0&&frame.height>0);
 }
});

test('vertical scrolling, aborted capture and swipes cannot become a card activation',()=>{
 assert.equal(pointerIntent(3,4),'pending');assert.equal(suppressPointerActivation(3,4),false);
 assert.equal(pointerIntent(12,35),'vertical');assert.equal(pointerIntent(20,20),'vertical');
 assert.equal(pointerIntent(-35,12),'horizontal');assert.equal(pointerIntent(35,-12),'horizontal');
 assert.equal(suppressPointerActivation(-70,8),true);assert.equal(suppressPointerActivation(4,80),true);
 assert.equal(suppressPointerActivation(0,0,true),true);assert.equal(suppressPointerActivation(NaN,0),true);
});

test('nested native popup scroll locks restore exact styles and page position only after the last close',()=>{
 const bodyStyle={position:'relative',top:'',left:'',right:'',width:'90%',overflow:'clip',paddingRight:'7px'};
 const htmlStyle={overflow:'auto',scrollBehavior:'smooth'};
 const originalBody={...bodyStyle},originalHtml={...htmlStyle},scrolls=[];
 const doc={body:{style:bodyStyle},documentElement:{style:htmlStyle,clientWidth:1349},defaultView:{scrollX:12,scrollY:2370,innerWidth:1366,getComputedStyle:()=>({paddingRight:'7px'}),scrollTo:options=>{assert.equal(htmlStyle.scrollBehavior,'auto');scrolls.push(options);}}};
 const releaseParent=lockDocumentScroll(doc),releaseChild=lockDocumentScroll(doc);
 assert.equal(bodyStyle.position,'fixed');assert.equal(bodyStyle.top,'-2370px');assert.equal(bodyStyle.left,'-12px');assert.equal(bodyStyle.paddingRight,'24px');
 releaseParent();releaseParent();assert.equal(bodyStyle.position,'fixed');assert.equal(scrolls.length,0);
 releaseChild();assert.deepEqual(bodyStyle,originalBody);assert.deepEqual(htmlStyle,originalHtml);assert.deepEqual(scrolls,[{left:12,top:2370,behavior:'instant'}]);
 releaseChild();assert.equal(scrolls.length,1);
 const reopen=lockDocumentScroll(doc);reopen();assert.equal(scrolls.length,2);assert.deepEqual(bodyStyle,originalBody);
});

test('factory card links and raster previews reject executable URLs and unsupported inline content',()=>{
 for(const invalid of ['javascript:alert(1)','data:text/html,<script>x</script>','data:image/svg+xml,<svg/>','//elsewhere.test/image','https://user:pass@example.com/file','/\\elsewhere.test/image'])assert.equal(carouselUrl(invalid,true),undefined);
 assert.equal(carouselUrl('/media/official/product.jpg',true),'/media/official/product.jpg');assert.equal(carouselUrl('https://idealmakoo.com/pages/3/products'),'https://idealmakoo.com/pages/3/products');assert.equal(carouselUrl('data:image/png;base64,aGVsbG8=',true),'data:image/png;base64,aGVsbG8=');assert.equal(carouselUrl('data:image/png;base64,aGVsbG8='),undefined);
});


test('stable document gutters preserve existing padding through nested locks while automatic gutters compensate',()=>{
 for(const {gutter,innerWidth,padding} of [
  {gutter:'stable',innerWidth:1350,padding:'7px'},
  {gutter:'stable both-edges',innerWidth:1350,padding:'7px'},
  {gutter:'auto',innerWidth:1350,padding:'22px'},
  {gutter:'auto',innerWidth:1335,padding:'7px'},
 ]){
  const bodyStyle={position:'',top:'',left:'',right:'',width:'',overflow:'',paddingRight:'7px'},htmlStyle={overflow:'auto',scrollBehavior:'smooth'};
  const originalBody={...bodyStyle},originalHtml={...htmlStyle},scrolls=[];
  const body={style:bodyStyle},html={style:htmlStyle,clientWidth:1335};
  const doc={body,documentElement:html,defaultView:{innerWidth,scrollX:0,scrollY:100,getComputedStyle:element=>element===html?{scrollbarGutter:gutter}:{paddingRight:'7px'},scrollTo:value=>scrolls.push(value)}};
  const outer=lockDocumentScroll(doc),inner=lockDocumentScroll(doc);
  assert.equal(bodyStyle.paddingRight,padding,gutter);assert.equal(htmlStyle.overflow,'hidden');
  outer();assert.equal(bodyStyle.position,'fixed');assert.equal(scrolls.length,0);
  inner();inner();assert.deepEqual(bodyStyle,originalBody);assert.deepEqual(htmlStyle,originalHtml);assert.equal(scrolls.length,1);
 }
});

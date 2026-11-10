import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './helpers/load-ts.mjs';

const auth = await loadTs('src/lib/auth.ts');
const policy = await loadTs('src/components/workspace/permissions.ts');
const { createWorkspaceSeed, recordText } = await loadTs('src/data/workspace-seed.ts');
const { mergeWorkspaceRequests } = await loadTs('src/components/workspace/store.ts');
const { roleExperience } = await loadTs('src/components/workspace/role-content.ts');
const {createCustomProduct}=await loadTs('src/lib/custom-products.ts');
const {createProductDraft}=await loadTs('src/components/workspace/product-editor-data.ts');
const {createProductRelease}=await loadTs('src/lib/product-release.ts');
const actor = role => ({role,id:`demo-${role}`,locale:'fa'});
const record = (collection,patch={}) => ({...createWorkspaceSeed().records.find(row=>row.collection===collection),...patch});
const page = patch => ({...createWorkspaceSeed().pages[0],author:'contentEditor',authorId:'demo-contentEditor',...patch});
const note = (id='event-test',visibility='internal') => ({id,text:recordText('Factory follow-up'),actor:'support',at:'2026-10-17T10:00:00Z',visibility});

test('unknown roles and arbitrary route suffixes fail closed across aliases',()=>{
 for(const role of ['','root','owner','Admin','toString','__proto__'])for(const route of ['','products','crm/leads','roles'])assert.equal(auth.authorize(role,route),false);
 for(const role of auth.roles)for(const route of ['products/delete-all','cms/unknown','crm/settings','crm/accounts/private','monitoring/secret'])assert.equal(auth.authorize(role,route),false);
 assert.equal(auth.canonicalWorkspaceSection('/admin/crm/rfqs/'),'leads');
 assert.equal(auth.canonicalWorkspaceSection('cms/products'),'products');
 assert.equal(auth.authorize('business','crm/rfqs'),true);
 assert.equal(auth.authorize('business','users'),false);
});

test('each staff role has distinct allowed work and the customer has no workspace grant',()=>{
 const examples={superAdmin:['roles','settings'],admin:['staff','settings'],contentEditor:['content','pages'],productManager:['products','resources'],scientificReviewer:['reviews','products'],translator:['translations','glossary'],publisher:['publications','pages'],hr:['hr'],business:['crm/leads','crm/quotes'],analyst:['crm/reports','monitoring/performance'],support:['crm/cases','crm/inbox']};
 for(const [role,routes] of Object.entries(examples))for(const route of routes)assert.equal(auth.authorize(role,route),true,`${role}: ${route}`);
 for(const module of auth.workspaceModules)for(const action of auth.workspaceActions)assert.equal(auth.canWorkspace('customer',action,module),false);
 assert.equal(auth.canWorkspace('contentEditor','edit','products'),false);
 assert.equal(auth.canWorkspace('productManager','edit','pages'),false);
 assert.equal(auth.canWorkspace('scientificReviewer','edit','products'),false);
 assert.equal(auth.canWorkspace('scientificReviewer','review','products'),true);
 assert.equal(auth.canWorkspace('publisher','edit','pages'),false);
 assert.equal(auth.canWorkspace('publisher','publish','pages'),true);
 assert.equal(auth.canWorkspace('business','review','quotes'),false);
 assert.equal(auth.canWorkspace('business','issue','quotes'),true);
 assert.equal(auth.canWorkspace('admin','manage','roles'),false);
 assert.equal(auth.canWorkspace('superAdmin','manage','roles'),true);
});

test('role descriptions, priorities and modules are complete in five languages',()=>{
 const profiles=Object.entries(roleExperience);assert.equal(profiles.length,11);
 assert.equal(new Set(profiles.map(([,value])=>value.title.fa)).size,11);
 for(const [role,profile] of profiles){
  assert.equal(auth.authorize(role,profile.primary),true,role);
  for(const key of ['title','intro','focus'])for(const lang of ['fa','en','tr','ar','ru'])assert.ok(profile[key][lang]?.trim(),`${role} ${key} ${lang}`);
 }
});

test('translator can change four destination languages but cannot edit the Persian source or direct product routes',()=>{
 assert.deepEqual(auth.allowedTranslationLocales('translator'),['en','tr','ar','ru']);
 assert.equal(auth.canWorkspace('translator','translate','products',{locale:'fa'}),false);
 for(const locale of ['en','tr','ar','ru'])assert.equal(auth.canWorkspace('translator','translate','products',{locale}),true);
 assert.equal(auth.authorize('translator','products'),false);
 assert.equal(auth.authorize('translator','cms/pages'),false);
 assert.equal(auth.canWorkspace('translator','view','products'),true,'the dedicated desk can project source content');
});

test('analyst monitoring restrictions survive slash and admin aliases',()=>{
 for(const route of ['monitoring/security','/monitoring/jobs/','/admin/monitoring/storage/','admin/monitoring/recovery'])assert.equal(auth.authorize('analyst',route),false,route);
 for(const route of ['monitoring','/admin/monitoring/performance/','monitoring/business'])assert.equal(auth.authorize('analyst',route),true);
});

test('review separation uses account identity, including a switched role, and legacy role fallback',()=>{
 assert.equal(auth.canWorkspace('admin','review','pages',{authorId:'same',actorId:'same',authorRole:'contentEditor'}),false);
 assert.equal(auth.canWorkspace('admin','review','pages',{authorId:'author-1',actorId:'author-2',authorRole:'admin'}),true);
 assert.equal(auth.canWorkspace('admin','review','pages',{authorRole:'admin'}),false);
 const before=record('research',{status:'review',author:'productManager',authorId:'demo-productManager'});
 const approved={...before,status:'approved',approvedBy:'scientificReviewer',approvedById:'demo-scientificReviewer'};
 assert.equal(policy.canChangeRecord(before,approved,actor('scientificReviewer')),true);
 assert.equal(policy.canChangeRecord(before,{...approved,approvedById:'somebody-else'},actor('scientificReviewer')),false);
 assert.equal(policy.canChangeRecord(before,{...approved,summary:recordText('Changed during review')},actor('scientificReviewer')),false);
});

test('a stale account or role cannot use a captured workspace command',()=>{
 const user=actor('contentEditor');
 assert.equal(policy.matchesWorkspaceSession({id:user.id,role:user.role},user),true);
 for(const value of [null,{},[],{id:'another',role:user.role},{id:user.id,role:'superAdmin'},{id:user.id,role:'customer'}])assert.equal(policy.matchesWorkspaceSession(value,user),false);
 assert.equal(policy.matchesWorkspaceSession({id:'x',role:'unknown'},{id:'x',role:'unknown',locale:'en'}),false);
});

test('scoped search and exports exclude private HR, quality, staff and audit data from sales',()=>{
 const seed=createWorkspaceSeed();
 const hr=record('hr',{id:'hr-private',requestId:'candidate-private',title:recordText('PRIVATE-HR'),email:'PRIVATE-HR@example.invalid',history:[{...note('hr-event'),text:recordText('PRIVATE-HR-AUDIT'),actor:'business'}]});
 const quality=record('tickets',{id:'quality-private',tags:['quality'],title:recordText('PRIVATE-QUALITY'),history:[{...note('quality-event'),text:recordText('PRIVATE-QUALITY-AUDIT'),actor:'business'}]});
 const raw={...seed,records:[hr,quality,...seed.records],audit:[...hr.history,...quality.history,...seed.audit]};
 const scoped=policy.projectWorkspaceState(raw,'business');
 assert.ok(scoped.records.some(row=>row.collection==='leads'));
 assert.ok(!scoped.records.some(row=>['hr','staff','products'].includes(row.collection)));
 assert.doesNotMatch(JSON.stringify(scoped),/PRIVATE-HR|PRIVATE-QUALITY/);
 assert.equal(scoped.pages.length,0);assert.equal(scoped.forms.length,0);
 assert.equal(raw.records[0].title.en,'PRIVATE-HR');
});

test('analyst gets only numerical aggregates without individual requests',()=>{
 const seed=createWorkspaceSeed();const scoped=policy.projectWorkspaceState(seed,'analyst');
 for(const key of ['records','pages','forms','media','aiJobs','audit'])assert.deepEqual(scoped[key],[]);
 const insights=policy.workspaceInsights(seed,'analyst');
 assert.ok(insights.total>0);assert.ok(insights.counts.leads>0);
 assert.deepEqual(Object.keys(insights).sort(),['counts','stages','statuses','total']);
 assert.doesNotMatch(JSON.stringify(insights),/@|organization|requestId|title/);
});

test('visible record edits preserve all hidden rows and cannot guess hidden identifiers',()=>{
 const raw=createWorkspaceSeed();const scoped=policy.projectWorkspaceState(raw,'business');
 const lead=scoped.records.find(row=>row.collection==='leads');
 const next={...scoped,records:scoped.records.map(row=>row.id===lead.id?{...row,summary:recordText('Factory technical follow-up')}:row)};
 const applied=policy.applyWorkspaceMutation(raw,next,actor('business'));
 assert.equal(applied.ok,true);assert.equal(applied.state.records.length,raw.records.length);
 assert.deepEqual(applied.state.pages,raw.pages);
 const privateRow=raw.records.find(row=>row.collection==='hr');
 const denied=policy.applyWorkspaceMutation(raw,{...scoped,records:[...scoped.records,{...privateRow,collection:'leads'}]},actor('business'));
 assert.equal(denied.ok,false);assert.equal(denied.state,raw);
});

test('a forbidden change causes the whole local transaction to fail',()=>{
 const raw=createWorkspaceSeed();const scoped=policy.projectWorkspaceState(raw,'contentEditor');
 const news=scoped.records.find(row=>row.collection==='news');const product=scoped.records.find(row=>row.collection==='products');
 const next={...scoped,records:scoped.records.map(row=>row.id===news.id?{...row,summary:recordText('Allowed draft change'),status:'draft',approvedBy:undefined}:row.id===product.id?{...row,summary:recordText('Forbidden specification change'),status:'draft'}:row)};
 const result=policy.applyWorkspaceMutation(raw,next,actor('contentEditor'));
 assert.equal(result.ok,false);assert.equal(result.state,raw);
});

test('quality reviewer notes preserve redacted identity fields in the original store',()=>{
 const q=record('tickets',{id:'quality-test',tags:['quality'],title:recordText('Private customer'),email:'customer@example.invalid',organization:'Private organization',requestId:'private-request',amount:'100',details:{private:'kept'},history:[]});
 const raw={...createWorkspaceSeed(),records:[q]};
 const view=policy.projectWorkspaceState(raw,'scientificReviewer');const visible=view.records[0];
 assert.equal(visible.email,undefined);assert.equal(visible.requestId,undefined);assert.equal(visible.details,undefined);assert.notEqual(visible.title.en,q.title.en);
 const next={...view,records:[{...visible,history:[note('quality-note')]}]};
 const result=policy.applyWorkspaceMutation(raw,next,actor('scientificReviewer'));
 assert.equal(result.ok,true);assert.equal(result.state.records[0].email,q.email);assert.equal(result.state.records[0].requestId,q.requestId);assert.deepEqual(result.state.records[0].title,q.title);assert.deepEqual(result.state.records[0].details,q.details);
 assert.equal(policy.canRecordAction(actor('scientificReviewer'),'reply',visible),false);
});

test('HR applicants cannot be published or transformed into a public vacancy by clearing their source request',()=>{
 const before=record('hr',{requestId:'candidate-1',status:'new'});
 assert.equal(policy.canRecordAction(actor('admin'),'publish',before),false);
 assert.equal(policy.canChangeRecord(before,{...before,requestId:undefined},actor('hr')),false);
 assert.equal(policy.canReadRecord('publisher',before),false);
});

test('record translations preserve all unrelated fields and invalidate prior approval',()=>{
 const before=record('products',{status:'approved',approvedBy:'scientificReviewer',approvedById:'demo-scientificReviewer'});
 const next={...before,summary:{...before.summary,en:'Translated factory summary'},status:'draft',approvedBy:undefined,approvedById:undefined,author:'translator'};
 assert.equal(policy.canChangeRecord(before,next,actor('translator')),true);
 assert.equal(policy.canChangeRecord(before,{...next,summary:{...next.summary,fa:'Changed source'}},actor('translator')),false);
 assert.equal(policy.canChangeRecord(before,{...next,details:{injected:true}},actor('translator')),false);
 assert.equal(policy.canChangeRecord(before,{...next,status:'approved'},actor('translator')),false);
});

test('page translations allow text and CTA labels while preserving order, visibility, products and links',()=>{
 const before=page({locale:'en',blocks:[{id:'home-hero',type:'hero',title:'Source title',body:'Source body',hidden:false,link:'/en/products/',options:{visual:'scene',productIds:['apple'],ctaLabel:'Products'}}],status:'approved',approvedBy:'publisher',approvedById:'demo-publisher'});
 const next={...before,status:'draft',approvedBy:undefined,approvedById:undefined,blocks:[{...before.blocks[0],body:'Translated body',options:{...before.blocks[0].options,ctaLabel:'Browse factory products'}}]};
 assert.equal(policy.canChangePage(before,next,actor('translator')),true);
 const classified={...next,taxonomy:{category:'Factory / materials',tags:['polymer','catalogue']}};
 assert.equal(policy.canChangePage(before,classified,actor('translator')),true,'locale taxonomy is editable authored text');
 assert.equal(policy.canChangePage(before,{...classified,status:'approved',approvedBy:before.approvedBy,approvedById:before.approvedById},actor('translator')),false,'classification cannot retain prior approval');
 assert.equal(policy.canChangePage({...before,locale:'fa'},{...classified,locale:'fa'},actor('translator')),false,'classification respects language scope');
 for(const patch of [{hidden:true},{link:'/en/contact/'},{options:{visual:'image'}},{id:'replacement'}])assert.equal(policy.canChangePage(before,{...next,blocks:[{...next.blocks[0],...patch}]},actor('translator')),false);
 assert.equal(policy.canChangePage({...before,locale:'fa'},{...next,locale:'fa'},actor('translator')),false);
});

test('a translator can create a destination version only by cloning an existing source layout',()=>{
 const source=page({locale:'fa',slug:'test-source'});const raw={...createWorkspaceSeed(),pages:[source]};const scoped=policy.projectWorkspaceState(raw,'translator');
 const clone={...source,id:'target-en',locale:'en',status:'draft',author:'translator',authorId:'demo-translator'};
 assert.equal(policy.applyWorkspaceMutation(raw,{...scoped,pages:[...scoped.pages,clone]},actor('translator')).ok,true);
 assert.equal(policy.applyWorkspaceMutation(raw,{...scoped,pages:[...scoped.pages,{...clone,slug:'unknown-route'}]},actor('translator')).ok,false);
});

test('publication requires the approved exact snapshot and authorized content collection',()=>{
 const source=page({status:'approved',approvedBy:'scientificReviewer',approvedById:'demo-scientificReviewer'});
 const publication={id:source.id,kind:'page',locale:source.locale,title:source.title,summary:source.summary,blocks:source.blocks};
 assert.equal(policy.canPublishWorkspaceSnapshot(actor('publisher'),publication,source),true);
 assert.equal(policy.canPublishWorkspaceSnapshot(actor('contentEditor'),publication,source),false);
 assert.equal(policy.canPublishWorkspaceSnapshot(actor('publisher'),{...publication,title:'Changed after approval'},source),false);
 assert.equal(policy.canPublishWorkspaceSnapshot(actor('publisher'),publication,{...source,status:'draft'}),false);
 assert.equal(policy.canPublishWorkspaceSnapshot(actor('publisher'),publication,{...source,approvedById:source.authorId}),false);
 const staff=record('staff',{id:source.id,status:'approved',approvedBy:'admin'});
 assert.equal(policy.canPublishWorkspaceSnapshot(actor('publisher'),publication,staff),false);
});

test('withdrawal in the customer portal reaches the linked CRM record once without erasing its history',()=>{
 const request={id:'withdraw-test',kind:'rfq',name:'Factory laboratory inquiry',message:'Technical request',createdAt:'2026-10-17T10:00:00Z',status:'received'};
 const initial=mergeWorkspaceRequests(createWorkspaceSeed(),[request]);
 const next=mergeWorkspaceRequests(initial,[{...request,status:'withdrawn'}]);
 const linked=next.records.find(row=>row.id===request.id);
 assert.equal(linked.status,'withdrawn');assert.equal(linked.history.filter(event=>event.id==='withdrawn-'+request.id).length,1);
 assert.equal(mergeWorkspaceRequests(next,[{...request,status:'withdrawn'}]),next);
});

test('complete snapshot recovery is an explicit administrator capability with shape validation',()=>{
 const seed=createWorkspaceSeed();assert.equal(policy.validWorkspaceSnapshot(seed),true);
 assert.equal(policy.canRestoreWorkspaceSnapshot(actor('admin'),seed),true);
 assert.equal(policy.canRestoreWorkspaceSnapshot(actor('superAdmin'),seed),true);
 for(const role of ['business','contentEditor','publisher','analyst','support','customer'])assert.equal(policy.canRestoreWorkspaceSnapshot(actor(role),seed),false);
 for(const broken of [null,{...seed,records:[{id:'broken'}]},{...seed,records:[...seed.records,seed.records[0]]},{...seed,pages:[{...seed.pages[0],blocks:[null]}]},{...seed,forms:[{id:'broken',fields:[]}]}])assert.equal(policy.validWorkspaceSnapshot(broken),false);
});

test('new-product publication requires its exact stored definition and valid independently reviewed release',()=>{
 const definition=createCustomProduct({id:'custom-test-factory-material',slug:'test-factory-material',brand:'Ideal Makoo editorial',family:'materials',title:'Editorial material draft',locale:'en'});
 const draft=createProductDraft(definition);draft.localized.en.shortDescription='Authored draft pending factory confirmation';
 const release=createProductRelease(draft,definition);
 const source=record('products',{id:definition.id,product:definition.id,title:definition.name,summary:{...definition.description,en:draft.localized.en.shortDescription},status:'approved',author:'productManager',authorId:'demo-productManager',approvedBy:'scientificReviewer',approvedById:'demo-scientificReviewer',details:{customProduct:definition,productReviewDraft:release}});
 const publication={id:source.id,kind:'product',locale:'en',title:source.title.en,summary:source.summary.en,blocks:[],productRelease:release,customProduct:definition};
 assert.equal(policy.canPublishWorkspaceSnapshot(actor('publisher'),publication,source),true);
 assert.equal(policy.canPublishWorkspaceSnapshot(actor('publisher'),{...publication,id:'editorial-copy'},{...source,id:'editorial-copy'}),true,'an editorial record retains the linked custom product identity');
 assert.equal(policy.canPublishWorkspaceSnapshot(actor('publisher'),publication,{...source,product:'custom-different-product'}),false);
 assert.equal(policy.canPublishWorkspaceSnapshot(actor('publisher'),{...publication,customProduct:{...definition,brand:'Injected brand'}},source),false);
 assert.equal(policy.canPublishWorkspaceSnapshot(actor('publisher'),{...publication,customProduct:undefined},source),false);
 assert.equal(policy.canPublishWorkspaceSnapshot(actor('publisher'),{...publication,productRelease:undefined},source),false);
 assert.equal(policy.canPublishWorkspaceSnapshot(actor('publisher'),{...publication,productRelease:{...release,revision:NaN}},source),false);
});

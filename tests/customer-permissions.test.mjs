import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './helpers/load-ts.mjs';

const { applyCustomerRequestPatch, createQuoteResponse } = await loadTs('src/components/account/portal-data.ts');
const customer = {id:'local-owner',email:'owner@example.test',name:'Customer',role:'customer',demo:true};
const at = Date.parse('2026-01-02T10:00:00.000Z');
const internal = {id:'internal',body:'Internal staff note',visibility:'internal',createdAt:'2026-01-01T10:00:00.000Z',sender:'Support'};
const quote = {id:'Q1',number:'Q-1',title:'Factory products',amount:'250',currency:'IRR',status:'issued',issuedAt:'2026-01-01T10:00:00.000Z',validUntil:'2026-01-05T10:00:00.000Z',snapshotHash:'commercial-snapshot',terms:'Issued terms'};
const record = (patch = {}) => ({id:'R1',ownerId:customer.id,name:customer.name,email:customer.email,organization:'Lab',message:'Request',kind:'rfq',productIds:[],status:'waiting_customer',createdAt:'2026-01-01T10:00:00.000Z',messages:[internal],sharedQuotes:[quote],version:3,...patch});
const publicReply = {id:'reply-1',body:'  Please continue  ',visibility:'public',createdAt:'2000-01-01',sender:'Impersonated staff'};

test('personal request writes require ownership even if a staff role is supplied', () => {
  const source = record({ownerId:'another',email:'another@example.test'});
  for (const session of [customer,{...customer,role:'superAdmin'},null]) {
    assert.equal(applyCustomerRequestPatch(source,{status:'withdrawn'},session,at),null);
  }
  assert.equal(applyCustomerRequestPatch(record({ownerId:'guest'}),{status:'withdrawn'},null,at).status,'withdrawn');
});

test('customer replies append one public message and preserve staff notes and identity', () => {
  const source = record(), before = structuredClone(source);
  const result = applyCustomerRequestPatch(source,{messages:[internal,publicReply],status:'in_review'},customer,at);
  assert.equal(result.version,4);
  assert.equal(result.status,'in_review');
  assert.deepEqual(result.messages[0],internal);
  assert.deepEqual(result.messages[1],{...publicReply,body:'Please continue',sender:customer.name,createdAt:new Date(at).toISOString()});
  assert.deepEqual(source,before);
});

test('request patch guards reject staff field edits, forged notes, and stale message snapshots', () => {
  const source = record();
  const invalid = [
    {ownerId:'attacker'}, {email:'attacker@example.test'}, {status:'resolved'},
    {messages:[{...internal,body:'Rewritten'},publicReply]},
    {messages:[internal,{...publicReply,visibility:'internal'}]},
    {messages:[internal,{...publicReply,body:'   '}]},
    {messages:[internal,publicReply],status:'closed'},
    {messages:[internal,publicReply],organization:'Rewritten'},
    {messages:[internal,publicReply, {...publicReply,id:'reply-2'}]},
  ];
  for (const patch of invalid) assert.equal(applyCustomerRequestPatch(source,patch,customer,at),null);
  const newer = record({messages:[internal,{...publicReply,id:'newer',body:'Another reply'}]});
  assert.equal(applyCustomerRequestPatch(newer,{messages:[internal,publicReply]},customer,at),null);
  for (const status of ['withdrawn','closed']) assert.equal(applyCustomerRequestPatch(record({status}),{messages:[internal,publicReply]},customer,at),null);
});

test('only an open request can be withdrawn through the customer action', () => {
  assert.equal(applyCustomerRequestPatch(record(),{status:'withdrawn'},customer,at).version,4);
  for (const status of ['withdrawn','closed','resolved','complete']) assert.equal(applyCustomerRequestPatch(record({status}),{status:'withdrawn'},customer,at),null);
});

test('one valid quote response preserves the commercial snapshot and rejects amount changes or expiry races', () => {
  const response = createQuoteResponse(quote,'revision_requested','  Please revise quantities  ',at);
  const result = applyCustomerRequestPatch(record(),{sharedQuotes:[response]},customer,at);
  assert.equal(result.sharedQuotes[0].amount,quote.amount);
  assert.equal(result.sharedQuotes[0].snapshotHash,quote.snapshotHash);
  assert.equal(result.sharedQuotes[0].customerResponse,'Please revise quantities');
  assert.equal(result.sharedQuotes[0].status,'revision_requested');
  for (const changed of [{amount:'1'},{currency:'USD'},{terms:'Replaced'},{snapshotHash:'forged'},{newInternalField:true}]) {
    assert.equal(applyCustomerRequestPatch(record(),{sharedQuotes:[{...response,...changed}]},customer,at),null);
  }
  assert.equal(applyCustomerRequestPatch(record(),{sharedQuotes:[response]},customer,Date.parse(quote.validUntil)),null);
  assert.equal(applyCustomerRequestPatch(record({sharedQuotes:[response]}),{sharedQuotes:[{...response,status:'declined'}]},customer,at),null);
  assert.equal(applyCustomerRequestPatch(record(),{sharedQuotes:[]},customer,at),null);
});

test('server-issued quote identities are accepted unchanged and cannot be redirected to another request or locale', () => {
  const issued={...quote,recordId:'crm-quote-1',requestId:'R1',locale:'en'};
  const response=createQuoteResponse(issued,'accepted_interest','Reviewed',at);
  const source=record({sharedQuotes:[issued]});
  const result=applyCustomerRequestPatch(source,{sharedQuotes:[response]},customer,at);
  assert.equal(result.sharedQuotes[0].recordId,issued.recordId);
  assert.equal(result.sharedQuotes[0].requestId,'R1');assert.equal(result.sharedQuotes[0].locale,'en');
  for(const mutation of [{recordId:'other-quote'},{requestId:'another-request'},{locale:'fa'}])assert.equal(applyCustomerRequestPatch(source,{sharedQuotes:[{...response,...mutation}]},customer,at),null);
});

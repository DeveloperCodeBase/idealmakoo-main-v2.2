import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './helpers/load-ts.mjs';
const { parseFrontRequests, parseInquiryLines, parseRequestMessages, parseSharedQuotes, commercialQuoteLines } = await loadTs('src/lib/frontend-state.ts');
const { safeCsvCell } = await loadTs('src/lib/storage.ts');

test('malformed persisted request fields cannot crash portal status, conversation or quote views', () => {
  const [request] = parseFrontRequests([null, false, {}, {id:'r-1',kind:'rfq',name:'Test',email:'test@example.invalid',createdAt:'2026-10-17T10:00:00Z',status:{},message:7,organization:[],productIds:{},messages:[{body:'incomplete'}],sharedQuotes:{},version:NaN}]);
  assert.equal(request.status, 'received');
  assert.equal(request.organization, '');
  assert.equal(request.message, '');
  assert.deepEqual(request.messages, []);
  assert.deepEqual(request.sharedQuotes, []);
  assert.deepEqual(request.productIds, []);
  assert.equal(request.version, 1);
});
test('message parsing requires identity, timestamp, sender and explicit visibility', () => {
  const publicMessage = {id:'m-1',body:'Reply',createdAt:'2026-10-17T10:00:00Z',sender:'support',visibility:'public'};
  const internalMessage = {...publicMessage,id:'m-2',visibility:'internal'};
  assert.deepEqual(parseRequestMessages([publicMessage, internalMessage, {...publicMessage, visibility:'all'}, {...publicMessage,createdAt:{}}]), [publicMessage, internalMessage]);
});
test('persisted variant requests retain valid teeth codes and exclude material variants', () => {
  const lines = parseInquiryLines([{productId:'apple',quantity:3,shade:' A2 ',mould:' 10 ',note:'Note'}, {productId:'light-cure-composite',quantity:2,shade:'A2',mould:'10'}, {productId:'apple',quantity:1.5}, {productId:'apple',quantity:100001}, {productId:'missing',quantity:1}]);
  assert.equal(lines.length, 2);
  assert.equal(lines[0].shade, 'A2');
  assert.equal(lines[0].mould, '10');
  assert.equal(lines[1].shade, undefined);
  assert.equal(lines[1].mould, undefined);
});
test('shared quote snapshots reject incomplete fields and unknown response states', () => {
  const quote = {id:'q-1',number:'IM-Q-1',title:'Proposal',amount:'100',currency:'IRR',issuedAt:'2026-10-17T10:00:00Z',snapshotHash:'test-hash',status:'issued'};
  const quotes = parseSharedQuotes([quote, {...quote, amount:null}, {...quote, status:'paid'}]);
  assert.equal(quotes.length, 1);
  assert.equal(quotes[0].snapshotHash, 'test-hash');
  assert.equal(quotes[0].status, 'issued');
});
test('CSV exports neutralize spreadsheet formulas and preserve quotes and plain Unicode', () => {
  for (const value of ['=1+2', '+123', '-123', '@SUM(A1)', '\tformula', '\rformula']) assert.ok(safeCsvCell(value).startsWith('"\''));
  assert.equal(safeCsvCell('ایده‌آل "ماکو"'), '"ایده‌آل ""ماکو"""');
});


test('issued commercial line snapshots include customer fields only and preserve zero versus unknown', () => {
  const draft = {lines:[{id:'line-1',productId:'apple',titleSnapshot:'APPLE',unit:'pack',quantityDecimal:'2',unitPriceDecimal:'0',discountPercentDecimal:'0',currency:'IRR',internalCost:'PRIVATE-COST'},{id:'line-2',productId:'apple',titleSnapshot:'APPLE',unit:'pack',quantityDecimal:'1',unitPriceDecimal:null,discountPercentDecimal:'0',currency:'IRR'}],estimate:{lines:[{lineId:'line-1',netDecimal:'0'},{lineId:'line-2',netDecimal:null}]},internalMargin:'PRIVATE-MARGIN'};
  const lines = commercialQuoteLines(draft);
  assert.equal(lines[0].unitPriceDecimal,'0');
  assert.equal(lines[1].unitPriceDecimal,null);
  assert.equal(lines[0].netDecimal,'0');
  assert.doesNotMatch(JSON.stringify(lines),/PRIVATE-COST|PRIVATE-MARGIN/);
  const [quote] = parseSharedQuotes([{id:'q1',number:'Q1',title:'Factory quote',amount:'0',currency:'IRR',status:'issued',issuedAt:'2026-10-17T13:00:00Z',snapshotHash:'test',lines,terms:'Reviewed terms'}]);
  assert.deepEqual(quote.lines,lines);
  assert.equal(quote.terms,'Reviewed terms');
});

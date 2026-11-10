import type {QuoteEnvelope,QuoteCustomerSnapshot,QuoteSellerSnapshot,QuotePricebookSnapshot} from '@/types/commercial';
import { products,type Product } from '@/data/catalog';
import type { FrontRequest, InquiryLine, RequestMessage, SharedQuote, SharedQuoteLine, EventBooking } from '@/types/frontend';

const object = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const string = (value: unknown, fallback = '') => typeof value === 'string' ? value : fallback;
const optionalString = (value: unknown) => typeof value === 'string' ? value : undefined;
export const inquiryIdentity = (line: InquiryLine) => JSON.stringify([line.productId,line.shade||'',line.mould||'',line.variantId||'',line.sku||'',line.unit||'']);

/** Validate persisted/browser-loaded data at the boundary, before any view uses it. */
export function parseInquiryLines(value: unknown, catalog: Product[] = products): InquiryLine[] {
  if (!Array.isArray(value)) return [];
  return value.filter(object).flatMap(item => {
    const product = catalog.find(product => product.id === item.productId);
    if (!product || typeof item.quantity !== 'number' || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 100000) return [];
    return [{
      productId: product.id,
      quantity: item.quantity,
      ...(product.family === 'teeth' ? {
        shade: string(item.shade).trim().slice(0, 40) || undefined,
        mould: string(item.mould).trim().slice(0, 40) || undefined,
      } : {}),
      note: string(item.note).slice(0, 1000) || undefined,
      ...(string(item.variantId).trim()?{variantId:string(item.variantId).trim().slice(0,240)}:{}),
      ...(string(item.sku).trim()?{sku:string(item.sku).trim().slice(0,240)}:{}),
      ...(string(item.unit).trim()?{unit:string(item.unit).trim().slice(0,240)}:{}),
    }];
  });
}

export function parseRequestMessages(value: unknown): RequestMessage[] {
  if (!Array.isArray(value)) return [];
  return value.filter(object).filter(item =>
    ['id', 'body', 'sender', 'createdAt'].every(key => typeof item[key] === 'string') &&
    (item.visibility === 'public' || item.visibility === 'internal'),
  ).map(item => ({
    id: item.id as string,
    body: item.body as string,
    sender: item.sender as string,
    createdAt: item.createdAt as string,
    visibility: item.visibility as RequestMessage['visibility'],
  }));
}

export function parseSharedQuoteLines(value: unknown): SharedQuoteLine[] {
  if (!Array.isArray(value)) return [];
  const decimal = (value:unknown): value is string => typeof value === 'string' && /^\d+(\.\d+)?$/.test(value);
  return value.filter(object).filter(line => ['id','productId','titleSnapshot','unit','currency'].every(key => typeof line[key] === 'string') && decimal(line.quantityDecimal) && decimal(line.discountPercentDecimal) && (line.unitPriceDecimal === null || decimal(line.unitPriceDecimal))).slice(0,100).map(line => ({id:line.id as string,productId:line.productId as string,titleSnapshot:line.titleSnapshot as string,unit:line.unit as string,currency:line.currency as string,quantityDecimal:line.quantityDecimal as string,discountPercentDecimal:line.discountPercentDecimal as string,unitPriceDecimal:line.unitPriceDecimal as string|null,netDecimal:decimal(line.netDecimal)?line.netDecimal:null}));
}
export function commercialQuoteLines(value: unknown): SharedQuoteLine[] {
  if (!object(value) || !Array.isArray(value.lines)) return [];
  const estimates = object(value.estimate) && Array.isArray(value.estimate.lines) ? value.estimate.lines.filter(object) : [];
  return parseSharedQuoteLines(value.lines.filter(object).map(line => ({...line,netDecimal:estimates.find(estimate => estimate.lineId === line.id)?.netDecimal ?? null})));
}

function quoteIdentitySnapshot<K extends string>(value:unknown,keys:readonly K[]):Record<K,string>|undefined {
 if(!object(value)||Object.keys(value).some(key=>!keys.includes(key as K))||keys.some(key=>typeof value[key]!=='string'||value[key].length>5000))return undefined;
 return Object.fromEntries(keys.map(key=>[key,string(value[key])])) as Record<K,string>;
}
function quotePricebookSnapshot(value:unknown):QuotePricebookSnapshot|undefined {
 if(!object(value)||Object.keys(value).some(key=>!['id','pricebookId','version','market','currency','checksum'].includes(key))||!['id','pricebookId','market','currency','checksum'].every(key=>typeof value[key]==='string')||!Number.isSafeInteger(value.version)||Number(value.version)<1||!['IRR','USD','EUR','TRY','RUB'].includes(string(value.currency)))return undefined;
 return{id:string(value.id),pricebookId:string(value.pricebookId),version:Number(value.version),market:string(value.market),currency:string(value.currency),checksum:string(value.checksum)};
}
function quoteFileMetadata(value:Record<string,unknown>):Pick<SharedQuote,'fileSha256'|'fileByteCount'|'fileCreatedAt'|'fileOrigin'>{
 if(typeof value.fileSha256!=='string'||!/^[a-f0-9]{64}$/i.test(value.fileSha256)||!Number.isSafeInteger(value.fileByteCount)||Number(value.fileByteCount)<1||typeof value.fileCreatedAt!=='string'||!/^\d{4}-\d{2}-\d{2}T/.test(value.fileCreatedAt)||!Number.isFinite(Date.parse(value.fileCreatedAt))||!['issued','legacy-rendered'].includes(string(value.fileOrigin)))return{};
 return{fileSha256:value.fileSha256,fileByteCount:Number(value.fileByteCount),fileCreatedAt:value.fileCreatedAt,fileOrigin:value.fileOrigin as 'issued'|'legacy-rendered'};
}
export function parseQuoteEnvelopes(value:unknown):QuoteEnvelope[]{
 if(!Array.isArray(value))return[];const seen=new Set<string>();
 return value.filter(object).filter(item=>['recordId','requestId','currentRevisionId'].every(key=>typeof item[key]==='string'&&item[key].length>0&&item[key].length<=160)&&Number.isSafeInteger(item.version)&&Number(item.version)>0&&typeof item.updatedAt==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(item.updatedAt)&&Number.isFinite(Date.parse(item.updatedAt))).slice(0,1000).filter(item=>{const key=string(item.requestId)+':'+string(item.recordId);if(seen.has(key))return false;seen.add(key);return true;}).map(item=>({recordId:string(item.recordId),requestId:string(item.requestId),currentRevisionId:string(item.currentRevisionId),version:Number(item.version),updatedAt:string(item.updatedAt)}));
}
export function parseEventBooking(value:unknown):EventBooking|undefined{
 if(!object(value)||!['id','sessionId','requestId','title','startsAt','endsAt','timezone','location'].every(key=>typeof value[key]==='string'&&value[key].length<=5000)||!['confirmed','waitlisted','cancelled','attended','no_show'].includes(string(value.status))||!['event','factory_visit'].includes(string(value.kind))||!Number.isSafeInteger(value.seats)||Number(value.seats)<1||Number(value.seats)>20||!Number.isSafeInteger(value.version)||Number(value.version)<1||!Number.isFinite(Date.parse(string(value.startsAt)))||!Number.isFinite(Date.parse(string(value.endsAt))))return undefined;
 return{id:string(value.id),sessionId:string(value.sessionId),requestId:string(value.requestId),title:string(value.title),startsAt:string(value.startsAt),endsAt:string(value.endsAt),timezone:string(value.timezone),location:string(value.location),status:value.status as EventBooking['status'],kind:value.kind as EventBooking['kind'],seats:Number(value.seats),version:Number(value.version)};
}

export function parseSharedQuotes(value: unknown): SharedQuote[] {
  if (!Array.isArray(value)) return [];
  return value.filter(object).filter(item =>
    ['id', 'number', 'title', 'amount', 'currency', 'issuedAt', 'snapshotHash'].every(key => typeof item[key] === 'string') &&
    ['issued', 'accepted_interest', 'declined', 'revision_requested'].includes(string(item.status)),
  ).map(item => ({
    id: item.id as string, number: item.number as string, title: item.title as string,
    amount: item.amount as string, currency: item.currency as string,
    status: item.status as SharedQuote['status'], issuedAt: item.issuedAt as string,
    snapshotHash: item.snapshotHash as string, validUntil: optionalString(item.validUntil),...quoteFileMetadata(item),
    customerResponse: optionalString(item.customerResponse), respondedAt: optionalString(item.respondedAt),
    lines:Array.isArray(item.lines)?parseSharedQuoteLines(item.lines):undefined,terms:optionalString(item.terms),
    customerSnapshot:quoteIdentitySnapshot(item.customerSnapshot,['name','organization','email','phone','country','address'] as const),sellerSnapshot:quoteIdentitySnapshot(item.sellerSnapshot,['name','address','email','phone'] as const),pricebookSnapshot:quotePricebookSnapshot(item.pricebookSnapshot),calculationPolicyVersion:optionalString(item.calculationPolicyVersion),
    recordId:optionalString(item.recordId),requestId:optionalString(item.requestId),locale:['fa','en','tr','ar','ru'].includes(string(item.locale))?item.locale as SharedQuote['locale']:undefined,
  }));
}

export function parseFrontRequests(value: unknown, catalog: Product[] = products): FrontRequest[] {
  if (!Array.isArray(value)) return [];
  return value.filter(object).filter(item =>
    ['id', 'kind', 'name', 'email', 'createdAt'].every(key => typeof item[key] === 'string'),
  ).map(item => ({
    ...item,
    id: item.id as string, kind: item.kind as string, name: item.name as string,
    email: item.email as string, createdAt: item.createdAt as string,
    organization: string(item.organization), message: string(item.message),
    status: string(item.status, 'received') || 'received',
    productIds: Array.isArray(item.productIds) ? item.productIds.filter((id): id is string => typeof id === 'string') : [],
    messages: parseRequestMessages(item.messages), sharedQuotes: parseSharedQuotes(item.sharedQuotes),
    quoteEnvelopes:parseQuoteEnvelopes(item.quoteEnvelopes).filter(envelope=>envelope.requestId===item.id),booking:parseEventBooking(item.booking),
    items: parseInquiryLines(item.items,catalog),
    ownerId: optionalString(item.ownerId), phone: optionalString(item.phone), country: optionalString(item.country),
    batch: optionalString(item.batch), idempotencyKey: optionalString(item.idempotencyKey),
    formId: optionalString(item.formId), formVersion: typeof item.formVersion === 'number' && Number.isInteger(item.formVersion) && item.formVersion > 0 ? item.formVersion : undefined,
    formValues: object(item.formValues) ? Object.fromEntries(Object.entries(item.formValues).filter(([key,value]) => !['__proto__','constructor','prototype'].includes(key) && typeof value === 'string').slice(0,50)) as Record<string,string> : undefined,
    consent: object(item.consent) && item.consent.purpose === 'request_processing' && typeof item.consent.acceptedAt === 'string' ? {purpose:'request_processing' as const,acceptedAt:item.consent.acceptedAt} : undefined,
    locale: ['fa', 'en', 'tr', 'ar', 'ru'].includes(string(item.locale)) ? item.locale as FrontRequest['locale'] : undefined,
    attachmentIds: Array.isArray(item.attachmentIds) ? item.attachmentIds.filter((id): id is string => typeof id === 'string') : [],
    version: typeof item.version === 'number' && Number.isInteger(item.version) && item.version > 0 ? item.version : 1,
  }));
}

import type {QuoteCustomerSnapshot,QuoteSellerSnapshot,QuotePricebookSnapshot,QuoteEnvelope} from '@/types/commercial';
import type { Locale } from '@/lib/i18n';
export interface InquiryLine {productId:string;quantity:number;shade?:string;mould?:string;note?:string;variantId?:string;sku?:string;unit?:string}
export interface RequestMessage {id:string;body:string;visibility:'public'|'internal';createdAt:string;sender:string}
export interface SharedQuoteLine { id:string; productId:string; titleSnapshot:string; unit:string; quantityDecimal:string; unitPriceDecimal:string|null; discountPercentDecimal:string; currency:string; netDecimal?:string|null }
export interface SharedQuote {
 id:string;number:string;title:string;amount:string;currency:string;status:'issued'|'accepted_interest'|'declined'|'revision_requested';
 issuedAt:string;validUntil?:string;snapshotHash:string;customerResponse?:string;respondedAt?:string;
 customerSnapshot?:QuoteCustomerSnapshot;sellerSnapshot?:QuoteSellerSnapshot;pricebookSnapshot?:QuotePricebookSnapshot;calculationPolicyVersion?:string;
 fileSha256?:string;fileByteCount?:number;fileCreatedAt?:string;fileOrigin?:'issued'|'legacy-rendered';
 lines?:SharedQuoteLine[];terms?:string;recordId?:string;requestId?:string;locale?:Locale;
}
export interface EventBooking {id:string;sessionId:string;requestId:string;status:'confirmed'|'waitlisted'|'cancelled'|'attended'|'no_show';seats:number;version:number;kind:'event'|'factory_visit';title:string;startsAt:string;endsAt:string;timezone:string;location:string}
export interface FrontRequest {
 id:string;kind:string;name:string;email:string;organization:string;message:string;productIds:string[];status:string;createdAt:string;
 ownerId?:string;access?:'owner'|'shared_view'|'shared_reply'|'staff';phone?:string;country?:string;locale?:Locale;items?:InquiryLine[];batch?:string;
 attachmentIds?:string[];messages?:RequestMessage[];sharedQuotes?:SharedQuote[];quoteEnvelopes?:QuoteEnvelope[];version?:number;idempotencyKey?:string;
 formId?:string;formVersion?:number;formValues?:Record<string,string>;consent?:{purpose:'request_processing';acceptedAt:string};
 jobRecordId?:string;eventSessionId?:string;seats?:number;booking?:EventBooking;
}
export interface FrontPublication {id:string;slug:string;kind:string;locale:Locale;title:string;summary:string;body:string;blocks:{id:string;type:string;title:string;body:string;mediaUrl?:string;link?:string}[];publishedAt:string;version:number}

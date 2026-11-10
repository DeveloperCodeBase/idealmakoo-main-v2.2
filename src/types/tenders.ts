/** Public DTOs derive from the authoritative service; these imports are erased. */
import type {getPublicTender,getManagedTender,getTenderBid,listOwnTenderBids,getTenderReviewers,TenderDefinition,TenderBidSubmission} from '@/server/tenders';
export type {TenderDefinition,TenderBidSubmission};
export type PublicTender=Awaited<ReturnType<typeof getPublicTender>>;
export type ManagedTender=Awaited<ReturnType<typeof getManagedTender>>;
export type TenderBidView=Awaited<ReturnType<typeof getTenderBid>>;
export type TenderBidSummary=Awaited<ReturnType<typeof listOwnTenderBids>>['items'][number];
export type TenderReviewerDirectory=Awaited<ReturnType<typeof getTenderReviewers>>;
export type TenderEnvelopeKind='technical'|'financial';
export interface TenderPrivateAsset {id:string;name:string;filename?:string;mimeType:string;bytes:number;scanStatus:'pending'|'clean'|'blocked'|'error';visibility:'private'|'public'}

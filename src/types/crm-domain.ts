import type {z} from 'zod';
import type {accountDefinitionSchema,addressSchema,contactDefinitionSchema,domainDefinitionSchema,qualificationSchema,opportunityDefinitionSchema,sampleDefinitionSchema,handoffDefinitionSchema,agreementDefinitionSchema,conversionSchema,sampleTransitionSchema,handoffTransitionSchema} from '@/server/workspace-domain-schema';
import type {ContentLocale} from '@/data/catalog';
import type {WorkspaceState} from '@/data/workspace-seed';
export type CrmAddress=z.infer<typeof addressSchema>;
export type CrmAccountDefinition=z.infer<typeof accountDefinitionSchema>;
export type CrmContactDefinition=z.infer<typeof contactDefinitionSchema>;
export type CrmLeadDefinition=z.infer<typeof qualificationSchema>;
export type CrmOpportunityDefinition=z.infer<typeof opportunityDefinitionSchema>;
export type CrmSampleDefinition=z.infer<typeof sampleDefinitionSchema>;
export type CrmHandoffDefinition=z.infer<typeof handoffDefinitionSchema>;
export type CrmPartnerDefinition=z.infer<typeof agreementDefinitionSchema>;
export type CrmDomainDefinition=z.infer<typeof domainDefinitionSchema>;
export type CrmLeadConversionInput=z.infer<typeof conversionSchema>;
export type CrmSampleTransitionInput=z.infer<typeof sampleTransitionSchema>;
export type CrmHandoffTransitionInput=z.infer<typeof handoffTransitionSchema>;
export interface CrmDomainMutation {expectedVersion:number;value:CrmDomainDefinition}
export interface CrmWorkspaceResult {state:WorkspaceState;version:number}
export interface CrmContactEndpoint {id:string;recipientId:string;channel:'email'|'phone';value:string;label:string;active:boolean;version:number;verifiedAt:string|null}
export interface CrmProductSnapshot {schemaVersion:1;productId:string;locale:ContentLocale;title:string;slug:string;family:string;source:'reviewed-release'|'factory-source';releaseRevisionId:string|null;sourceHash:string;variant:{id:string;sku?:string;shade?:string;mould?:string;arch?:string;position?:string;unitsPerPack?:string}|null;unit:string;unitSource:'reviewed-variant'|'requested'}
export interface CrmOpportunityItemSnapshot {id:string;productId:string;variantId:string|null;unit:string;quantityDecimal:string;note:string;productSnapshot:CrmProductSnapshot}
export type CrmSampleState='requested'|'reviewed'|'shipped'|'received'|'evaluated';
export type CrmHandoffState='draft'|'ready'|'submitted'|'acknowledged'|'failed'|'uncertain';
export interface CrmSampleCase {status:CrmSampleState;carrierEvidence:{carrier:string;trackingReference:string;shippedAt:string;evidenceAssetId:string}|null;receivedAt:string|null;evaluation:{outcome:'satisfactory'|'unsatisfactory'|'quality_concern';feedback:string;evaluatedAt:string;batch?:string|null}|null;qualityRequestId:string|null}
export interface CrmHandoffCase {status:CrmHandoffState;externalStatus:string|null;externalReference:string|null;lastEvidenceAssetId:string|null;attempt:number;lastNote:string}
export interface CrmDomainView {recordId:string;collection:string;version:number;definition:CrmDomainDefinition|null;endpoints:CrmContactEndpoint[];items:CrmOpportunityItemSnapshot[];sample:CrmSampleCase|null;handoff:CrmHandoffCase|null;conversion:{accountId:string;contactId:string;opportunityId:string|null;reason:string|null;convertedAt:string}|null;capabilities:{canEdit:boolean;canConvert:boolean;canVerifyEndpoints:boolean;contactVisible:boolean;financialVisible:boolean;sampleTransitions:CrmSampleState[];handoffTransitions:CrmHandoffState[]}}

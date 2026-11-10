export interface PrivacySubjectDto {type:'user'|'crm-contact';id:string}
export interface PrivacyBlockerDto {code:string;description:string;count:number}
export interface PrivacyRequestDto {
 id:string;subject:PrivacySubjectDto;action:'export'|'erase';status:'requested'|'approved'|'blocked'|'rejected'|'completed';reason:string;version:number;
 requestedBy:string;approvedBy:string|null;decisionReason:string|null;createdAt:string;updatedAt:string;completedAt:string|null;
 blockers:PrivacyBlockerDto[];result:Record<string,unknown>|null;capabilities:{approve:boolean;execute:boolean;export:boolean};
}
export interface PrivacyRequestList {items:PrivacyRequestDto[];capabilities:{manageHolds:boolean;selectSubject:boolean;ledgerConfigured:boolean}}
export interface PrivacyHoldDto {id:string;subject:PrivacySubjectDto;reason:string;expiresAt:string;revokedAt:string|null;releaseReason:string|null;version:number;active:boolean;createdAt:string}

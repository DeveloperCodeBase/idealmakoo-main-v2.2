import type {SupportedLocale as Locale} from './domain';
export interface CertificateDefinition {
  title:string; summary:string; issuer:string; certificateNumber:string;
  standard:string; validFrom:string; validUntil:string; issuerUrl:string;
  resourceId:string|null; resourceVersionId:string|null;
}
export interface CertificateSource {
  resourceId:string; versionId:string; locale:Locale; label:string;
  sha256:string; href:string;
}
export interface CertificateSourceCandidate extends CertificateSource {title:string}
export type CertificateStatus='current'|'expiring'|'expired'|'not-yet-valid'|'revoked'|'source-unavailable';
export interface PublicCompanyCertificate {
  id:string; slug:string; locale:Locale; revisionId:string;
  title:string; summary:string; issuer:string; certificateNumber:string;
  standard:string; validFrom:string; validUntil:string; issuerUrl:string;
  status:CertificateStatus; source:CertificateSource|null; publishedAt:string;
}
export interface CertificateRevision {
  id:string; number:number; locale:Locale; definition:CertificateDefinition;
  createdAt:string;
  review:{decision:'approved'|'rejected';reviewerName:string;reviewedAt:string}|null;
}
export interface CertificateCapabilities {
  edit:boolean; review:boolean; publish:boolean; revoke:boolean; archive:boolean;
}
export interface ManagedCompanyCertificate {
  id:string; slug:string; version:number; locale:Locale;
  draft:CertificateDefinition|null; draftRevisionId:string|null;
  revisions:CertificateRevision[]; published:PublicCompanyCertificate|null;
  revokedAt:string|null; archived:boolean; capabilities:CertificateCapabilities;
}

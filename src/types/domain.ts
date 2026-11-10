// src/types/domain.ts

export type SupportedLocale = 'fa' | 'en' | 'tr' | 'ar' | 'ru';
export type TextDirection = 'rtl' | 'ltr';

export const LOCALE_CONFIG: Record<SupportedLocale, {
  code: SupportedLocale;
  nativeName: string;
  direction: TextDirection;
  intlLocale: string;
  calendar: 'persian' | 'gregory';
}> = {
  fa: { code: 'fa', nativeName: 'فارسی', direction: 'rtl', intlLocale: 'fa-IR', calendar: 'persian' },
  en: { code: 'en', nativeName: 'English', direction: 'ltr', intlLocale: 'en-US', calendar: 'gregory' },
  tr: { code: 'tr', nativeName: 'Türkçe', direction: 'ltr', intlLocale: 'tr-TR', calendar: 'gregory' },
  ar: { code: 'ar', nativeName: 'العربية', direction: 'rtl', intlLocale: 'ar-SA', calendar: 'gregory' },
  ru: { code: 'ru', nativeName: 'Русский', direction: 'ltr', intlLocale: 'ru-RU', calendar: 'gregory' },
};

export type RoleKey =
  | 'customer'
  | 'superAdmin'
  | 'admin'
  | 'contentEditor'
  | 'productManager'
  | 'scientificReviewer'
  | 'translator'
  | 'publisher'
  | 'hr'
  | 'business'
  | 'analyst'
  | 'support';

export type DocumentKind =
  | 'product'
  | 'category'
  | 'page'
  | 'news'
  | 'article'
  | 'event'
  | 'job'
  | 'resource'
  | 'opportunity'
  | 'faq';

export type ProductFamilyType = 'artificial_teeth' | 'dental_materials';

export interface ContentRevision<TSnapshot = Record<string, unknown>> {
  id: string;
  documentId: string;
  locale: SupportedLocale;
  revisionNumber: number;
  baseRevisionId: string | null;
  snapshotSchemaVersion: number;
  snapshot: TSnapshot;
  checksum: string;
  status: 'draft' | 'ready_for_review' | 'needs_changes' | 'approved' | 'archived';
  scientificApprovalStatus: 'not_required' | 'pending' | 'approved' | 'rejected';
  createdBy: string;
  reviewedBy?: string;
  createdAt: string;
}

export interface LocaleRelease {
  id: string;
  documentId: string;
  locale: SupportedLocale;
  activeRevisionId: string | null;
  releaseNumber: number;
  publishedAt: string | null;
  publishedBy: string | null;
  lockVersion: number;
}

export interface ArtificialTeethSpecs {
  family: 'artificial_teeth';
  material: 'PMMA_Multilayer' | 'Nano_Composite' | 'Nano_Base_Acrylic';
  rawLegacyMaterialNote?: string; // e.g., 'PAMMA' preserved from legacy source for scientific review
  toothPosition: Array<'anterior' | 'posterior'>;
  arch: Array<'upper' | 'lower'>;
  layerCount: number | null;
  mouldCodes: string[];
  shadeSystem: string;
  availableShades: string[];
  hardnessVickers?: string | null;
  bondingStandard?: string | null;
}

export interface DentalMaterialSpecs {
  family: 'dental_materials';
  materialCategory: 'acid_etch' | 'bonding_resin' | 'light_cure_composite' | 'laboratory_putty';
  concentrationOrGeneration?: string; // e.g., '37% Phosphoric Acid' or '8th Generation Universal'
  curingMethod: 'light_cure' | 'self_cure' | 'dual_cure' | 'non_curing_gel';
  deliveryForm: 'syringe' | 'bottle' | 'jar_putty' | 'kit';
  netQuantity: string;
  unit: 'g' | 'ml' | 'kit' | 'pack';
  curingTimeSeconds?: number | null;
  etchingTimeSeconds?: number | null;
  storageTemperatureCelsius: string;
}

export interface ProductEntity {
  id: string;
  documentId: string;
  legacyId: number | null;
  productCode: string;
  slug: string;
  brand: string;
  family: ProductFamilyType;
  lifecycleStatus: 'active' | 'paused' | 'discontinued';
  localized: Record<SupportedLocale, {
    title: string;
    subtitle: string;
    shortDescription: string;
    fullDescription: string;
    indications: string[];
    benefits: string[];
    packagingInfo: string;
    seoTitle: string;
    seoDescription: string;
    isPublished: boolean;
    revisionNumber: number;
  }>;
  specs: ArtificialTeethSpecs | DentalMaterialSpecs;
  variants: Array<{
    variantId: string;
    sku: string;
    shadeCode?: string;
    mouldCode?: string;
    arch?: 'upper' | 'lower';
    position?: 'anterior' | 'posterior';
    packUnit: string;
    supplyStatus: 'inquiry_available' | 'paused' | 'discontinued';
  }>;
  resourceIds: string[];
  relatedProductIds: string[];
}

// پاکت مشترک درخواست‌ها، استعلام‌ها و تیکتینگ (OWN-012 & ADM-046)
export type RequestKind =
  | 'rfq'
  | 'sample_request'
  | 'distribution_partnership'
  | 'supplier_registration'
  | 'outsourcing_bid'
  | 'investment_interest'
  | 'research_proposal'
  | 'job_application'
  | 'support_ticket'
  | 'quality_complaint'
  | 'factory_visit';

export type PublicRequestStatus =
  | 'received'
  | 'in_review'
  | 'waiting_customer'
  | 'responded'
  | 'resolved'
  | 'closed'
  | 'withdrawn';

export interface UnifiedRequestRecord {
  requestId: string; // شناسه سراسری request-index
  referenceNumber: string; // مثلاً IM-REQ-2026-1042
  kind: RequestKind;
  locale: SupportedLocale;
  ownerUserId: string | null;
  accountId: string | null; // اتصال به crm-accounts در صورت اشتراک سازمانی
  sharedMemberIds: string[];
  contactSnapshot: {
    name: string;
    email?: string;
    phone?: string;
    organizationName?: string;
    country: string;
    city?: string;
  };
  subject: string;
  publicStatus: PublicRequestStatus;
  internalStage: string;
  priority: 'low' | 'normal' | 'high' | 'critical_safety';
  assignedTeam: 'sales' | 'support' | 'quality' | 'hr' | 'investment' | 'procurement' | 'r_and_d';
  assigneeId: string | null;
  qualityScopeQuarantined: boolean; // در صورت true، فقط نقش کیفیت و مدیر ارشد دسترسی دارند
  sla: {
    policyId: string;
    firstResponseDueAt: string;
    firstRespondedAt: string | null;
    resolutionDueAt: string;
    resolvedAt: string | null;
    isPaused: boolean;
    pauseReason?: string;
    breached: boolean;
  };
  itemsSnapshot: Array<{
    productId: string;
    productTitle: string;
    variantSku?: string;
    shadeCode?: string;
    mouldCode?: string;
    quantity: string;
    unit: string;
    viewedRevisionNumber: number;
    batchOrLotCode?: string;
  }>;
  lockVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface RequestMessageRecord {
  id: string;
  requestId: string;
  senderUserId: string;
  senderName: string;
  senderRole: RoleKey;
  visibility: 'public' | 'internal'; // یادداشت internal هرگز به مشتری نمایش داده یا ایمیل نمی‌شود
  body: string;
  attachmentIds: string[];
  createdAt: string;
}

// پیش‌فاکتور رسمی و نسخه‌دار CRM (CRM-012 تا CRM-014)
export type SupportedCurrency = 'IRR' | 'USD' | 'EUR' | 'TRY' | 'RUB';

export interface CrmQuoteRevision {
  id: string;
  quoteId: string;
  quoteNumber: string;
  revisionNumber: number;
  opportunityId: string;
  accountId: string;
  locale: SupportedLocale;
  currency: SupportedCurrency;
  calculationPolicyVersion: number;
  status: 'draft' | 'pending_approval' | 'approved' | 'issued' | 'accepted_interest' | 'declined' | 'expired' | 'superseded';
  lines: Array<{
    lineId: string;
    productId: string;
    variantSku?: string;
    titleSnapshot: string;
    unit: string;
    quantityDecimal: string;
    unitPriceDecimal: string;
    discountPercentDecimal: string;
    netLineDecimal: string;
    taxPercentDecimal: string;
    totalLineDecimal: string;
  }>;
  subtotalDecimal: string;
  discountTotalDecimal: string;
  taxTotalDecimal: string;
  grandTotalDecimal: string;
  validUntilUtc: string;
  termsText: string;
  snapshotHash: string; // هش تمام مقادیر تجاری جهت قفل تاییدیه مدیر
  pdfFileSha256: string | null;
  preparedByUserId: string;
  approvedByUserId: string | null;
  issuedAtUtc: string | null;
  customerResponseAtUtc: string | null;
  customerResponseNote?: string;
}

// خطای استاندارد RFC 9457 Problem Details
export interface Rfc9457ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
  code: string;
  requestId: string;
  errors?: Array<{
    path: string;
    code: string;
    message: string;
  }>;
}

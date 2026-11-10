import type {FrontSession} from '@/lib/auth';
import type {Locale} from '@/lib/i18n';
import type {RoleKey} from '@/types/domain';
import type {CrmScope,CrmPermissions} from '@/types/crm';
import type {UserProfile} from '@/lib/user-settings';

export type ManagedUserProfile=Omit<UserProfile,'name'|'avatar'>;

export type UserDirectoryKind = 'all' | 'staff' | 'customer';
export type UserDirectoryActive = 'all' | 'true' | 'false';
/** GET /users query. Serialize limit as a decimal URL parameter. */
export interface UserDirectoryQuery {
  kind?: UserDirectoryKind;
  q?: string;
  role?: RoleKey;
  active?: UserDirectoryActive;
  limit?: number;
  cursor?: string;
}
export interface ManagedUser extends FrontSession {
  active: boolean;
  allowedLocales: Locale[];
  qualityScope: boolean;
  mfaEnabled: boolean;
  emailVerified: boolean;
  crmScope: CrmScope;
  crmPermissions: CrmPermissions;
  createdAt: string;
  updatedAt: string;
  capabilities?: {
    canEdit: boolean;
    canChangeEmail: boolean;
    canManageGrants: boolean;
    canResetPassword: boolean;
    canResetMfa?: boolean;
    canDeactivate: boolean;
    canReactivate: boolean;
  };
}
export interface UserDirectoryResponse {
  items: ManagedUser[];
  provisioningMode: 'env' | 'hybrid' | 'panel';
  canCreate: boolean;
  canManageGrants: boolean;
  nextCursor: string | null;
}
/** Detailed profile is fetched only after opening one authorized user. */
export interface ManagedUserDetail extends ManagedUser {
  profile: ManagedUserProfile;
  profileRevision: number;
}
export interface ManagedUserMutation extends ManagedUserDetail {
  requiresReauthentication?: boolean;
}
/** POST /users/:id/password. Editors send their captured account timestamp;
 * omitting it retains the existing explicit administrative reset contract. */
export interface ManagedUserPasswordResetInput {
  password: string;
  expectedUpdatedAt?: string;
}
export interface ManagedUserPasswordResetResult {
  ok: true;
  userId: string;
  sessionsRevoked: true;
  updatedAt: string;
}
/** POST /users/:id/mfa-reset. Both target versions and a fresh actor password
 * plus unused TOTP are mandatory. Recovery codes cannot authorize this action. */
export interface ManagedUserMfaResetInput {
  actorPassword: string;
  actorCode: string;
  password: string;
  expectedUpdatedAt: string;
  profileRevision: number;
}
export interface ManagedUserMfaResetResult {
  ok: true;
  userId: string;
  sessionsRevoked: true;
  mfaEnrollmentRequired: true;
  updatedAt: string;
  profileRevision: number;
}

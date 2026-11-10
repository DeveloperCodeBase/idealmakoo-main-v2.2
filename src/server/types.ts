import type { RoleKey } from '../types/domain';
import type { CrmAccess } from '../types/crm';

// A symbol keeps request provenance out of JSON DTOs while preserving it when
// server helpers spread an actor. It contains only the database session ID,
// never the bearer cookie. Independent worker/subject actors omit this marker.
export const actorSession = Symbol('actorSession');

/** Authority is constructed by the server, never accepted from a request body. */
export interface Actor {
  id: string; name: string; email: string; role: RoleKey;
  qualityScope: boolean; allowedLocales: string[]; mfaVerified: boolean;
  crmAccess?: CrmAccess;
  readonly [actorSession]?: Readonly<{id:string;userId:string}>;
}
export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message); this.name = 'HttpError';
  }
}
export function assert(condition: unknown, status: number, code: string, message: string): asserts condition {
  if (!condition) throw new HttpError(status, code, message);
}
export function object(value: unknown): Record<string, unknown> {
  assert(value !== null && typeof value === 'object' && !Array.isArray(value), 422, 'VALIDATION', 'A JSON object is required.');
  return value as Record<string, unknown>;
}
export const locales = ['fa', 'en', 'tr', 'ar', 'ru'] as const;


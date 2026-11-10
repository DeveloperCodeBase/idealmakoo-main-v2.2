import {demoMode} from "@/lib/api";
import { readStore, writeStore } from "@/lib/storage";
import { roles } from "@/lib/auth";
import type { RoleKey } from "@/types/domain";

export interface LocalAccount {
  id: string;
  name: string;
  email: string;
  role: "customer";
  salt: string;
  passwordDigest: string;
  createdAt: string;
}

export interface PendingSignIn {
  id: string;
  role: RoleKey;
  name: string;
  email: string;
  route: string;
  expiresAt: number;
}

export interface SecurityPreferences {
  mfaEnabled: boolean;
  recoveryCodes: string[];
}

const ACCOUNTS_KEY = "idealmakoo.local-accounts.v1";
export const PENDING_KEY = "idealmakoo.auth.pending.v1";
export const securityKey = (id: string) => `idealmakoo.account.${id}.security.v1`;
export const readLocalAccounts = () => demoMode?readStore<LocalAccount[]>(ACCOUNTS_KEY, []):[];
export const saveLocalAccounts = (accounts: LocalAccount[]) => demoMode&&writeStore(ACCOUNTS_KEY, accounts);
export const isValidPassword = (password: string) => password.length >= (demoMode?8:12) && /\p{L}/u.test(password) && /\d/.test(password);

/** Accept the digits shown by Persian/Arabic keyboards while preserving recovery codes. */
export const normalizeVerificationCode = (value: string): string => value
  .replace(/[۰-۹]/g, digit => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
  .replace(/[٠-٩]/g, digit => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
  .replace(/\s/g, "");

/** Browser-only demonstration. Production authentication belongs on the server. */
export async function digestPassword(password: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(salt), iterations: 120000 }, key, 256);
  return Array.from(new Uint8Array(bits), byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function buildLocalAccount(name: string, email: string, password: string): Promise<LocalAccount> {
  const normalized = email.trim().toLowerCase();
  const salt = crypto.randomUUID();
  return { id: `local-${normalized}`, name: name.trim(), email: normalized, role: "customer", salt, passwordDigest: await digestPassword(password, salt), createdAt: new Date().toISOString() };
}

export function readPendingSignIn(): PendingSignIn | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(PENDING_KEY) || "null") as PendingSignIn | null;
    if (!value || !Number.isFinite(value.expiresAt) || value.expiresAt <= Date.now()) return null;
    if (![value.id, value.name, value.email, value.route].every(field => typeof field === "string" && field.trim())) return null;
    return roles.includes(value.role) ? value : null;
  } catch { return null; }
}

export function savePendingSignIn(value: Omit<PendingSignIn, "expiresAt">) {
  sessionStorage.setItem(PENDING_KEY, JSON.stringify({ ...value, expiresAt: Date.now() + 10 * 60 * 1000 }));
}

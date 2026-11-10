import { resolve } from 'node:path';
import {staffProvisioningMode} from './staff-provisioning-mode';

export function config() {
  staffProvisioningMode();
  const production = process.env.NODE_ENV === 'production';
  const siteUrl = new URL(process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000');
  if (!['http:', 'https:'].includes(siteUrl.protocol) || siteUrl.username || siteUrl.password || siteUrl.pathname !== '/') throw new Error('SITE_URL must be an HTTP(S) origin without a path or credentials');
  const sessionSecret = process.env.SESSION_SECRET || '';
  const encryptionKey = process.env.MFA_ENCRYPTION_KEY || '';
  if (sessionSecret.length < 32) throw new Error('SESSION_SECRET must contain at least 32 random characters');
  if (!/^[a-f0-9]{64}$/i.test(encryptionKey)) throw new Error('MFA_ENCRYPTION_KEY must be 64 hexadecimal characters');
  if (production && (process.env.DEMO_MODE === 'true' || process.env.NEXT_PUBLIC_DEMO_MODE === 'true')) throw new Error('Demo accounts and local authentication are forbidden in production');
  if (production && process.env.NEXT_PUBLIC_DATA_MODE === 'local') throw new Error('Production requires the server data adapter');
  return {
    production, siteUrl: siteUrl.origin, secureCookies: siteUrl.protocol === 'https:',
    sessionSecret, encryptionKey: Buffer.from(encryptionKey, 'hex'),
    storageDir: resolve(process.env.STORAGE_DIR || './storage'),
    idleMinutes: Math.max(5, Math.min(1440, Number(process.env.SESSION_IDLE_MINUTES) || 60)),
    sessionHours: Math.max(1, Math.min(720, Number(process.env.SESSION_HOURS) || 24)),
    trustProxy: process.env.TRUST_PROXY === 'true',
  };
}


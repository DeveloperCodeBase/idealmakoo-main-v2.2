'use client';

import { useState, type CSSProperties } from 'react';
import styles from './user-avatar.module.css';

export function UserAvatar({ name, src, size = 42, className = '', decorative = false }: {
  name: string; src?: string | null; size?: number; className?: string; decorative?: boolean;
}) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const safeSize = Math.max(20, Math.min(240, size));
  const initials = name.trim().split(/\s+/u).filter(Boolean).slice(0, 2).map(part => Array.from(part)[0]).join('').toLocaleUpperCase() || 'IM';
  return <span className={`${styles.avatar} ${className}`} style={{ '--avatar-size': `${safeSize}px` } as CSSProperties} aria-hidden={decorative || undefined}>
    {src && src !== failedSource ? <img src={src} alt={decorative ? '' : name} width={safeSize} height={safeSize} onError={() => setFailedSource(src)} decoding="async" /> : <span role={decorative ? undefined : 'img'} aria-label={decorative ? undefined : name}>{initials}</span>}
  </span>;
}

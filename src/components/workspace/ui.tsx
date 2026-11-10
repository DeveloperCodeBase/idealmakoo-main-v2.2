'use client';

import type { ReactNode, RefObject } from 'react';
import { Modal as SharedModal } from '@/components/ui/Primitives';
import './workspace-modal.css';
import { Search, Inbox, ChevronLeft, ChevronRight } from 'lucide-react';
import { wt } from './i18n';
import {currentDisplayTimeZone} from '@/lib/display-preferences';

export function Modal({ title, children, onClose, wide = false, restoreFocusTarget }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean; restoreFocusTarget?: RefObject<HTMLElement | null> }) {
  // Workspace editors retain their role typography and content classes while
  // using the same viewport, focus, header and optical surface as public dialogs.
  return <SharedModal title={title} onClose={onClose} restoreFocusTarget={restoreFocusTarget}
    className={`ws-viewport-modal ${wide ? 'ws-viewport-modal-wide' : ''}`}
    headerClassName="ws-modal-heading" bodyClassName="ws-modal-body ws-root ws-liquid-workspace" closeButtonClassName="ws-icon-button">
    {children}
  </SharedModal>;
}
export function Status({ status, locale }: { status: string; locale: string }) { return <span className={`ws-status ws-status-${status}`}><i/>{wt(status, locale)}</span>; }
export function SearchInput({ value, onChange, locale }: { value: string; onChange: (value: string) => void; locale: string }) { return <label className="ws-search"><Search size={17}/><input aria-label={wt('search', locale)} type="search" placeholder={wt('search', locale)} value={value} onChange={e => onChange(e.target.value)}/></label>; }
export function Empty({ locale, action }: { locale: string; action?: ReactNode }) { return <div className="ws-empty"><Inbox size={42}/><h2>{wt('empty', locale)}</h2><p>{wt('emptyHint', locale)}</p>{action}</div>; }
export function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="ws-field"><span>{label}</span>{children}</label>; }
export function Pager({ page, total, size, onChange, locale }: { page: number; total: number; size: number; onChange: (page: number) => void; locale: string }) {
  const pages = Math.max(1, Math.ceil(total / size));
  return <div className="ws-pagination"><span><bdi>{Math.min(page * size + 1, total)}–{Math.min((page + 1) * size, total)} / {total}</bdi> {wt('records', locale)}</span><div><button className="ws-icon-button" disabled={!page} onClick={() => onChange(page - 1)} aria-label={wt('previous', locale)}><ChevronLeft size={17}/></button><span><bdi>{page + 1} / {pages}</bdi></span><button className="ws-icon-button" disabled={page + 1 >= pages} onClick={() => onChange(page + 1)} aria-label={wt('next', locale)}><ChevronRight size={17}/></button></div></div>;
}
export function safeDate(value: string, locale: string, options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }) { try { return new Intl.DateTimeFormat(locale === 'fa' ? 'fa-IR' : locale === 'ar' ? 'ar-EG' : locale, { timeZone: currentDisplayTimeZone() || 'Asia/Tehran', ...options }).format(new Date(value)); } catch { return value; } }

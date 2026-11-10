'use client';
import Link from "next/link";
import { useMemo } from "react";
import { ArrowRight, Bookmark, ChevronRight, FileText, MessageSquare, UserRound } from "lucide-react";
import { useApp } from "@/components/providers/AppProvider";
import { type Product } from "@/data/catalog";
import { localizedPath, productPath } from "@/lib/custom-products";
import { getPublishedProductInventory, type PublishedProduct } from "@/lib/publications";
import { formatDate, localeNames, locales, localized, type Locale } from "@/lib/i18n";
import type { FrontRequest } from "@/types/frontend";
import { accountText } from "./account-copy";
import styles from "./account.module.css";


const sourceTitleLabel = localized('زبان منبع', 'Source language', 'Kaynak dili', 'لغة المصدر', 'Язык оригинала');

export function useExistingProductDisplay(catalog: Product[]) {
  return useMemo(() => { const merged = new Map(catalog.map(product => [product.id, product])); for (const product of getPublishedProductInventory()) if (!merged.has(product.id)) merged.set(product.id, product); return [...merged.values()]; }, [catalog]);
}

export function existingProductTitle(product: Product | undefined, locale: Locale, fallback = '—') {
  if (!product) return { title: fallback, language: locale };
  const published = product as PublishedProduct, source = published.sourceName || published.sourceProduct?.name;
  for (const language of [locale, ...(published.localPublication?.locale ? [published.localPublication.locale] : []), 'fa', ...locales] as Locale[]) { const title = product.name[language]?.trim() || source?.[language]?.trim(); if (title) return { title, language }; }
  return { title: product.brand || fallback, language: locale };
}

export function existingProductHref(product: Product, locale: Locale) { return localizedPath(locale, productPath(product)); }

export function ExistingProductName({ product, locale, fallback }: { product: Product | undefined; locale: Locale; fallback?: string }) {
  const name = existingProductTitle(product, locale, fallback);
  return <><bdi lang={name.language}>{name.title}</bdi>{name.language !== locale && <small className={styles.statusBadge} data-tone="muted" style={{ fontSize: 10, marginInlineStart: 6 }}>{sourceTitleLabel[locale]}: <bdi>{localeNames[name.language]}</bdi></small>}</>;
}

export function useAccountText() {
  const { locale, t } = useApp();
  return (key: string) => accountText(locale, key, t);
}

export function EmptyState({ title, body, href, action, icon = "requests", onAction, headingLevel = 3 }: { headingLevel?: 2 | 3; title: string; body?: string; href?: string; action?: string; icon?: string; onAction?: () => void }) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return <div className={styles.emptyState}><span className={styles.emptyIcon}>{icon === "profile" ? <UserRound size={30} /> : icon === "saved" ? <Bookmark size={30} /> : <MessageSquare size={30} />}</span><Heading>{title}</Heading>{body && <p>{body}</p>}{href && <Link className={styles.primaryButton} href={href} onClick={onAction}>{action}<ArrowRight className={styles.directionArrow} size={16} /></Link>}</div>;
}

export function Status({ value }: { value: string }) {
  const text = useAccountText();
  const key = ({ new: "received", review: "in_review", pending: "in_review", "in-progress": "in_review", complete: "resolved" } as Record<string, string>)[value] || value;
  return <span className={styles.statusBadge} data-tone={["resolved", "closed", "complete"].includes(key) ? "success" : key === "withdrawn" ? "muted" : key === "waiting_customer" ? "warning" : "info"}><i />{text(key)}</span>;
}

export function requestKind(kind: string) {
  return ({ rfq: "inquiry", sample: "sample", sample_request: "sample", support_ticket: "support", support: "support", quality_complaint: "quality", job_application: "careers", careers: "careers", factory_visit: "visit", distribution_partnership: "distributors", cooperation: "cooperation", data_deletion: "privacy", research_proposal: "research" } as Record<string, string>)[kind] || "requests";
}

export function RequestList({ requests, onSelect }: { requests: FrontRequest[]; onSelect?: (id: string) => void }) {
  const { locale, href } = useApp(); const text = useAccountText();
  return <div className={styles.requestList}>{requests.map(request => <Link className={styles.requestRow} href={`${href("account/requests")}?id=${encodeURIComponent(request.id)}`} key={request.id} onClick={() => onSelect?.(request.id)}><span className={styles.requestIcon}><FileText size={20} /></span><span className={styles.requestTitle}><strong>{text(requestKind(request.kind))}</strong><small><bdi>{request.id}</bdi><span>·</span>{formatDate(request.createdAt, locale)}</small></span><Status value={request.status} /><ChevronRight className={styles.directionArrow} size={17} /></Link>)}</div>;
}

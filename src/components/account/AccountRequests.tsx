'use client';
import Link from "next/link";
import { demoMode } from "@/lib/api";
import BookingReceipt from "@/components/events/BookingReceipt";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ArrowRight, Check, Download, FileText, MessageSquare, Plus, Search, Send } from "lucide-react";
import { useApp } from "@/components/providers/AppProvider";
import { formatDate, localized } from "@/lib/i18n";
import { downloadJson, makeId } from "@/lib/storage";
import type { FrontRequest } from "@/types/frontend";
import { canRespondToQuote, canViewRequest, createQuoteResponse, publicRequestSnapshot, type QuoteResponseStatus, type SharedQuote } from "./portal-data";
import QuoteLines from '@/components/ui/QuoteLines';
import { Modal } from '@/components/ui/Primitives';
import styles from "./account.module.css";
import {useExistingProductDisplay, existingProductHref, ExistingProductName, useAccountText, EmptyState, Status, RequestList, requestKind} from './portal-ui';
import {useSearchParams} from 'next/navigation';
import {AccountBodyLoading, AccountRequestError} from './AccountBodyState';

export function RequestsPanel({ requests, section }: { requests: FrontRequest[]; section: string }) {
  const { catalog: products, locale, session, href, updateRequest, notify, requestsReady, requestsError, reloadRequests } = useApp(); const text = useAccountText();
  const displayProducts = useExistingProductDisplay(products);
  const searchParams = useSearchParams();
  const routeKey = JSON.stringify([section, searchParams.toString()]);
  const routeSelection = searchParams.get("id") || section.split("/")[1] || "";
  const [selection, setSelection] = useState<{route:string;id:string}|null>(null);
  const selectedId = selection?.route === routeKey ? selection.id : routeSelection;
  const setSelectedId = (id:string) => setSelection({route:routeKey,id});
  const [search, setSearch] = useState(""); const [status, setStatus] = useState("all"); const [reply, setReply] = useState("");
  const [withdrawId, setWithdrawId] = useState<string | null>(null);
  useEffect(() => { setWithdrawId(null); }, [selectedId, locale, session?.id]);
  const selected = requests.find(request => request.id === selectedId);
  const owns=(request:FrontRequest)=>demoMode?canViewRequest(request,session):request.ownerId===(session?.id||"guest");
  const accessOf=(request:FrontRequest)=>(request as FrontRequest&{access?:string}).access;
  const withdrawTarget = requests.find(request => request.id === withdrawId && request.id === selectedId && owns(request) && !["closed", "withdrawn", "resolved"].includes(request.status));
  useEffect(() => { if (withdrawId && !withdrawTarget) setWithdrawId(null); }, [withdrawId, withdrawTarget]);
  const confirmWithdrawal = async () => { if (withdrawTarget && await updateRequest(withdrawTarget.id, { status: "withdrawn" })) setWithdrawId(null); };
  const filtered = requests.filter(request => (status === "all" || request.status === status) && `${request.id} ${request.organization} ${request.message}`.toLowerCase().includes(search.toLowerCase()));
  const addReply = async (event: FormEvent) => { event.preventDefault(); if (!selected || !reply.trim() || (!demoMode&&!owns(selected)&&accessOf(selected)!=="shared_reply")) return; if (await updateRequest(selected.id, { messages: [...(selected.messages || []), { id: makeId("MSG"), body: reply.trim(), visibility: "public", createdAt: new Date().toISOString(), sender: session?.name || selected.name }], ...(owns(selected)?{status: selected.status === "waiting_customer" ? "in_review" : selected.status}:{}) })) { setReply(""); notify(text("localReply")); } };
  if (requestsError) return <AccountRequestError error={requestsError} onRetry={reloadRequests}/>;
  if (!requestsReady) return <AccountBodyLoading/>;
  if (selectedId && !selected) return <EmptyState headingLevel={2} title={text("noTracking")} href={href("account/requests")} action={text("back")} onAction={() => setSelectedId("")} />;
  return <>{selected ? <><div className={styles.panel} data-liquid-surface=""><div className={styles.panelTitle}><div><button className={styles.textLink} onClick={() => { setSelectedId(""); window.history.replaceState(null, "", href("account/requests")); }}>{text("back")}</button><h2>{text("requestDetails")}</h2></div><Status value={selected.status} /></div><div className={styles.requestMeta}><span><small>{text("tracking")}</small><bdi>{selected.id}</bdi></span><span><small>{text("requestType")}</small>{text(requestKind(selected.kind))}</span><span><small>{text("date")}</small>{formatDate(selected.createdAt, locale)}</span></div><p className={styles.requestBody}>{selected.message}</p><div className={styles.requestProducts}>{selected.productIds.map(id => { const product = displayProducts.find(item => item.id === id); return product ? <Link key={id} href={existingProductHref(product, locale)}><img src={product.image} alt="" width={40} height={40} /><ExistingProductName product={product} locale={locale} /><ArrowRight className={styles.directionArrow} size={14} /></Link> : null; })}</div>{selected.items && selected.items.length > 0 && <div className={styles.tableWrap}><table><thead><tr><th>{text("products")}</th><th>{text("mould")}</th><th>{text("shade")}</th><th>{text("quantity")}</th></tr></thead><tbody>{selected.items.map((item, index) => <tr key={index}><td><ExistingProductName product={displayProducts.find(product => product.id === item.productId)} locale={locale} fallback={item.productId} />{item.sku && <><br/><small dir="ltr">SKU: {item.sku}</small></>}</td><td><bdi>{item.mould || "—"}</bdi></td><td><bdi>{item.shade || "—"}</bdi></td><td>{new Intl.NumberFormat(locale).format(item.quantity)}{item.unit && <> <bdi>{item.unit}</bdi></>}</td></tr>)}</tbody></table></div>}<div className={styles.panelActions}><button className={styles.secondaryButton} onClick={() => downloadJson(publicRequestSnapshot(selected), `${selected.id}.json`)}><Download size={16} />{text("download")}</button>{owns(selected)&&!["closed", "withdrawn", "resolved"].includes(selected.status) && <button className={styles.dangerButton} onClick={() => setWithdrawId(selected.id)} aria-haspopup="dialog">{text("withdraw")}</button>}</div></div>{selected.booking&&<BookingReceipt booking={selected.booking} link={false}/>}<SharedQuotes request={selected} /><div className={styles.panel} data-liquid-surface=""><div className={styles.panelTitle}><h2>{text("conversation")}</h2><MessageSquare size={20} /></div><p className={styles.smallNote}>{text("publicOnly")}</p><div className={styles.conversation}><div className={styles.messageBubble}><strong>{selected.name}</strong><p>{selected.message}</p><time>{formatDate(selected.createdAt, locale)}</time></div>{(selected.messages || []).filter(message => message.visibility === "public").map(message => <div className={styles.messageBubble} key={message.id} data-own={message.sender === session?.name || message.sender === selected.name}><strong>{message.sender}</strong><p>{message.body}</p><time>{formatDate(message.createdAt, locale)}</time></div>)}</div>{(demoMode||owns(selected)||accessOf(selected)==="shared_reply")&&!["withdrawn", "closed"].includes(selected.status) && <form className={styles.replyForm} onSubmit={addReply}><label className={styles.field}><span>{text("reply")}</span><textarea value={reply} onChange={event => setReply(event.target.value)} placeholder={text("messagePlaceholder")} maxLength={4000} rows={3} required /></label><button className={styles.primaryButton} type="submit">{text("sendReply")}<Send size={16} /></button></form>}</div></> : <div className={styles.panel} data-liquid-surface=""><div className={styles.panelTitle}><h2>{text("allRequests")}</h2><Link className={styles.secondaryButton} href={href("products")}><Plus size={16} />{text("startInquiry")}</Link></div><div className={styles.listFilters}><label className={styles.searchInput}><Search size={17} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder={text("search")} aria-label={text("search")} /></label><select value={status} onChange={event => setStatus(event.target.value)} aria-label={text("status")}><option value="all">{text("all")}</option>{Array.from(new Set(requests.map(request => request.status))).map(value => <option value={value} key={value}>{text(value)}</option>)}</select></div>{filtered.length ? <RequestList requests={filtered} onSelect={setSelectedId} /> : <EmptyState title={text("noRequests")} href={href("products")} action={text("startInquiry")} />}</div>}
    {withdrawTarget && <Modal title={text("withdraw")} className={styles.requestConfirmation} onClose={() => setWithdrawId(null)}>
      <p className={styles.requestConfirmationText}>{text("confirmWithdraw")}</p>
      <p className={styles.requestConfirmationId}><bdi>{withdrawTarget.id}</bdi></p>
      <div className={styles.requestConfirmationActions}>
        <button type="button" className="btn" onClick={() => setWithdrawId(null)}>{text("cancel")}</button>
        <button type="button" className={`btn ${styles.confirmationDanger}`} onClick={confirmWithdrawal}>{text("withdraw")}</button>
      </div>
    </Modal>}
  </>;
}

function SharedQuotes({ request }: { request: FrontRequest }) {
  const { locale, updateRequest, notify,session } = useApp(); const text = useAccountText(); const [notes, setNotes] = useState<Record<string, string>>({});
  const [quoteNow, setQuoteNow] = useState(() => Date.now());
  const quotes = useMemo(() => request.sharedQuotes || [], [request.sharedQuotes]);
  useEffect(() => {
    const refresh = () => setQuoteNow(Date.now());
    const nextExpiry = Math.min(...quotes.filter(quote => quote.status === "issued").map(quote => Date.parse(quote.validUntil || "")).filter(time => time > quoteNow));
    const timer = Number.isFinite(nextExpiry) ? window.setTimeout(refresh, Math.max(1, Math.min(nextExpiry - Date.now() + 1, 2147483647))) : undefined;
    window.addEventListener("focus", refresh);
    return () => { if (timer !== undefined) window.clearTimeout(timer); window.removeEventListener("focus", refresh); };
  }, [quotes, quoteNow]);
  const respond = async (quote: SharedQuote, status: QuoteResponseStatus) => {
    const at = Date.now();
    setQuoteNow(at);
    const response = createQuoteResponse(quote, status, notes[quote.id] || "", at);
    if (!response || (!demoMode&&request.ownerId!==session?.id)) { notify(text(quote.status === "issued" ? "quoteExpiredHelp" : "quoteResponseClosed")); return; }
    if (await updateRequest(request.id, { sharedQuotes: quotes.map(item => item.id === quote.id ? response : item) })) notify(text(demoMode?"localReply":"savedChanges"));
  };
  const statusLabels: Record<SharedQuote["status"], string> = { issued: "quoteIssuedStatus", accepted_interest: "quoteInterestStatus", declined: "quoteDeclinedStatus", revision_requested: "requestRevision" };
  const responseLabels: Record<QuoteResponseStatus, string> = { accepted_interest: "interestRecorded", declined: "declinedRecorded", revision_requested: "revisionRecorded" };
  if (!quotes.length) return null;
  return <div className={styles.panel} data-liquid-surface=""><div className={styles.panelTitle}><h2>{text("quotes")}</h2><FileText size={20} /></div>{quotes.map(quote => {
    const canRespond = (demoMode||request.ownerId===(session?.id||"guest"))&&canRespondToQuote(quote, quoteNow);
    const expired = quote.status === "issued" && !canRespondToQuote(quote, quoteNow);
    return <article className={styles.quoteCard} key={quote.id}>
      <header><div><strong>{quote.title}</strong><small><bdi>{quote.number}</bdi> · {formatDate(quote.issuedAt, locale)}</small></div><span className={styles.quoteAmount}><bdi>{quote.amount} {quote.currency}</bdi></span></header>
      <QuoteLines lines={quote.lines || []}/>{!demoMode&&<a className={styles.secondaryButton} href={`/api/v1/requests/${encodeURIComponent(request.id)}/quotes/${encodeURIComponent(quote.id)}/pdf`} download><Download size={16}/>PDF · {text("download")}</a>}
      {request.quoteEnvelopes?.some(envelope=>envelope.recordId===quote.recordId&&envelope.currentRevisionId===quote.id)&&<p className={styles.statusBadge}>{localized('آخرین نسخه صادرشده','Current issued revision','Geçerli düzenlenmiş sürüm','آخر إصدار صادر','Текущая выпущенная версия')[locale]}</p>}
      <details><summary>{localized('شناسه‌های سند ثابت','Immutable document identifiers','Değişmez belge tanımları','معرّفات الوثيقة الثابتة','Идентификаторы неизменяемого документа')[locale]}</summary><p>SHA-256 · {localized('محتوای تجاری','Commercial snapshot','Ticari anlık görüntü','اللقطة التجارية','Коммерческий снимок')[locale]} <code dir="ltr" style={{overflowWrap:'anywhere'}}>{quote.snapshotHash}</code></p>{quote.fileSha256&&<p>SHA-256 · PDF <code dir="ltr" style={{overflowWrap:'anywhere'}}>{quote.fileSha256}</code> · {quote.fileByteCount} B</p>}{quote.fileOrigin==='legacy-rendered'&&<p>{localized('فایل از نسخهٔ قدیمی دارای اطلاعات ثابت طرفین ساخته شده است.','The file was generated from a historical revision with frozen party details.','Dosya sabit taraf bilgileri içeren geçmiş sürümden oluşturuldu.','أُنشئ الملف من إصدار تاريخي ببيانات أطراف ثابتة.','Файл создан из исторической версии с зафиксированными данными сторон.')[locale]}</p>}</details>
      {quote.terms && <p className={styles.requestBody}>{quote.terms}</p>}
      <span className={styles.statusBadge} data-tone={expired ? "muted" : quote.status === "revision_requested" ? "warning" : quote.status === "accepted_interest" ? "success" : "info"}>{text(expired ? "quoteExpired" : statusLabels[quote.status])}</span>
      <p className={styles.smallNote}>{text("quoteInterestNote")}</p>
      {quote.validUntil && <small>{text("validUntil")}: {formatDate(quote.validUntil, locale)}</small>}
      {quote.status === "issued" ? <>
        {expired && <p id={`quote-expired-${quote.id}`} className={styles.smallNote} role="status">{text("quoteExpiredHelp")}</p>}
        <label className={styles.field}><span>{text("note")}</span><textarea value={notes[quote.id] || ""} onChange={event => setNotes(value => ({ ...value, [quote.id]: event.target.value }))} rows={2} maxLength={1000} disabled={!canRespond} /></label>
        <div className={styles.panelActions} aria-describedby={expired ? `quote-expired-${quote.id}` : undefined}>
          <button className={styles.primaryButton} disabled={!canRespond} onClick={() => respond(quote, "accepted_interest")}>{text("expressInterest")}<Check size={16} /></button>
          <button className={styles.secondaryButton} disabled={!canRespond} onClick={() => respond(quote, "declined")}>{text("reject")}</button>
          <button className={styles.secondaryButton} disabled={!canRespond} onClick={() => respond(quote, "revision_requested")}>{text("requestRevision")}</button>
        </div>
      </> : <><p className={quote.status === "declined" ? styles.smallNote : styles.successMessage} role="status">{text(responseLabels[quote.status])}</p>{quote.customerResponse && <p className={styles.requestBody}>{quote.customerResponse}</p>}</>}
      <button className={styles.textLink} onClick={() => window.print()}>{text("print")}</button>
    </article>;
  })}</div>;
}

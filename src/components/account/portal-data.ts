import type { FrontSession } from "@/lib/auth";
import type { FrontRequest, InquiryLine, SharedQuote } from "@/types/frontend";
import type { Product } from "@/data/catalog";
import { parseSharedQuotes,inquiryIdentity } from '@/lib/frontend-state';

export function canViewRequest(request: FrontRequest, session: FrontSession | null): boolean {
  if (!session) return request.ownerId === "guest";
  if (request.ownerId === session.id) return true;
  const email = session.email.trim().toLowerCase();
  return Boolean(email && String(request.email || "").trim().toLowerCase() === email);
}

export function publicRequestSnapshot(request: FrontRequest) {
  return {
    id: request.id, kind: request.kind, name: request.name, email: request.email,
    organization: request.organization, message: request.message,
    productIds: request.productIds, items: request.items, status: request.status,
    createdAt: request.createdAt,
    sharedQuotes: parseSharedQuotes(request.sharedQuotes),
    messages: (request.messages || []).filter(message => message.visibility === "public"),
  };
}

/** A small RFC 4180 reader for a deliberate, user-selected local CSV file. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], value = "", quoted = false;
  const input = text.replace(/^\uFEFF/, "");
  for (let index = 0; index < input.length; index++) {
    const char = input[index];
    if (char === '"') {
      if (quoted && input[index + 1] === '"') { value += '"'; index++; }
      else quoted = !quoted;
    } else if (char === "," && !quoted) { row.push(value); value = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && input[index + 1] === "\n") index++;
      row.push(value); if (row.some(cell => cell.trim())) rows.push(row);
      row = []; value = "";
    } else value += char;
  }
  if (quoted) throw new Error("Unclosed CSV quote");
  row.push(value); if (row.some(cell => cell.trim())) rows.push(row);
  return rows;
}

export function importInquiryCsv(text: string, products: Product[]): InquiryLine[] {
  const [header, ...rows] = parseCsv(text);
  if (!header || !rows.length || rows.length > 500) throw new Error("Invalid row count");
  const columns = header.map(cell => cell.trim().toLowerCase());
  const productIndex = columns.findIndex(value => value === "productid" || value === "product");
  const quantityIndex = columns.indexOf("quantity");
  const shadeIndex = columns.indexOf("shade");
  const mouldIndex = columns.indexOf("mould");
  if (productIndex < 0 || quantityIndex < 0) throw new Error("Missing columns");
  return rows.map(row => {
    const name = (row[productIndex] || "").trim();
    const product = products.find(item => item.id === name || item.brand.toLowerCase() === name.toLowerCase() || Object.values(item.name).includes(name));
    const quantity = Number(row[quantityIndex]);
    if (!product || !Number.isInteger(quantity) || quantity < 1 || quantity > 100000) throw new Error("Invalid product or quantity");
    const shade = shadeIndex >= 0 ? row[shadeIndex]?.trim() : "";
    const mould = mouldIndex >= 0 ? row[mouldIndex]?.trim() : "";
    if ((shade?.length || 0) > 40 || (mould?.length || 0) > 40) throw new Error("Invalid variant code");
    return { productId: product.id, quantity, ...(shade ? { shade } : {}), ...(mould ? { mould } : {}) };
  });
}

export function mergeInquiryLines(current: InquiryLine[], incoming: InquiryLine[]): InquiryLine[] {
  const next = current.map(line => ({ ...line }));
  for (const line of incoming) {
    const existing = next.find(item => inquiryIdentity(item) === inquiryIdentity(line));
    if (existing) existing.quantity = Math.min(100000, existing.quantity + line.quantity);
    else next.push({ ...line });
  }
  return next;
}

export type { SharedQuote } from "@/types/frontend";
export type QuoteResponseStatus = Exclude<SharedQuote["status"], "issued">;

/** The expiry boundary is exclusive: a response at validUntil is already too late. */
export function canRespondToQuote(quote: SharedQuote, at = Date.now()): boolean {
  if (quote.status !== "issued" || !Number.isFinite(at)) return false;
  if (!quote.validUntil) return true;
  const deadline = Date.parse(quote.validUntil);
  return Number.isFinite(deadline) && at < deadline;
}

/** Preserve the issued commercial snapshot while recording one customer response. */
export function createQuoteResponse(quote: SharedQuote, status: QuoteResponseStatus, note: string, at = Date.now()): SharedQuote | null {
  if (!canRespondToQuote(quote, at) || !["accepted_interest", "declined", "revision_requested"].includes(status)) return null;
  return { ...quote, status, customerResponse: note.trim().slice(0, 1000), respondedAt: new Date(at).toISOString() };
}

const sameValue = (first: unknown, second: unknown) => JSON.stringify(first) === JSON.stringify(second);
const quoteSnapshotKeys = ["id", "number", "title", "amount", "currency", "issuedAt", "validUntil", "snapshotHash", "lines", "terms", "recordId", "requestId", "locale", "customerSnapshot", "sellerSnapshot", "pricebookSnapshot", "calculationPolicyVersion", "fileSha256", "fileByteCount", "fileCreatedAt", "fileOrigin"] as const;

/** The personal portal can append a public reply, withdraw an open request, or
 * respond to one issued quote. Every other field belongs to the staff workflow.
 * This guard runs against the latest local record, not the component's snapshot.
 * The backend must independently enforce the same ownership and action policy. */
export function applyCustomerRequestPatch(request: FrontRequest, patch: Partial<FrontRequest>, session: FrontSession | null, at = Date.now()): FrontRequest | null {
  if (!Number.isFinite(at) || !canViewRequest(request, session)) return null;
  const keys = Object.keys(patch);
  if (!keys.length) return null;
  const finish = (change: Partial<FrontRequest>): FrontRequest => ({ ...request, ...change, id: request.id, version: (request.version || 1) + 1 });

  if (keys.length === 1 && keys[0] === "status") {
    if (patch.status !== "withdrawn" || ["closed", "withdrawn", "resolved", "complete"].includes(request.status)) return null;
    return finish({ status: "withdrawn" });
  }

  if (keys.every(key => key === "messages" || key === "status") && Array.isArray(patch.messages)) {
    if (["closed", "withdrawn"].includes(request.status)) return null;
    const previous = request.messages || [], proposed = patch.messages;
    if (proposed.length !== previous.length + 1 || previous.some((message, index) => !sameValue(message, proposed[index]))) return null;
    const addition = proposed[previous.length];
    if (!addition || addition.visibility !== "public" || typeof addition.id !== "string" || !addition.id.trim() || addition.id.length > 128 || previous.some(message => message.id === addition.id)) return null;
    if (typeof addition.body !== "string" || !addition.body.trim() || addition.body.trim().length > 4000) return null;
    const status = request.status === "waiting_customer" ? "in_review" : request.status;
    if (patch.status !== undefined && patch.status !== status) return null;
    return finish({ status, messages: [...previous, { id: addition.id, body: addition.body.trim(), visibility: "public", createdAt: new Date(at).toISOString(), sender: session?.name || request.name }] });
  }

  if (keys.length === 1 && keys[0] === "sharedQuotes" && Array.isArray(patch.sharedQuotes)) {
    const previous = request.sharedQuotes || [], proposed = patch.sharedQuotes;
    if (!previous.length || proposed.length !== previous.length) return null;
    let changed = 0;
    const next: SharedQuote[] = [];
    for (let index = 0; index < previous.length; index++) {
      const original = previous[index], candidate = proposed[index];
      if (!candidate || candidate.id !== original.id) return null;
      if (sameValue(original, candidate)) { next.push(original); continue; }
      if (++changed > 1 || candidate.status === "issued" || typeof candidate.customerResponse !== "string") return null;
      if (Object.keys(candidate).some(key => ![...quoteSnapshotKeys, "status", "customerResponse", "respondedAt"].includes(key as typeof quoteSnapshotKeys[number]))) return null;
      if (quoteSnapshotKeys.some(key => !sameValue(original[key], candidate[key]))) return null;
      const response = createQuoteResponse(original, candidate.status, candidate.customerResponse, at);
      if (!response) return null;
      next.push(response);
    }
    return changed === 1 ? finish({ sharedQuotes: next }) : null;
  }
  return null;
}

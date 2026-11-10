import test from "node:test";
import assert from "node:assert/strict";
import { loadTs } from "./helpers/load-ts.mjs";

const { canViewRequest, publicRequestSnapshot, parseCsv, importInquiryCsv, mergeInquiryLines, canRespondToQuote, createQuoteResponse } = await loadTs("src/components/account/portal-data.ts");
const { buildLocalAccount, digestPassword, isValidPassword, normalizeVerificationCode, savePendingSignIn, readPendingSignIn, PENDING_KEY } = await loadTs("src/components/account/auth-storage.ts");
const { products } = await loadTs("src/data/catalog.ts");
const product = products.find(item => item.family === "teeth");

const customer = { id: "customer-a", role: "customer", name: "Test customer", email: "customer-a@example.test", demo: true };
const request = (patch = {}) => ({
  id: "REQ-TEST-1", kind: "rfq", name: "Test customer", email: customer.email,
  ownerId: customer.id, organization: "Test laboratory", message: "Please review the selected products.",
  productIds: [product.id], status: "received", createdAt: "2026-01-01T10:00:00.000Z", ...patch,
});

function installSessionStorage(t) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  const values = new Map();
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: storage });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "sessionStorage", previous);
    else delete globalThis.sessionStorage;
  });
  return storage;
}

test("a customer can view an explicitly owned request even after a contact email changes", () => {
  assert.equal(canViewRequest(request({ email: "previous@example.test" }), customer), true);
});

test("email adoption uses a normalized exact match, never a substring or an empty email", () => {
  assert.equal(canViewRequest(request({ ownerId: "guest", email: "  CUSTOMER-A@EXAMPLE.TEST  " }), customer), true);
  assert.equal(canViewRequest(request({ ownerId: "guest", email: "prefix-customer-a@example.test" }), customer), false);
  assert.equal(canViewRequest(request({ ownerId: "guest", email: "" }), { ...customer, email: "  " }), false);
});

test("a guest sees only requests explicitly created by the local guest", () => {
  assert.equal(canViewRequest(request({ ownerId: "guest" }), null), true);
  assert.equal(canViewRequest(request(), null), false);
  assert.equal(canViewRequest(request({ ownerId: undefined }), null), false);
});

test("unrelated customer requests stay private and staff have no personal-portal bypass", () => {
  const unrelated = request({ ownerId: "customer-b", email: "customer-b@example.test" });
  assert.equal(canViewRequest(unrelated, customer), false);
  assert.equal(canViewRequest(unrelated, { ...customer, role: "superAdmin" }), false);
  assert.equal(canViewRequest({ ...unrelated, ownerId: undefined }, customer), false);
});

test("customer request exports exclude internal messages and private record metadata", () => {
  const publicMessage = { id: "public-1", body: "A reply for the customer", visibility: "public", createdAt: "2026-01-02T10:00:00.000Z", sender: "support" };
  const internalMessage = { id: "private-1", body: "INTERNAL-NOTE-DO-NOT-EXPORT", visibility: "internal", createdAt: "2026-01-02T09:00:00.000Z", sender: "business" };
  const source = request({ messages: [publicMessage, internalMessage], internalHistory: "PRIVATE-AUDIT", passwordDigest: "PRIVATE-DIGEST" });
  const output = publicRequestSnapshot(source);
  assert.deepEqual(output.messages, [publicMessage]);
  assert.equal(output.id, source.id);
  assert.equal(output.message, source.message);
  assert.doesNotMatch(JSON.stringify(output), /INTERNAL-NOTE|PRIVATE-AUDIT|PRIVATE-DIGEST/);
  assert.equal(source.messages.length, 2, "exporting must not remove the internal message from the original record");
});

test("CSV parsing preserves BOM, CRLF, quoted commas, escaped quotes and multiline cells", () => {
  const csv = '\uFEFFproductId,note\r\n' + product.id + ',"A comma, a ""quote""\r\nand another line"\r\n';
  assert.deepEqual(parseCsv(csv), [["productId", "note"], [product.id, 'A comma, a "quote"\r\nand another line']]);
  assert.throws(() => parseCsv('productId,note\n' + product.id + ',"unfinished'), /quote/i);
});

test("CSV import resolves real factory products and retains the chosen mould, shade and quantity", () => {
  const csv = `productId,mould,shade,quantity\n${product.id},N6,A2,12`;
  assert.deepEqual(importInquiryCsv(csv, products), [{ productId: product.id, mould: "N6", shade: "A2", quantity: 12 }]);
  const byBrand = `product,quantity\n${product.brand.toLowerCase()},2`;
  assert.equal(importInquiryCsv(byBrand, products)[0].productId, product.id);
});

test("CSV import rejects incomplete headers, empty data, invalid quantities and oversized imports", () => {
  const invalid = [
    "productId,quantity", `productId,shade\n${product.id},A2`,
    ...["", "0", "-1", "1.5", "NaN", "100001"].map(quantity => `productId,quantity\n${product.id},${quantity}`),
    `productId,quantity\n${Array.from({ length: 501 }, () => `${product.id},1`).join("\n")}`,
    `productId,quantity,shade\n${product.id},1,${"A".repeat(41)}`,
  ];
  for (const csv of invalid) assert.throws(() => importInquiryCsv(csv, products));
});

test("an unknown product aborts the whole CSV operation without changing the existing inquiry", () => {
  const current = [{ productId: product.id, quantity: 4 }];
  const before = structuredClone(current);
  const csv = `productId,quantity\n${product.id},2\nnot-a-factory-product,3`;
  assert.throws(() => mergeInquiryLines(current, importInquiryCsv(csv, products)), /product/i);
  assert.deepEqual(current, before);
});

test("inquiry merging sums the same variant, keeps distinct variants and leaves inputs unchanged", () => {
  const current = [{ productId: product.id, shade: "A2", mould: "N6", quantity: 4, note: "Keep this note" }];
  const incoming = [{ productId: product.id, shade: "A2", mould: "N6", quantity: 3 }, { productId: product.id, shade: "A3", mould: "N6", quantity: 2 }];
  const originalCurrent = structuredClone(current), originalIncoming = structuredClone(incoming);
  const merged = mergeInquiryLines(current, incoming);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].quantity, 7);
  assert.equal(merged[0].note, "Keep this note");
  assert.equal(merged[1].shade, "A3");
  assert.deepEqual(current, originalCurrent);
  assert.deepEqual(incoming, originalIncoming);
});

test("matrix merging obeys the provider quantity ceiling and treats omitted and blank variants equally", () => {
  const merged = mergeInquiryLines([{ productId: product.id, quantity: 90000, shade: "" }], [{ productId: product.id, quantity: 20000 }]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].quantity, 100000);
});

test("registration password rules require length, a letter and a number, including non-Latin letters", () => {
  for (const value of ["", "short1", "12345678", "onlyletters"]) assert.equal(isValidPassword(value), false);
  assert.equal(isValidPassword("Strong123!"), true);
  assert.equal(isValidPassword("رمزعبور123"), true);
});

test("local registration normalizes identity, fixes the customer role, salts each hash and stores no plaintext", async () => {
  const password = "UniqueTestPassword123!";
  const [first, second] = await Promise.all([
    buildLocalAccount("  Test customer  ", "  TEST@EXAMPLE.TEST  ", password),
    buildLocalAccount("Test customer", "test@example.test", password),
  ]);
  assert.equal(first.id, "local-test@example.test");
  assert.equal(first.name, "Test customer");
  assert.equal(first.email, "test@example.test");
  assert.equal(first.role, "customer");
  assert.notEqual(first.salt, second.salt);
  assert.notEqual(first.passwordDigest, second.passwordDigest);
  assert.match(first.passwordDigest, /^[a-f0-9]{64}$/);
  assert.equal("password" in first, false);
  assert.equal(JSON.stringify(first).includes(password), false);
});

test("the salted password digest verifies the original password and rejects a different password", async () => {
  const account = await buildLocalAccount("Test", "test@example.test", "OriginalPass123!");
  assert.equal(await digestPassword("OriginalPass123!", account.salt), account.passwordDigest);
  assert.notEqual(await digestPassword("DifferentPass123!", account.salt), account.passwordDigest);
});

test("the pending MFA step persists only identity and expires after ten minutes", t => {
  const storage = installSessionStorage(t);
  const now = Date.now();
  const identity = { id: customer.id, role: customer.role, name: customer.name, email: customer.email, route: "account" };
  savePendingSignIn(identity);
  const step = readPendingSignIn();
  assert.deepEqual({ ...step, expiresAt: undefined }, { ...identity, expiresAt: undefined });
  assert.ok(step.expiresAt >= now + 600000 && step.expiresAt <= Date.now() + 600000);
  assert.equal("password" in step, false);
  storage.setItem(PENDING_KEY, JSON.stringify({ ...step, expiresAt: Date.now() - 1 }));
  assert.equal(readPendingSignIn(), null);
});

test("corrupt or incomplete stored MFA steps are rejected without throwing", t => {
  const storage = installSessionStorage(t);
  for (const value of ["{broken", "null", JSON.stringify({ expiresAt: Date.now() + 600000 }), JSON.stringify({ ...customer, role: "unknown-role", route: "account", expiresAt: Date.now() + 600000 })]) {
    storage.setItem(PENDING_KEY, value);
    assert.equal(readPendingSignIn(), null);
  }
});

test("verification input accepts Latin, Persian and Arabic digits and preserves recovery codes", () => {
  for (const code of ["123456", " ۱۲۳۴۵۶ ", "١٢٣٤٥٦", "۱٢3 ۴٥6"]) assert.equal(normalizeVerificationCode(code), "123456");
  assert.equal(normalizeVerificationCode("  ab12cd34ef56  "), "ab12cd34ef56");
  assert.notEqual(normalizeVerificationCode("123450"), "123456");
});

const issuedQuote = {
  id: "QUOTE-TEST-1", number: "Q-1", title: "Test quotation", amount: "100", currency: "IRR",
  status: "issued", issuedAt: "2026-01-01T10:00:00.000Z", validUntil: "2026-01-10T10:00:00.000Z",
  snapshotHash: "test-commercial-snapshot",
};

test("quote response expiry is exclusive, including the exact deadline", () => {
  const deadline = Date.parse(issuedQuote.validUntil);
  assert.equal(canRespondToQuote(issuedQuote, deadline - 1), true);
  assert.equal(canRespondToQuote(issuedQuote, deadline), false);
  assert.equal(canRespondToQuote(issuedQuote, deadline + 1), false);
  assert.equal(createQuoteResponse(issuedQuote, "revision_requested", "Please revise", deadline), null);
  assert.equal(canRespondToQuote({ ...issuedQuote, validUntil: undefined }, deadline), true);
});

test("already-answered quotes and malformed expiry dates cannot receive a new response", () => {
  const beforeExpiry = Date.parse(issuedQuote.validUntil) - 1000;
  for (const status of ["accepted_interest", "declined", "revision_requested"]) {
    assert.equal(canRespondToQuote({ ...issuedQuote, status }, beforeExpiry), false);
    assert.equal(createQuoteResponse({ ...issuedQuote, status }, "accepted_interest", "Again", beforeExpiry), null);
  }
  assert.equal(canRespondToQuote({ ...issuedQuote, validUntil: "not-a-date" }, beforeExpiry), false);
  assert.equal(canRespondToQuote(issuedQuote, NaN), false);
  assert.equal(createQuoteResponse(issuedQuote, "paid", "", beforeExpiry), null);
});

test("all three customer responses preserve the issued snapshot and record one response time", () => {
  const at = Date.parse(issuedQuote.validUntil) - 1000;
  const original = structuredClone(issuedQuote);
  for (const status of ["accepted_interest", "declined", "revision_requested"]) {
    const response = createQuoteResponse(issuedQuote, status, "  Please follow up  ", at);
    assert.equal(response.status, status);
    assert.equal(response.customerResponse, "Please follow up");
    assert.equal(response.respondedAt, new Date(at).toISOString());
    assert.equal(response.snapshotHash, issuedQuote.snapshotHash);
    assert.equal(response.amount, issuedQuote.amount);
    assert.equal(response.issuedAt, issuedQuote.issuedAt);
    assert.equal(canRespondToQuote(response, at), false);
  }
  assert.deepEqual(issuedQuote, original);
});

test("the persisted quote parser retains revision requests and their response metadata", async () => {
  const { parseSharedQuotes } = await loadTs("src/lib/frontend-state.ts");
  const response = createQuoteResponse(issuedQuote, "revision_requested", "Revise the terms", Date.parse(issuedQuote.validUntil) - 1000);
  const [parsed] = parseSharedQuotes([response]);
  assert.equal(parsed.status, "revision_requested");
  assert.equal(parsed.customerResponse, "Revise the terms");
  assert.equal(parsed.respondedAt, response.respondedAt);
});

test("a revision request reaches the CRM once with its own label and leaves the sales stage unchanged", async () => {
  const { createWorkspaceSeed } = await loadTs("src/data/workspace-seed.ts");
  const { mergeWorkspaceRequests } = await loadTs("src/components/workspace/store.ts");
  const seed = createWorkspaceSeed();
  const quoteRecord = { ...seed.records.find(record => record.collection === "quotes"), id: issuedQuote.id, requestId: "REQ-TEST-1", status: "proposal", history: [] };
  const quoteResponse = createQuoteResponse(issuedQuote, "revision_requested", "Please revise the quantities", Date.parse(issuedQuote.validUntil) - 1000);
  const source = request({ sharedQuotes: [quoteResponse] });
  const next = mergeWorkspaceRequests({ ...seed, records: [quoteRecord, ...seed.records] }, [source]);
  const result = next.records.find(record => record.id === issuedQuote.id);
  assert.equal(result.status, "proposal");
  assert.equal(result.quoteResponse.status, "revision_requested");
  assert.match(result.history[0].text.en, /revision requested/);
  assert.match(result.history[0].text.fa, /درخواست اصلاح/);
  assert.equal(mergeWorkspaceRequests(next, [source]), next);
});

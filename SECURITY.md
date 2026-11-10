# Security model and operational controls

This document describes controls implemented in this source release. It does not claim that every requirement in the master specification has passed acceptance or that a system can be defect-free. See `docs/PRODUCTION-COVERAGE.fa.md` for explicit gaps and `docs/VERIFICATION.fa.md` for executed evidence.

## Identity and sessions

New password verifiers use scrypt with N=32768, r=8, p=3, a random 16-byte salt and a 64-byte derived key. The verifier parser accepts only the canonical current p=3 format and the application's legacy p=1 format; it rejects unsupported algorithms, costs and malformed encodings. A valid legacy password is upgraded during login finalization after the current user and unchanged verifier are checked under a row lock. This can occur before the next MFA step. The rehash is recorded as `auth.password.rehashed`; it is representation maintenance and does not revoke existing sessions, reset links or MFA challenges. No plaintext-password migration or blanket reset is required. See [`src/server/crypto.ts`](src/server/crypto.ts) and [`src/server/auth.ts`](src/server/auth.ts).

Password derivation has a process-local admission limit of two active operations and sixteen waiting operations, with a two-second maximum queue wait. That wait is not a deadline for an already-running derivation. Full or expired admission returns generic HTTP 503 `AUTH_BUSY`, without lowering the work factor. A login rejected at this stage does not change the account's failed-login counter, lockout or credential audit; its preceding IP/email rate-limit attempt may already have been counted. Legacy checks add compensating work, and missing or malformed verifiers use current-profile dummy work. These controls do not promise constant response time.

Login finalization locks the current user, rechecks the verified password representation, active state and lockout, and uses current role and MFA data before creating a session or MFA challenge in that transaction. A proof made stale by a concurrent credential change cannot clear or increment the new credential's lockout state. Denied-login audit and applicable failure-counter updates commit before the generic 401 response. Two concurrent valid legacy-password logins may conservatively reject one after the other upgrades the verifier; an ordinary retry uses the new verifier.

Passwords and session bearer tokens are never returned in user DTOs. The database stores digests of session tokens, password-reset tokens, email-verification tokens and recovery codes.

Cookies are HttpOnly and SameSite=Lax, and use Secure for HTTPS deployments. Expiry and idle timeout are checked against the database. Deactivating a user or changing sensitive role/scope settings revokes sessions. Browser storage cannot grant a role or authenticate a production account.

State-changing browser requests require the exact configured origin and a CSRF token tied to the real session or signed guest cookie. API consumers must bootstrap through `GET /api/v1/auth/session`. Wildcard CORS is not enabled.

Staff enroll TOTP MFA before accessing the workspace. TOTP counters prevent replay, and recovery codes are consumed once. MFA secrets and pending enrollment data are encrypted with the runtime encryption key. Login finalization, MFA completion, password changes and reset-token operations serialize on the user row, with user-before-session/challenge lock ordering. Authenticated credential and MFA changes revalidate the current stored session before committing. An ordinary password change or reset consumes outstanding password-reset and password-based MFA login challenges, clears pending MFA enrollment, and revokes other sessions or all sessions respectively. Enrolled MFA remains in place for these ordinary password operations; a verifier-only rehash follows the separate maintenance behavior above. The dedicated staff MFA recovery action is documented separately in [USER-MANAGEMENT.fa.md](docs/USER-MANAGEMENT.fa.md).

Production staff provisioning defaults to `STAFF_PROVISIONING_MODE=hybrid`: protected environment settings initialize staff accounts, and authorized panel operations can subsequently manage staff identities and grants. The explicit `env` mode restricts staff creation and role/language/quality/CRM grant changes to the protected roster and owner command. Startup never silently rotates passwords, resets MFA or reactivates a disabled account. Public registration can only create a customer account; role overposting, invitation-based staff escalation and takeover of an existing customer email are rejected. Operational team membership and work handover remain separately authorized, versioned panel actions. See `docs/STAFF-ENV.fa.md`.

Recovery-code regeneration requires the current password, a verified active MFA session and a fresh unused authenticator code. Previous recovery codes, other sessions and pending authentication challenges are invalidated atomically. Plain recovery codes are returned once in a no-store response and are never written to the audit log.

Email verification is an explicit authenticated action. Its token is bound to the account and current email address, expires after 24 hours and is single-use. External delivery is queued rather than reported as delivered before the SMTP provider accepts it.

## Authorization and privacy

Every protected operation checks the actor obtained from the server session. Shared client policies support UI consistency but do not replace server checks. Quality cases require explicit quality access, translators are limited to assigned languages, and independent review is enforced by actor identity.

Private request access is based on the customer/guest proof, current authorized staff access or an explicit active organization share. Membership, organization status and request-share permission are checked on current database state. Shared reply access permits only a public message, not arbitrary case updates or the owner's commercial response. Revocation also affects subsequent attachment and quote-PDF access.

A media-management role does not authorize deletion of another user's private unattached upload. Linked request files and active content dependencies block deletion. Unknown or unauthorized private resources generally return 404 to avoid exposing their existence.

CRM authorization combines the current role with assigned/team/all scope, active team and territory membership, and explicit contact, financial, base-cost, assignment and intake capabilities. Customer and organizational access remain ownership or explicit-share based. The coverage matrix records the exact supported operations and independent review requirements.

User-directory reads require current administrative authority and staff MFA on every page. Kind, exact role, active state and literal name/email search are applied in parameterized SQL before the bounded page limit; no credential, session or MFA secret is selected for the response. Canonical cursors retain PostgreSQL timestamp precision and bind to the selected filters, but are not authorization tokens. Revoked roles, inactive accounts and invalid sessions cannot reuse an earlier page's authorization. Environment-owned provisioning and the separately bounded staff-handover operation retain their existing controls. See `docs/API.md` and `tests/server-user-directory.pg.mjs`.

## Mutation integrity

Zod schemas, explicit whitelists, size limits and prototype-key rejection validate input before mutation. Parameterized SQL is used for values. SQL identifiers chosen dynamically are internal enums rather than request values.

Versioned workspace updates lock the shared workspace clock and reject stale versions. Account/profile and request updates require their relevant expected version. Request intake uses an idempotency key scoped to the authenticated account or signed guest identity; a replay with different content is rejected.

Content revisions and approvals are immutable. Approval binds a real reviewer to stored content, and publication is generated from that reviewed source. A publisher cannot inject alternate content into the publish command. Scheduled publication rechecks current permissions, MFA and revision validity when executed.

Privacy and terms page mutations require current site-administration authority across draft writes, renames, leases, review, revision restoration and scheduled release. A general content editor or translator cannot bypass that gate through another lifecycle endpoint. Source seed intake on upgrade only repairs exact, untouched, empty factory drafts with proven provenance; edited, archived, deleted, reviewed, leased or published content is retained.

Quotation arithmetic uses decimal representations rather than floating-point currency totals. Issued quote snapshots are immutable, and a customer's permitted response cannot alter commercial fields. Exact issuance retries return the existing snapshot.

## Files

Uploads have bounded multipart bodies and administrator-configurable per-type byte limits, per-user/guest quotas and a total site quota. The server hard ceiling is 80 MiB per file; the reverse-proxy body bound includes limited multipart overhead. Atomic reservations account for concurrent writes, recheck a tightened policy at commit, and retain a free-disk reserve. Active account and current authorization are checked at commit. Allowed file types are detected from bytes; arbitrary HTML, SVG, executables and caller-selected storage paths are rejected. Images are decoded with pixel limits, normalized and re-encoded. Files use generated identifiers and private filesystem permissions. See `docs/UPLOAD-STORAGE.fa.md` for defaults and operator controls.

Non-image uploads and generated audio/video are quarantined until ClamAV reports a definitive clean result. Missing scanner configuration, timeouts or ambiguous scan responses do not mark a file clean. Public/private visibility and content-use checks are enforced separately from scan status.

Private content responses use no-store caching, safe content disposition, nosniff and restrictive content security policy. Byte-range requests remain subject to the same access checks. Backups contain private data and therefore require the encrypted backup workflow.

The Next image optimizer accepts only explicitly listed bundled public paths. Private attachment APIs, arbitrary external images and caller-supplied query endpoints are not image-optimizer sources. Private media is served by its authorization-aware endpoint.

## Browser execution policy

Every HTML document receives a fresh 192-bit random nonce. The proxy overwrites any incoming nonce or CSP header, forwards the authoritative policy to Next and sends the same policy to the browser. Production scripts use `script-src 'self' 'nonce-…' 'strict-dynamic'` without script `unsafe-inline` or `unsafe-eval`. Framework hydration, display initialization and structured data carry the matching nonce. Pages are dynamically rendered; nonce-bearing HTML is not a static shared cache object.

API-owned preview and private-file sandbox policies are preserved. Same-origin workers receive their own import policy; optional Najva imports are constrained to configured official service origins and its consent flow. Existing inline styles remain allowed for the retained interface design. A script nonce does not turn untrusted markup into trusted content; renderers continue to validate links and reject executable input.

## Provider boundaries

Provider keys are runtime-only secrets. The default notification mode is disabled. AI requires configured keys and explicit compatible model identifiers. Provider API URLs are fixed or constrained to the supported service domain; redirects are not followed for these calls.

Public AI context is assembled from public catalogue and current published content. Archived/withdrawn products are excluded from current catalogue retrieval. CRM records, account details and private messages are not inserted into public chat context.

AI budget reservations serialize in PostgreSQL and retain uncertain submissions for reconciliation. Configure request reservations conservatively for the selected provider/model; an application reservation does not replace provider-side spending limits.

Editorial translations read exact saved source revisions, protect technical tokens and links, and require strict provider JSON output. Proposals are account-bound, authenticated-encrypted, short-lived and single-use, including a no-op human save. Applying a proposal rechecks current authority, source and target checksums, the workspace version and editor leases in the normal draft transaction. Translation never grants publication authority. Language-script checks are an additional validation, not proof of semantic translation quality.

Generated image, audio and video persistence rechecks current account, MFA, role and locale inside the asset commit transaction. Audio/video result, quota, scan work, usage state and job completion commit together. Revoked access and a competing completed job cannot leave an orphan generated asset. Video polling compares the exact PostgreSQL timestamp instead of a JavaScript value that loses microsecond precision.

OpenRouter webhooks require a valid HMAC and recent timestamp. A callback can only prompt polling of the trusted provider API; it cannot insert arbitrary downloadable content.

Marketing recipients are resolved against current account endpoints and consent at queue time and again before dispatch. An email address cannot borrow another user's consent; unsupported marketing channels are rejected. In-app and email preferences are independent. See the current notification-policy implementation and coverage report for supported topic/frequency behavior.

## Runtime and recovery

The production image runs with a non-root UID. Compose separates public ingress from the database network, drops Linux capabilities, uses read-only root filesystems and explicit writable volumes, and limits container log rotation. The application database role is distinct from the migration owner.

Keep `SESSION_SECRET`, `MFA_ENCRYPTION_KEY`, database credentials, provider keys and the age backup identity outside the source bundle. Losing the MFA encryption key prevents decrypting existing enrollment data; loss of the age identity prevents backup decryption. Changing an environment variable does not automatically rotate an initialized PostgreSQL role's password.

Format3 backups coordinate writers and contain the database, all media, application source, protected configuration, integration files, independent-ledger recovery material and Caddy TLS state. The age identity is kept outside the archive. An identity-bound manifest MAC authenticates source before recovered code can execute; encryption to a known recipient alone is not treated as proof of sender identity. Bounded archive extraction rejects traversal, symlinks, unexpected members, format downgrade and nested archive substitution. Database structure, rows, sequences and media hashes are checked during recovery. Migration checksums prevent silently editing an already-applied migration. See `docs/BACKUP-RESTORE.fa.md`.

Existing-install recovery retains the current independent privacy ledger and replays erasures. A fresh-host recovery must reconcile any newer independent ledger available to the operator. Restored sessions, pending challenges/invitations and recovery codes are invalidated before readiness, while password hashes and enrolled TOTP secrets are retained. Same-host access capture preserves current revocations and grants; a restored credential state that differs from the current security capture requires explicit owner recovery. This comparison includes the exact password verifier: a legacy p=1 to p=3 rehash after the snapshot can therefore trigger the same conservative mismatch gate even when the plaintext password has not changed. See `docs/RESTORE-SECURITY.fa.md`; a rehash alone does not require resetting enrolled MFA. A fresh host cannot infer revocations that occurred after its newest available backup or security record. Database administrators and the deployment owner remain trusted boundaries.

## Verification and reporting

The current operational changes add canonical-path preflight for the daily backup timer and full-URL identity checks to the public audit tools. ProtectHome and PrivateTmp remain enabled. The application source and dependency lockfile are unchanged, while the canonical runtime fingerprint has changed. Focused results are 7 installer-path tests and 29 audit-runner tests; these do not replace the pending complete gates, final-runtime build or actual Ubuntu recovery acceptance. Native acceptance services are stopped, and the separately prepared delivery database is not presented as a running delivery site. See [the current verification report](docs/VERIFICATION.fa.md).

The dated dependency assessment is in [docs/DEPENDENCY-SECURITY.fa.md](docs/DEPENDENCY-SECURITY.fa.md). The current runtime audit reported zero advisories for the reviewed lockfile; the selected run and exact scope are recorded in `docs/VERIFICATION.fa.md`. The fresh full-development audit on 2026-10-21 reports seven findings (five high and two moderate), with exit code 1: the unresolved build-time braces chain and the aggregate selector-parser advisory range despite the maintainer-listed 6.1.5 security backport. All seven lock entries are development dependencies. An independent census of all 182 nested package.json files in the actual standalone build found none of those seven package names; this does not replace inspection of the final Docker image or prove the absence of embedded code inside another package. A runtime-only scan is not represented as a clean full-development scan. The fixed Tailwind source glob and PostCSS configuration consume reviewed repository files; no CMS or uploaded-content path into those build parsers was found in the inspected source. Keep untrusted build configurations and glob patterns out of credentialed CI. Published versions in the current dependency branches do not remove the braces finding; forcing Chokidar or Tailwind across major API changes is not treated as a compatible security fix.

Tests cover adversarial ownership, permission injection, CSRF, MFA replay, reset concurrency, private media, publication, quote response integrity, organization revocation and automation behavior. Tests create disposable schema/fixtures. Browser traces may contain those disposable credentials and must not be placed in public files or source archives.

Do not interpret audit output from a different dependency lockfile or a historical frontend build as validation of this release. Record the source manifest, runtime image identifier and exact verification run used for deployment.

When investigating an issue, retain request IDs and minimal technical metadata. Do not paste bearer cookies, password-reset or invite links, MFA secrets, private documents or full environment files into issue trackers. Contact the deployment owner through an established private channel; this repository does not invent a security contact address.


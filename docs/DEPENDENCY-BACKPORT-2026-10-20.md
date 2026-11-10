# Build dependency security backport — 2026-10-20

The release keeps Tailwind 3 and the existing design. Its compatible selector-parser dependency was refreshed from `postcss-selector-parser` 6.1.4 to the security backport 6.1.5. No Tailwind major upgrade or advisory suppression was used.

## Reason for the update

The maintainer advisory [GHSA-rj75-hqrm-r3gf](https://github.com/postcss/postcss-selector-parser/security/advisories/GHSA-rj75-hqrm-r3gf) identifies quadratic selector parsing and lists patched releases 6.1.5 and 7.1.6. The 6.1.5 package changelog, dated 2026-10-19, backports the fix to the 6.x dependency line used by Tailwind 3. Its parser replaces repeated linear membership scans with sets while retaining the 6.x API and dependencies. The maintainer distinguishes applications accepting untrusted CSS from trusted build-time processing.

The project builds styles from checked-in source using the static Tailwind content pattern `./src/**/*.{ts,tsx}`. This assessment does not treat the presence of a build-only vulnerability as a remotely demonstrated website exploit, and does not remove it from the audit by ignoring it.

## Local output-equivalence evidence

Both versions were tested independently against the same actual source and built CSS. The test parsed 5,056 selectors from 38 source CSS files and 21 built CSS files, serialized the selector ASTs, then compiled the project styles through the actual Tailwind 3 and Autoprefixer pipeline. The 6.1.5 package was first loaded from an isolated temporary directory; the project dependencies were updated only after these results matched.

| Measurement | 6.1.4 | 6.1.5 |
| --- | --- | --- |
| Selectors parsed | 5,056 | 5,056 |
| Compiled CSS bytes | 525,579 | 525,579 |
| Selector AST SHA-256 | `105bf693db7e352557d64eba20e7d20fe1f44237bb4aaae24af2dd41f249df5d` | Same |
| Compiled CSS SHA-256 | `26a14219f411a2a1602ecc09bc43a763b4fc2deaff91770dd238c671e78b681f` | Same |
| Compiler warnings | None | None |

The retained machine-readable evidence is [parser-6.1.4.json](verification-evidence/parser-6.1.4.json) and [parser-6.1.5.json](verification-evidence/parser-6.1.5.json). This is evidence of unchanged output for this project, not a claim about every possible selector accepted by the dependency.

## Remaining dependency finding

The separate braces stack-exhaustion advisory [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) affects releases through 3.0.3 and had no patched release at the time of this check. It remains in the development/build dependency chain. The current production-only audit reported zero vulnerabilities; that statement must not be extended to the full development dependency tree. The complete release audit is retained in the verification evidence.

The production runtime installs production dependencies without the Tailwind build toolchain. Application content and CMS fields are not accepted as build-time glob patterns. A future patched compatible dependency should be evaluated and installed through the normal build and verification process. Migrating Tailwind across a major version solely to change the audit count would require a separate design/output review and was not done in this repair.

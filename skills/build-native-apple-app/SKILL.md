---
name: build-native-apple-app
description: Use when planning, building, auditing, or shipping a native Apple app for iOS, iPadOS, macOS, watchOS, tvOS, or visionOS. Applies to SwiftUI, UIKit, AppKit, Xcode projects, Swift packages, simulator/device validation, App Intents, Apple Intelligence, TestFlight/App Store readiness, and work that must justify native Apple platform leverage instead of a web or cross-platform shell.
---

# Build Native Apple App

## Operating Rule

Build the native app all the way to a locally validated state. Treat native platform value as a product requirement, not an implementation detail. The app should use Apple-native capabilities only where they make the product better, more private, faster, more integrated, or more delightful.

When the operator grants autopilot/no-human-gates authority, use sub-agent implementors and harsh reviewers as gates. Stop for humans only for credentials, secrets, paid-program enrollment, destructive production actions without a safe staged path, or product decisions the operator has not delegated.

## First Pass

1. Read repo instructions first: `AGENTS.md`, project docs, existing product/design docs, CI workflows, and release docs.
2. Confirm target platforms and minimum OS versions from the user, repo docs, product brief, or existing project settings. If unknown, stop for an explicit decision; do not invent deployment targets or choose beta OS minimums.
3. Inventory local tools:

```bash
xcodebuild -version
swift --version
xcrun simctl list runtimes
```

4. Run `scripts/apple-native-preflight.sh` from this skill against the app repo when useful.
5. Check current Apple docs for newly announced frameworks before locking architecture. Prefer Apple Developer pages, WWDC guides/videos, HIG, and release notes.

Read `references/wwdc26-native-levers.md` when the work may use recent WWDC26 capabilities.
Read `references/validation-matrix.md` before claiming the app is validated.

## Native Justification

Before major implementation, write a short native-justification note in the app repo. It must answer:

- Which workflows are better because this is native?
- Which Apple frameworks are intentionally used, and which tempting ones are deferred or rejected?
- What should remain shared with web/backend instead of being duplicated?
- Which design-language invariants survive the native translation?
- How will iOS, iPadOS, and macOS differ where each platform expects different structure?

Good native reasons include offline-first local data, widgets, Shortcuts/App Intents, Siri and Spotlight, Share Sheet, Photos/Camera/Vision capture, on-device AI, background refresh, Keychain, Apple-native accessibility, platform navigation, menu bar/windowing on macOS, and high-quality simulator/device validation.

Weak native reasons include copying the web UI into SwiftUI, adding novelty APIs with no user benefit, or building custom controls where system controls are better.

## Product Parity Audit

Before converting a web/product surface into native work units, audit the current product model from source code, routes, backend helpers, docs, and screenshots. Treat that audit as a source-fidelity gate:

- Inventory every current product surface and route, including quiet operational routes such as account handoffs, approval links, settings subpanels, search scopes, and well-known files.
- Mark each surface as native UI, secure web handoff, custom URL-scheme-only native action, or intentionally out of scope because it is not a current product surface.
- Do not add comments, feeds, likes, meal planning, media libraries, or other future product surfaces while doing parity work unless the operator explicitly expands scope.
- When planning, audit, parity matrix, and doing docs all act as source material, keep them aligned. If a later reviewer narrows or corrects scope, update the supporting artifacts too and add a stale-language check for the old requirement.
- Distinguish Associated Domains/Universal Links for real HTTPS routes from custom URL schemes for native-only actions. Do not AASA-claim routes that do not exist unless the plan explicitly adds and tests those web routes.
- When a web framework has layout, index, or pathless routes, make route manifests module-aware rather than URL-only. Track both route identity/file and URL pattern, and allow duplicate URL patterns only when the modules coalesce to one URL-level universal-link/share decision.
- Keep parity matrices and route plans explicit about this split: AASA/universal links cover real web route modules, while native-only actions such as sheet entry points, local drafts, and command shortcuts stay custom-scheme-only until a tested web route exists.
- For share, Spotlight, App Intents, and Siri, expose the current model through entities and transfer values; avoid string-ID-only shortcuts when the platform can resolve real entities.
- Capture surfaces must turn native inputs into importable domain data. Photo-library and camera affordances should load real image bytes, request platform permissions, run OCR or another tested extraction path, and preserve the prior draft when capture, OCR, or replacement fails. A UI that records only an asset identifier or fabricated camera token creates dead drafts, not native parity.
- When a native surface depends on a backend/API route that does not yet exist, build the real backend contract in the same implementation unit. Do not leave the native app pointed at a hoped-for endpoint; update route handling, auth/scope policy, telemetry operation mapping, OpenAPI/docs/generated clients or playgrounds, and coverage before treating the native surface as real.
- Native app login must be first-class native UI unless the product explicitly requires web SSO. For Sign in with Apple, use the system `SignInWithAppleButton`/`ASAuthorizationAppleIDProvider` flow, generate and verify a nonce, add the entitlement, exchange the identity token with a real backend endpoint, verify Apple's JWKS signature/issuer/audience/expiration/nonce server-side, issue native app tokens, and update API/OpenAPI/docs/tests in the same unit. Do not bounce users to the website for ordinary native sign-in.
- First-party native username/password login is allowed only as a product-owned app bootstrap path with a real authenticated API contract, native UI, rate limiting, no session cookie, no broad browser CORS, no persisted password, generated docs/OpenAPI/playground coverage, and a command-line dogfood verifier. Do not model it as OAuth `grant_type=password`, and do not expose it as a third-party token exchange.
- Native auth clients should require only the core scopes needed for app usability, while accepting first-party token-management scopes as extras when the backend grants them. OAuth-delegated sessions often cannot receive `tokens:read` or `tokens:write`; making those scopes mandatory in native session restoration can break otherwise valid sign-in paths.
- Signed-out login is part of the product experience, not a setup/debug screen. Use the real brand mark, native controls, and human-readable auth states; forbid raw internal strings such as `authRequired:` or framework error dumps such as `ASAuthorizationError Code=1000` from user-facing copy.
- Brand marks and app icons must come from the product's real source asset. Do not wrap a flat logo in fake generated glass/chrome or treat the app icon export as the in-app identity mark; render the mark cleanly, then generate platform icon sizes from that canonical asset.
- Native Sign in with Apple has two separate identities to validate: the Apple JWT audience is the app bundle identifier for each platform, while any product OAuth client ID is an internal Spoonjoy/client identity. Backend config, docs, preflight checks, and tests must explicitly include iOS and macOS bundle-ID audiences instead of assuming one web service/client ID covers native app tokens.

## Offline And Security Boundaries

Offline is native product behavior, not a cache implementation detail. Define it as a contract before building surfaces:

- Every cached record should carry account/environment/schema/freshness/source metadata and a server revision marker when available.
- Separate queueable product writes from online-only security/account actions. Queue domain mutations that can be replayed safely; keep token creation/revocation, OAuth disconnect, logout/session revoke, passkey/password/provider-link flows, permission prompts, and device-token acquisition online-only unless the product has a tested reason otherwise.
- Siri and Shortcuts must use the same queueability policy as in-app UI and must clearly say when an online-only action was not queued.
- Review App Intents against the domain mutation matrix, not just the visible native UI. If a user can add, check, delete, clear, fork, save, or otherwise mutate a queueable surface in-app, the corresponding Siri/Shortcuts path should resolve to the same native queued mutation and REST contract unless the action is semantically false for the product.
- App Intents that clear, revoke, switch, or invalidate account/session state must run private Spotlight/AppEntity/App Shortcut donation purges before credentials disappear, deriving account/environment scope while auth is still available. These purges are not best-effort: failures should propagate or leave credentials intact. Account-scope private-domain purges must delete both indexed entities and donated intent types for every shipped private domain, including account/settings actions.
- Idempotent native/offline replay APIs must be durable after domain side effects commit. Prefer reservation-derived domain IDs for create/fork-style writes, recovery callbacks that can reconstruct committed responses from stored state, and no-side-effect recovery paths before deleting or retrying an in-flight reservation.
- For provider-backed or journaled native/offline writes, committed domain rows outrank blockers and missing journals during recovery. First recover from the reservation-derived domain row and ownership check; then read the tombstone/journal if present; only use no-side-effect blocker recovery when no domain row committed. Missing, null, malformed, or wrong-shaped journals should produce honest nullable fallback metadata, not invented provenance, and wrong-owner reservation-derived rows must remain in-progress or fail safely.
- On storage platforms without a tested interactive transaction boundary, multi-record native/offline mutation helpers need a proven atomic boundary before falling back to compensating rollback. For Prisma on D1, prefer `$transaction([...ops])` batch writes over restore-after-failure code, and test that every domain side effect and delete tombstone enters the same batch. Recovery must match the full requested graph and fields, not only reservation-derived IDs; hard-delete replay must require explicit mutation tombstones tied to the idempotency reservation before treating absence as success.
- Queueable multi-row native/offline mutations need adversarial recovery tests, not only happy replay tests. Include invalid requests against an account with no preexisting container and assert no container/item side effects; duplicate input rows that must coalesce to one exact final changed row; committed-but-incomplete replay from operation tombstones; and partial, malformed, wrong-resource, or missing tombstone journals that remain in-progress instead of falsely recovering. Early-auth or validation failures should still cover telemetry/operation mapping because successful handlers may pass operation metadata explicitly.
- Native/offline create responses that return child entities must remap local optimistic IDs by stable request/response identity fields instead of response array order. Display serializers often sort children differently from create requests. Regression coverage should include a response order that differs from request order and a queued dependent mutation proving the remapped server ID is the one replayed.
- Native/offline surfaces with durable mutation queues must preserve dependency FIFO even while the device is online. If a domain already has queued work, route later writes in that dependency group through the queue instead of issuing fresh remote requests around it. After a remote write succeeds, refresh or bootstrap from server-canonical state before persisting view state; do not let optimistic local IDs overwrite confirmed server IDs.
- Native detail caches that restore parent records must also fold restored child records and child tombstones into the parent snapshot when the visible product surface depends on those children. A parent-only restore can silently regress offline parity for recent activity, cover candidates, comments, or other child-derived detail sections.
- Server idempotency conflict and replay checks must happen before media validation, storage reads, provider calls, and other expensive or side-effecting validation. Reusing a `clientMutationId` with a different body should return the documented idempotency conflict without touching R2, Photos, provider APIs, or staged media.
- Offline indicators may be dismissible for informational stale/offline states only. Queued work, sync failures, conflicts, blockers, and destructive confirmations must remain visible until resolved.
- Shell offline/cache indicators should not appear on signed-out auth unless the login action itself is being fulfilled from a real offline-capable auth state. Users read a generic "offline" chip as Wi-Fi status; keep auth blockers and connectivity/cache status separate, and ensure each route has one clear owner for visible offline UI.
- Feature-owned error states must distinguish transport offline from backend/auth/application failures. Show offline only for true offline transport or offline fallback; map server/auth/schema/search failures to sync-failure or feature error UI, and keep cancellation silent or neutral so stale async work does not alarm users.
- Search, discovery, and mixed-result caches that may include private rows must key by the full visibility boundary: account, environment, query, scope/filter, schema, and freshness/source metadata. On restore, filter private rows against the current authenticated account and capability before rendering or reindexing.
- Domain blockers embedded in otherwise successful API envelopes are not drained successes. Native transports and sync engines must classify provider-secret, auth, conflict, quota, and other HITL blockers before queue deletion, persist the blocker separately from pending retry metadata, and keep the original draft/queued mutation available until the user retries, discards, or a later drain proves completion.
- Pending native imports need separate persisted state for draft content, queued mutation identity, blocker identity/resource, and imported-route destination. Clear each piece only on the event that owns it: successful direct import, verified queued drain, explicit retry, explicit discard, or account/cache purge.
- Media staging needs explicit size/count limits and a no-silent-eviction rule for unsynced user-selected media. Failed or cancelled replacement attempts must preserve the existing staged media and draft metadata; only explicit clear, successful replacement, successful submit, or a resolved conflict policy may evict old unqueued media.
- Spotlight, App Intents, App Shortcuts, and donated entities for private cached data need account/environment-scoped identifiers, purge hooks for logout/account switch/cache deletion/tombstones, stale-index deletion, donation deletion, and private-field filtering. Do not index raw media paths, secrets, provider blockers, hidden conflict/debug metadata, or source text that is not deliberately user-visible.
- Unsigned local dogfood builds may not have the same Keychain/App ID capabilities as signed release builds. Provide an explicit Debug/BootstrapDebug auth-storage strategy, such as a file-backed local vault or a proven unsigned fallback, so first launch can reach signed-out UI and native sign-in can be tested before paid signing is configured. Release builds should still use Keychain or the intended secure storage.
- Local dogfood builds that run under production-shaped server flags still need an explicit trusted-local gate before using dev session secrets, non-secure cookies, or localhost environment labels. Do not key this solely off the request host; require a local base URL, local-only flag, or equivalent runtime signal, and cover `localhost`, `*.localhost`, `127.0.0.1`, and bracketed IPv6 loopback.
- macOS launch smoke for ad-hoc dogfood builds must use a runnable local signature, not a completely unsigned bundle. Keep no-signing structural builds as a separate validation ring, and make BootstrapDebug strip restricted paid-program entitlements while Debug/Release keep the intended entitlement file.
- Unsigned/ad-hoc macOS dogfood builds cannot exercise Sign in with Apple entitlements even if the entitlement file exists in source. Preflight the runtime entitlement before starting `ASAuthorizationController` and show a signed-build-required blocker when absent. Gate macOS-only entitlement probes such as `SecTaskCopyValueForEntitlement` behind `#if os(macOS)` so shared iOS/macOS sources still compile.

## Architecture

Prefer SwiftUI for new multi-platform apps. Add UIKit/AppKit only where platform affordances require it. Keep model/network/storage code testable outside UI targets, usually as Swift packages or framework targets.

Use these boundaries by default:

- App target: navigation, scene configuration, platform integration, entitlements.
- Feature modules: screens, view models, feature-local state.
- Core/domain module: models, parsing, sync policies, API client contracts.
- Persistence module: SwiftData/Core Data/SQLite/file storage as appropriate.
- Test targets: unit tests for core logic, UI/scenario tests for critical flows, snapshot or accessibility checks where stable.

Do not couple feature logic to simulator-only state, global singletons, or unmockable network calls.

## Xcode Project Generation

When generating or editing an Xcode project, treat the project file as generated infrastructure with its own contract tests. Add or reuse a deterministic generator whenever possible, then verify:

- The root project set is exactly what the repo expects, usually one `*.xcodeproj`.
- iOS, macOS, and shared source files have the intended target membership.
- Local Swift package products are attached to each app target and appear in the Frameworks phase.
- Schemes reference the regenerated target UUIDs and are committed when shared.
- Info.plist and entitlements declare native entry points such as URL schemes and Associated Domains.
- Product deployment targets preserve the real product baseline, while bootstrap configurations are clearly named and limited to local/CI capability floors.
- Generated project files do not contain version-pinned SDK framework paths such as `iPhoneOS18.0.sdk` or `MacOSX15.0.sdk`; prefer SDKROOT/current SDK resolution.

If target membership is managed explicitly rather than by file-system-synchronized groups, add a check that fails when new app Swift files are added without target membership. Rerun the generator after app-surface units so the project and scheme stay internally consistent.

## Design Translation

Start from the product's existing design language. Translate it into native components instead of skinning web components.

Use Apple primitives when they carry platform value:

- `NavigationStack`, `NavigationSplitView`, toolbars, sheets, popovers, menus, commands, context menus.
- `List`, `Section`, swipe actions, reorderable collections, search, disclosure, forms, segmented controls.
- Dynamic Type, VoiceOver labels, Reduce Motion, semantic colors, SF Symbols, system materials.
- macOS windowing, keyboard shortcuts, menu commands, sidebars, toolbar placement, and drag/drop.

Avoid decorative card stacks, web-like tab bars on macOS, custom buttons that should be system buttons, one-size-fits-all layouts, and hard-coded text sizes/colors that fight accessibility.

For macOS auth/setup windows, prefer sane default and minimum window sizes plus a stable non-scrolling layout. Do not wrap a normal desktop login surface in a `ScrollView` just to survive tiny remembered windows; use scrollable fallback only for compact/mobile constraints where content genuinely cannot fit.

## TestFlight Feedback And Visual Dogfood

Treat TestFlight screenshot feedback as product telemetry, not as an optional comment. Download and inspect screenshots before changing code; UI breakage, stranded navigation, bad empty/loading states, copy that exposes implementation language, or visually unbalanced native chrome are blocking app bugs even without a crash report.

For TestFlight-driven fixes:

- Reconcile feedback state against real worker liveness. A `running` label is not enough; check active processes, log mtimes, exit codes, and the current command. If a worker is stale, hung, or only created a plan, retry or take over instead of reporting progress as completion.
- Fix from the actual screenshot and metadata. Do not infer the route from a label alone; prove the visible route, app state, and feedback instance match the code path under repair.
- Keep mobile navigation escapable. Compact iPhone toolbars, docks, tab bars, and Liquid Glass overlays must expose an obvious route back to the app's home/root surface and must not strand users inside shopping, cook mode, capture, search, settings, or detail flows.
- Prefer native controls and system-adjacent placement before building custom chrome. If custom chrome ships, add source-contract and screenshot tests for layout bounds, tappable actions, Dynamic Type, safe-area behavior, and overlap with content.
- Preserve the product palette and image policy. Source native colors from the product design language or web tokens and enforce drift with CI/source-contract checks. Do not show fake/default food photos as real content; distinguish real media from generated placeholders and render an honest no-photo or capture state unless a real appetizing image exists.
- Make loading, empty, offline, error, and permission states first-class screens. Screenshot captures should prove these states are calm, branded, non-overlapping, and actionable.
- Do not close a feedback item from tests alone. Run focused tests, app-target build validation, screenshot-backed visual QA for the reported route, and TestFlight publish/attachment verification when the fix is intended for testers. Notify the user or helper agent only after the new build is actually available or after a concrete human-only blocker is proven.

## Implementation Loop

Work in small PRs that leave the app runnable after each merge:

1. Bootstrap project, package structure, CI, and repo rules.
2. Add product/design/native-justification docs.
3. Create the shell: app entry, navigation, empty states, shared theme tokens.
4. Add auth/session and API client against real backend contracts.
5. Build core offline/read paths before mutation-heavy flows.
6. Add native integrations one at a time with tests and a visible product reason.
7. Keep a scenario verifier script that proves the critical flows from the command line.
8. Dogfood locally on simulator and macOS app before broadening distribution.

Use sub-agents for parallel implementation only with disjoint write scopes. Always use a harsh reviewer sub-agent before merging.

When using strict TDD, require a distinct implementation-green artifact for every implementation unit: the unit must rerun the exact red suite/contract after implementation and before any broader coverage/refactor step. Red logs plus later coverage are not enough to prove the TDD sequence happened.

For App Intents, App Entity, Spotlight, and SwiftUI shell changes, source-contract tests should be body-scoped to the exact intent/view/helper that owns the behavior. File-level token checks are too weak for privacy/order guarantees; assert ordering such as purge-before-clear, specific callback signatures on the inner view that compiles in the app target, and domain-to-intent donation mappings inside the function that performs deletion.

## Validation

Do not declare completion from compilation alone. A credible native validation set includes:

- `swift test` or Xcode test plan for pure logic.
- `xcodebuild build` for each app target and destination.
- Simulator launch/smoke for iOS and iPadOS when applicable.
- macOS app launch/smoke when applicable.
- Accessibility pass for Dynamic Type, VoiceOver names, contrast, keyboard navigation, and Reduce Motion.
- Scenario verifier script for core user workflows.
- Branch protection with required checks matching workflow job names.

Paid-program distribution is a separate gate. TestFlight/App Store upload requires Apple Developer Program membership and App Store Connect access; until that exists, validate through local simulator, local macOS app, and any free-account device testing available through Xcode.

Treat app-target builds as a distinct validation ring from Swift package tests. SwiftPM tests may compile shared core and source-contract tests without compiling SwiftUI app-target files, AppIntents macro expansion, target membership, or app-only availability/sendability diagnostics. After any edit under an app target or generated Xcode project membership, run or wait for an `xcodebuild`/CI app-bundle job before claiming compile validation; package tests are supplemental evidence only.

Validation artifact contracts should be explicit and stale-proof:

- Create artifact subdirectories before any command writes logs.
- Make every matrix command fail-fast with `set -euo pipefail`; when using `tee`, preserve producer exit status.
- When a doing doc or validation matrix declares artifact names authoritative, write command output to those exact paths. Extra summary, alias, or focused-suite logs may supplement the matrix, but they never replace required matrix artifacts.
- When a native API endpoint graduates from placeholder/known-path failure to a real authenticated route, update the surrounding shell/method, auth/telemetry, parser/helper, docs, and generated-client drift coverage in the same coverage/refactor pass. Route-level green tests alone do not prove the old placeholder contract was retired everywhere.
- After backend schema changes that native dogfood depends on, regenerate Prisma or the repo's typed data client, clear stale SSR/Vite/build caches when they can hold the old schema, and restart the local dev server before using live dogfood evidence. A green route test does not prove the already-running dogfood server has loaded the new generated client.
- If the full local web/dev server hangs or adds framework noise before reaching the native API path, build a small local dogfood harness around the same production API dispatcher instead of inventing a mock. The harness should use a disposable database, explicit local environment flags, bounded startup readiness, and the same auth/sync helpers the app will call.
- First-party native auth dogfood verifiers should be required final-matrix rows, not optional side logs. They must exercise the native executable or app client against a production-shaped local API contract, assert token shape/scope/sync state, include at least one negative credential/provider assertion against the same real route, redact reports, and delete file-backed vault/session artifacts before review. Do not satisfy this with a toy local fixture that hardcodes app tokens; if a helper server is needed, it should call the production route dispatcher over a disposable database.
- Native dogfood harnesses that spawn app clients, SwiftPM products, package managers, local API servers, or simulators need source-owned timeouts and recursive process-tree cleanup. A green report is not enough if the verifier can leave orphaned `swift run`, server, or app processes behind after success, failure, or interruption.
- Native dogfood harnesses should pass passwords and other one-run secrets through temp files or stdin-like channels, not child-process environment variables or command arguments. If an env fallback exists for compatibility, wrapper scripts should write it to a `0600` temp file, export only the file path to long-lived children, then `unset` the raw secret before launching Swift, app, server, or simulator clients.
- Bash `EXIT` traps used by verifier wrappers must explicitly return success after best-effort cleanup. A trap whose final `[[ -n "$optional_dir" ]]` test returns false can turn a successful app run into exit 1, leaving vault artifacts behind and confusing release review.
- If an old dogfood client is already stuck in macOS `UE` state with parent `1`, signals may not clear it until the kernel wait returns or the host restarts. Record that as host process hygiene evidence, but still harden source defaults so new verifier runs use bounded timeouts, recursive cleanup, password-file handoff, redacted artifacts, and no additional orphaned clients.
- Provider/runtime bindings used by auth, rate limiting, or native sync should have bounded timeout/fail-open or fail-closed behavior documented by tests. Local dogfood can otherwise hang before reaching the native app, and the fix belongs in the source default rather than in a one-off command override.
- For native API coverage/refactor units, prove every integration ring that a native client depends on: parser/helper branches, route wrappers, idempotency recovery callbacks, telemetry operation derivation, OpenAPI/docs drift, generated playground/client helpers, and final blocker/artifact producers. A green endpoint suite can still miss telemetry switch branches or developer-tool multipart helpers.
- When generated playgrounds, SDK fixtures, or developer-tool manifests derive request bodies from OpenAPI, support every content type the API emits. Multipart endpoints must remain visible in generated metadata, generate real `FormData` or `curl --form` requests without manually setting the browser boundary header, and have regression coverage for both generator output and runnable request helpers.
- For endpoint families graduating out of placeholder contracts, add a focused generated-contract scan over only the changed operations and fail if that slice still references placeholder request schemas, placeholder success envelopes, or placeholder example text. Broad OpenAPI/docs/playground suites can pass while one newly implemented family still leaks a generic contract into native clients.
- When native parity splits one web form/workflow into finer REST operations, carry over the aggregate web invariants into the granular helper too. A subresource endpoint that clears, replaces, or partially edits related state still needs tests for the original valid/invalid product states, including both the rejecting edge and the nearest allowed case.
- Media-bearing native/offline endpoint families need parity tests for the downstream product payload as much as for the mutation transport. For cook logs, photos, covers, shares, and similar surfaces, prove deleted/foreign/private record filtering, owner-owned media validation, multipart and JSON parser edge cases, idempotency body normalization, and the list/detail fields that Siri, Spotlight, share sheets, widgets, and offline caches will consume.
- Media draft UI tests must distinguish rejection from eviction. Add coverage or source-contract checks proving unsupported, oversized, quota-blocked, and cancelled replacement attempts keep the previous staged file alive, while an explicit clear path and a successful replacement path persist the intentional deletion.
- Detail screens backed by paginated child endpoints must drain pages or expose honest pagination state. Add tests for multi-page child lists, missing/repeated cursor guards, tombstoned child filtering, and UI refresh when a snapshot-derived view model changes under an existing `@State` editing/draft shell.
- Native multipart request builders must reject CR/LF, quote, empty, and control characters in file names, content types, and field names before request construction. Generate per-request collision-resistant boundaries, parse emitted multipart bodies from the `Content-Type` boundary in tests, and assert file bytes live inside the named file part with no extra parts.
- Native transport coverage must preserve recoverable typed error paths. Do not satisfy 100% coverage by replacing invalid URL/configuration handling with force unwraps or crashes; instead test the typed error and prove no session/network call occurred.
- URL request builders that consume already-encoded API request paths should use `percentEncodedPath`, validate API base URLs as real HTTP(S) hosts, and test slash, space, and Unicode identifiers so path joining cannot silently double-encode.
- Native retry/error transport tests should cover HTTP status vs envelope mismatches, non-JSON or malformed 401 refresh-and-replay, `Retry-After` precedence and HTTP-date parsing, non-HTTP responses, offline vs generic network failures, and direct cancellation errors as distinct from URL cancellation.
- Run DB-mutating validation suites serially when they share a local database, or give each command an isolated database path. Do not parallelize focused suites or coverage jobs that call shared cleanup/auth/test-state helpers unless isolation is proven.
- Do not run concurrent coverage jobs that share one coverage output directory. Istanbul/Vitest targeted runs can corrupt or remove each other's `coverage/.tmp` files; run coverage serially or configure isolated coverage directories.
- Cross-repo native/backend contract work needs evidence from both sides in the same review bundle: focused native tests, backend route/auth/OpenAPI/generated-client tests, full backend coverage when the repo requires it, native app builds, and a warning scan over only final green artifacts. Remove stale failed logs or clearly mark them as red-phase evidence so they do not masquerade as final validation.
- Warning scans must exclude their own prior warning-scan output and remove stale output before reruns.
- Warning scans should match diagnostic shapes, not plain domain words. Avoid broad `warning|error|fail` scans that false-positive on test titles, generated asset names, route names, schema enum values, or expected error-code documentation.
- If a build tool emits a known benign diagnostic outside its configurable logger hook, fix it at a tested command-wrapper boundary that preserves the real command, streams output, and propagates exit codes. Do not weaken validation scans or hide arbitrary warning/error output.
- Screenshot/design review success and blocker artifacts must be mutually exclusive; runtime screenshot blockers need a companion design-review-blocked artifact so design validation can distinguish blocked capture from design success.
- Screenshot harnesses must prove the captured pixels are the foreground app on the expected route, not only that install/launch/deep-link commands returned 0. For iOS, prefer seeding route app-state into the simulator app container, launching the bundle id on an explicit simulator UDID, waiting for foreground-app evidence, and then rejecting SpringBoard, URL confirmation prompts, or wrong-route screenshots with pixel/content checks.
- iOS app targets need explicit launch-screen metadata or a real launch storyboard before trusting simulator screenshots. Without it, the simulator can install and launch successfully but render the app in a compatibility-sized letterboxed viewport. Add a launch-screen plist/storyboard contract, uninstall stale simulator builds before fresh install when launch metadata changes, and make pixel gates reject black compatibility bars instead of accepting "some app content exists."
- Auth dogfood screenshots must prove the unauthenticated route, not only that an app shell appears. Clear or isolate simulator/app auth state, account cache, and Debug auth vaults; then assert the native sign-in control is visible. If the app shows a generic shell or sync-failure state on first launch, treat that as an auth/bootstrap bug, not a successful launch smoke.
- Route-specific screenshot harnesses must seed and validate the app's real restorable route identifier or navigation state, not only the human-facing route label. If a route such as Search can be opened with an empty query, test and capture the blank route as a first-class deep link (`/search`, `spoonjoy://search`) instead of using a query-bearing URL as a surrogate for the native surface.
- Do not trust `design-review.json` alone for route proof. Visually inspect the saved screenshots or add route-specific OCR/pixel/content assertions; a stale screenshot can otherwise pass while the JSON claims the intended route.
- Route-specific offline/status UI needs a single owner per visible route. If a feature screen renders its own offline indicator, the shell indicator and safe-area reserve must be suppressed by the same visibility predicate so screenshots and real users do not get overlapping or duplicated status surfaces.
- Signed-out/offline screenshot app-state seeds must include account, environment, and route identity. Missing account/environment keys can make cache restore fabricate false empty product state or capture a different surface than the route under review.
- macOS screen or window capture may be blocked by TCC even when the app launched. When that happens, produce a capture blocker artifact and use secondary launch evidence such as route proof, LaunchServices success, CoreGraphics window ownership, app logs, and cache writes; do not claim visual design validation from a black or inaccessible screenshot.
- Swift coverage counts injected closure bodies and default branches even when they are test helpers. Do not leave dead injected clocks or probes in production planners; route them through asserted behavior or use a default clock path that is covered by the validation unit.
- Generated DerivedData, simulator container backups, auth vault backups, and intermediate retry logs are not validation artifacts. Remove them before review/commit; keep only the official matrix logs, screenshots, redacted JSON summaries, and canonical blocker artifacts. Never leave access tokens, refresh tokens, passwords, provider secrets, or debug auth-session files in artifact directories.
- Keep blocker paths canonical by capability instead of forcing every blocker into one directory. Native runtime and App Intents blockers can live under the native artifact directory, while cross-repo/provider/human/production blockers may need root or web artifact paths.
- For every blocker capability, name its producer and consumer phases. Do not let a later release/production blocker satisfy an earlier local validation gate unless that earlier gate explicitly owns the capability.
- If a full validation suite removes blocker artifacts during per-test setup or cleanup, add a dedicated artifact-producer command after the suite is green. Response assertions prove behavior, but downstream phases that consume a blocker file need the file to exist at the canonical path in the final artifact set.
- Final validation should rerun current App Intents/App Entity contract checks for every shipped domain; stale unit-level App Intents logs do not prove final readiness.
- Final validation matrices should distinguish "the matrix runner worked and only canonical blockers remain" from "the app is fully validated." Include fields such as `ok`, `fullyValidated`, `result`, pass/fail/blocked counts, and a canonical-blocker count so a local Xcode/simulator/screenshot blocker cannot be mistaken for successful app launch or screenshot validation. `fullyValidated` must be false whenever any canonical blocker artifact exists, even if the producing command exits 0 and records a pass row.
- Validation artifact audits must derive relative paths from the selected artifact root. Do not hardcode one task slug in blocker `path`/`outputPath` normalization; rerunning a matrix in another task root should not turn canonical blockers into false "outside root" failures.
- Source-contract checks for screenshot/design tooling should not require runtime screenshot artifacts before the capture step runs. Treat "no design-review artifact exists yet" as neutral in pre-capture source checks, then let the capture/design-review validation rows require exactly one of success or blocker artifacts after the runtime attempt.
- URL-scheme and Universal Link validation must prove both declaration and routing. Check `Info.plist`/entitlements for the entry point, app router parsing for every supported route/action, stale or malformed URL rejection, and the resulting navigation/state mutation. Do not count a registered scheme as complete if it only opens the app shell.

## Xcode Health And Blockers

Before treating `xcodebuild` failures as app bugs, classify where they fail:

- If even `xcodebuild -list -project <App>.xcodeproj` fails before project parsing, inspect local Xcode health first.
- Run bounded probes such as `xcodebuild -version`, `xcodebuild -checkFirstLaunchStatus`, `xcode-select -p`, and a short `xcodebuild -list`.
- If first-launch work is pending, try the non-privileged repair path only if it is safe and bounded. Privileged repair, Xcode reinstall/update, Apple Developer Program enrollment, and account signing setup are human/capability gates.
- If Xcode cannot load required plug-ins or private frameworks before project parsing, record a blocker artifact with the exact command, exit code, log path, Xcode version/build, developer directory, attempted repairs, and required human resolution.
- If a promised platform build is blocked by a missing local runtime or SDK, write a capability-specific blocker artifact and keep structural/project checks as fallback evidence only. Missing iOS simulator platforms, unavailable visionOS runtimes, or unsigned device-only destinations are validation blockers, not passing substitutes.

Do not mark app-bundle validation complete when `xcodebuild` is blocked locally. Strengthen structural project checks and direct `swiftc -typecheck` probes where useful, but label them as fallback evidence; they do not replace required iOS/macOS app builds, simulator launch, or macOS launch validation.

## Completion Bar

Before calling native Apple app work done:

- The repo is protected and reproducible from a clean clone.
- The app builds and launches on every promised platform.
- Core workflows are implemented, not mocked.
- Native-only value is visible in product behavior.
- Tests and scenario verification are green.
- Reviewer sub-agents have approved the implementation.
- Any remaining paid-account actions are documented as blocked by account state, not deferred engineering work.

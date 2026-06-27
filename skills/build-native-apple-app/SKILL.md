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

## Offline And Security Boundaries

Offline is native product behavior, not a cache implementation detail. Define it as a contract before building surfaces:

- Every cached record should carry account/environment/schema/freshness/source metadata and a server revision marker when available.
- Separate queueable product writes from online-only security/account actions. Queue domain mutations that can be replayed safely; keep token creation/revocation, OAuth disconnect, logout/session revoke, passkey/password/provider-link flows, permission prompts, and device-token acquisition online-only unless the product has a tested reason otherwise.
- Siri and Shortcuts must use the same queueability policy as in-app UI and must clearly say when an online-only action was not queued.
- Review App Intents against the domain mutation matrix, not just the visible native UI. If a user can add, check, delete, clear, fork, save, or otherwise mutate a queueable surface in-app, the corresponding Siri/Shortcuts path should resolve to the same native queued mutation and REST contract unless the action is semantically false for the product.
- Idempotent native/offline replay APIs must be durable after domain side effects commit. Prefer reservation-derived domain IDs for create/fork-style writes, recovery callbacks that can reconstruct committed responses from stored state, and no-side-effect recovery paths before deleting or retrying an in-flight reservation.
- For provider-backed or journaled native/offline writes, committed domain rows outrank blockers and missing journals during recovery. First recover from the reservation-derived domain row and ownership check; then read the tombstone/journal if present; only use no-side-effect blocker recovery when no domain row committed. Missing, null, malformed, or wrong-shaped journals should produce honest nullable fallback metadata, not invented provenance, and wrong-owner reservation-derived rows must remain in-progress or fail safely.
- On storage platforms without a tested interactive transaction boundary, multi-record native/offline mutation helpers need a proven atomic boundary before falling back to compensating rollback. For Prisma on D1, prefer `$transaction([...ops])` batch writes over restore-after-failure code, and test that every domain side effect and delete tombstone enters the same batch. Recovery must match the full requested graph and fields, not only reservation-derived IDs; hard-delete replay must require explicit mutation tombstones tied to the idempotency reservation before treating absence as success.
- Queueable multi-row native/offline mutations need adversarial recovery tests, not only happy replay tests. Include invalid requests against an account with no preexisting container and assert no container/item side effects; duplicate input rows that must coalesce to one exact final changed row; committed-but-incomplete replay from operation tombstones; and partial, malformed, wrong-resource, or missing tombstone journals that remain in-progress instead of falsely recovering. Early-auth or validation failures should still cover telemetry/operation mapping because successful handlers may pass operation metadata explicitly.
- Native/offline create responses that return child entities must remap local optimistic IDs by stable request/response identity fields instead of response array order. Display serializers often sort children differently from create requests. Regression coverage should include a response order that differs from request order and a queued dependent mutation proving the remapped server ID is the one replayed.
- Native/offline surfaces with durable mutation queues must preserve dependency FIFO even while the device is online. If a domain already has queued work, route later writes in that dependency group through the queue instead of issuing fresh remote requests around it. After a remote write succeeds, refresh or bootstrap from server-canonical state before persisting view state; do not let optimistic local IDs overwrite confirmed server IDs.
- Native detail caches that restore parent records must also fold restored child records and child tombstones into the parent snapshot when the visible product surface depends on those children. A parent-only restore can silently regress offline parity for recent activity, cover candidates, comments, or other child-derived detail sections.
- Server idempotency conflict and replay checks must happen before media validation, storage reads, provider calls, and other expensive or side-effecting validation. Reusing a `clientMutationId` with a different body should return the documented idempotency conflict without touching R2, Photos, provider APIs, or staged media.
- Offline indicators may be dismissible for informational stale/offline states only. Queued work, sync failures, conflicts, blockers, and destructive confirmations must remain visible until resolved.
- Media staging needs explicit size/count limits and a no-silent-eviction rule for unsynced user-selected media. Failed or cancelled replacement attempts must preserve the existing staged media and draft metadata; only explicit clear, successful replacement, successful submit, or a resolved conflict policy may evict old unqueued media.
- Spotlight, App Intents, App Shortcuts, and donated entities for private cached data need account/environment-scoped identifiers, purge hooks for logout/account switch/cache deletion/tombstones, stale-index deletion, and private-field filtering. Do not index raw media paths, secrets, provider blockers, hidden conflict/debug metadata, or source text that is not deliberately user-visible.

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

Validation artifact contracts should be explicit and stale-proof:

- Create artifact subdirectories before any command writes logs.
- Make every matrix command fail-fast with `set -euo pipefail`; when using `tee`, preserve producer exit status.
- When a doing doc or validation matrix declares artifact names authoritative, write command output to those exact paths. Extra summary, alias, or focused-suite logs may supplement the matrix, but they never replace required matrix artifacts.
- When a native API endpoint graduates from placeholder/known-path failure to a real authenticated route, update the surrounding shell/method, auth/telemetry, parser/helper, docs, and generated-client drift coverage in the same coverage/refactor pass. Route-level green tests alone do not prove the old placeholder contract was retired everywhere.
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
- Warning scans must exclude their own prior warning-scan output and remove stale output before reruns.
- Warning scans should match diagnostic shapes, not plain domain words. Avoid broad `warning|error|fail` scans that false-positive on test titles, generated asset names, route names, schema enum values, or expected error-code documentation.
- If a build tool emits a known benign diagnostic outside its configurable logger hook, fix it at a tested command-wrapper boundary that preserves the real command, streams output, and propagates exit codes. Do not weaken validation scans or hide arbitrary warning/error output.
- Screenshot/design review success and blocker artifacts must be mutually exclusive; runtime screenshot blockers need a companion design-review-blocked artifact so design validation can distinguish blocked capture from design success.
- Keep blocker paths canonical by capability instead of forcing every blocker into one directory. Native runtime and App Intents blockers can live under the native artifact directory, while cross-repo/provider/human/production blockers may need root or web artifact paths.
- For every blocker capability, name its producer and consumer phases. Do not let a later release/production blocker satisfy an earlier local validation gate unless that earlier gate explicitly owns the capability.
- If a full validation suite removes blocker artifacts during per-test setup or cleanup, add a dedicated artifact-producer command after the suite is green. Response assertions prove behavior, but downstream phases that consume a blocker file need the file to exist at the canonical path in the final artifact set.
- Final validation should rerun current App Intents/App Entity contract checks for every shipped domain; stale unit-level App Intents logs do not prove final readiness.

## Xcode Health And Blockers

Before treating `xcodebuild` failures as app bugs, classify where they fail:

- If even `xcodebuild -list -project <App>.xcodeproj` fails before project parsing, inspect local Xcode health first.
- Run bounded probes such as `xcodebuild -version`, `xcodebuild -checkFirstLaunchStatus`, `xcode-select -p`, and a short `xcodebuild -list`.
- If first-launch work is pending, try the non-privileged repair path only if it is safe and bounded. Privileged repair, Xcode reinstall/update, Apple Developer Program enrollment, and account signing setup are human/capability gates.
- If Xcode cannot load required plug-ins or private frameworks before project parsing, record a blocker artifact with the exact command, exit code, log path, Xcode version/build, developer directory, attempted repairs, and required human resolution.

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

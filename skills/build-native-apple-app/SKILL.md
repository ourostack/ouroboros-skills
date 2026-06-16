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
2. Confirm target platforms and minimum OS versions. If unknown, choose the newest stable/beta target that matches the task and document why.
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

## Architecture

Prefer SwiftUI for new multi-platform apps. Add UIKit/AppKit only where platform affordances require it. Keep model/network/storage code testable outside UI targets, usually as Swift packages or framework targets.

Use these boundaries by default:

- App target: navigation, scene configuration, platform integration, entitlements.
- Feature modules: screens, view models, feature-local state.
- Core/domain module: models, parsing, sync policies, API client contracts.
- Persistence module: SwiftData/Core Data/SQLite/file storage as appropriate.
- Test targets: unit tests for core logic, UI/scenario tests for critical flows, snapshot or accessibility checks where stable.

Do not couple feature logic to simulator-only state, global singletons, or unmockable network calls.

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

## Completion Bar

Before calling native Apple app work done:

- The repo is protected and reproducible from a clean clone.
- The app builds and launches on every promised platform.
- Core workflows are implemented, not mocked.
- Native-only value is visible in product behavior.
- Tests and scenario verification are green.
- Reviewer sub-agents have approved the implementation.
- Any remaining paid-account actions are documented as blocked by account state, not deferred engineering work.

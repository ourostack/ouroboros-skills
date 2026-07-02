---
name: mac-app-distribution
description: Plan, build, validate, and operate macOS app distribution across direct download, DMG, update manifests, hosted download pages, Sparkle-style or custom update feeds, TestFlight, and Mac App Store submission. Use when shipping a Mac app to real users, building a download site, deciding between Developer ID and App Store channels, or making reusable release/distribution tooling for any macOS app.
---

# Mac App Distribution

Use this with `build-native-apple-app` and `sign-apple-apps`. This skill owns the product/release/distribution shape: what users download, where they download it, how updates work, what metadata and privacy answers are needed, and how direct-download and App Store lanes coexist.

## Human Boundary

Stop for the operator only for:

- Apple Developer enrollment, renewal, legal/account agreements, payment, identity verification, CAPTCHA, 2FA, or support contact.
- App Store Connect legal/privacy/export-compliance attestations when the repo cannot prove the answer.
- Product identity choices the operator has not delegated: public app name, subtitle, category, price, age rating, support URL, screenshots, and launch copy.
- DNS or hosting account changes when no authenticated CLI/API path is available.
- Destructive production changes that cannot be staged or rolled back.

When the operator delegates judgement, choose conservative defaults and keep going. Never ask the operator to switch branches or manage worktrees.

## Distribution Model

Treat each channel as a separate contract:

- **Developer ID direct download:** signed and notarized `.app`, usually shipped as a DMG for humans and a zip/archive for auto-updaters.
- **In-app updater:** stable machine-readable manifest/feed with HTTPS asset URLs, SHA-256, byte count, version/build, bundle identifier, signature/notarization state, and compatibility metadata.
- **Hosted download page:** human-facing page with the app name, one primary download action, version, release date, requirements, checksum link, install instructions, privacy/support links, and a fallback to release assets.
- **Mac App Store:** sandboxed store artifact, App Store Connect app record, privacy/export/compliance answers, screenshots, app review notes, and store-owned update behavior.
- **TestFlight:** beta lane for App Store-signed builds when the app benefits from external beta feedback before review.

Do not mix responsibilities. A direct-download app may check GitHub/R2/S3 for updates. A Mac App Store build should let the store own updates and should hide or disable direct-update UI unless the product has an explicit approved reason.

## Recommended Artifact Shape

For macOS direct downloads, publish:

- `App-<version>.dmg` for users.
- `App-<version>.zip` for in-app updates if the updater expects zip extraction.
- `App-<version>.manifest.json` or equivalent feed metadata.

The manifest should preserve existing updater-compatible fields while adding richer download metadata:

```json
{
  "appName": "Example",
  "bundleIdentifier": "com.example.app",
  "version": "1.2.3",
  "build": "123",
  "gitSha": "abc123",
  "signingMode": "developer-id",
  "notarized": true,
  "archive": "Example-1.2.3.zip",
  "sha256": "zip-sha",
  "bytes": 123,
  "downloads": {
    "zip": {
      "name": "Example-1.2.3.zip",
      "sha256": "zip-sha",
      "bytes": 123,
      "role": "auto-update"
    },
    "dmg": {
      "name": "Example-1.2.3.dmg",
      "sha256": "dmg-sha",
      "bytes": 456,
      "role": "interactive-install"
    }
  }
}
```

If an older app already consumes top-level `archive`/`sha256`/`bytes`, keep those fields stable until all supported versions can read the new feed.

## Direct Download Checklist

1. Build a clean release `.app`.
2. Sign with Developer ID Application, hardened runtime, and timestamp.
3. Notarize the app or final container; staple and validate.
4. Create a drag-to-Applications DMG from the signed/stapled app.
5. Create the updater archive after signing/stapling.
6. Write the manifest/feed and verify every digest/byte count.
7. Publish release assets atomically enough that users cannot fetch a manifest whose referenced artifacts are missing.
8. Verify from the public URL, not only the local repo copy.
9. Install into a temporary directory from the public path and verify bundle id, version, signature, and launch/update behavior.
10. Keep the hosted download page and one-line installer pointed at the same version.

## Hosted Download Page

Prefer a small static site or static app route over a repo README as the primary user surface. It should include:

- The product name as the first-viewport signal.
- One obvious primary macOS download button.
- Plain install copy: open DMG, drag app to Applications, launch.
- Current version, release date, macOS minimum, architecture/support notes, and checksum link.
- Privacy, support, release notes, and source/release fallback links.
- A machine-readable JSON endpoint for agents/installers when useful.

If the binary is still hosted on GitHub Releases, say so or make the site redirect cleanly. For full self-hosting, mirror release assets to R2/S3/object storage and keep digest verification in the manifest.

## App Store Checklist

Before upload:

- App Store Connect app record exists.
- Bundle ID matches the packaged app.
- App category/subtitle/price/support URL are chosen.
- Privacy answers match runtime behavior, including analytics/diagnostics telemetry if present.
- Export-compliance answer is supported by code inspection.
- Store build uses an App Store distribution channel or equivalent flag.
- Store build hides direct-update checks when the store owns updates.
- Store build is sandboxed and has only necessary entitlements.
- Store package is signed with the correct Apple Distribution / Mac App Store installer identities.
- Screenshots are current and pass visual QA.

After upload:

- Validate or upload with Xcode, Transporter, `xcrun altool`, or the App Store Connect API.
- Wait for processing.
- Confirm the build appears under the app record.
- Attach metadata/screenshots, complete privacy/export/compliance, add review notes, and submit for review.
- Record any review blockers in the owning task/backlog.

## Privacy And Telemetry

Do not guess privacy answers. Inspect code and release scripts.

Common conservative mapping:

- Content-free product analytics means App Store privacy should disclose analytics/diagnostics data as appropriate.
- No document contents, file names, folder paths, clipboard, or raw errors should be sent unless the privacy disclosure explicitly says so.
- Telemetry-off store builds can answer less, but only if the package script proves telemetry is disabled.
- Direct-download privacy docs and App Store privacy answers should not contradict each other unless the builds genuinely differ.

## Validation

Before claiming completion:

- Run repo tests relevant to release/update/install behavior.
- Run package/readiness selftests.
- Build direct-download artifacts and verify the manifest locally.
- Verify public release assets once published.
- Smoke install from the hosted download route or one-line installer.
- Build the App Store distribution mode and inspect `Info.plist` / entitlements.
- Validate or upload the App Store package if credentials and app record are available.
- Use a fresh reviewer gate for the final channel split: no direct-updater leakage into App Store, no stale privacy copy, no missing hosted-download fallback.

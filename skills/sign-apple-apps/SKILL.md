---
name: sign-apple-apps
description: Set up Developer ID signing, notarization, stapling, and release-channel checks for native Apple apps. Use when a user asks to sign, notarize, distribute, renew Apple Developer membership, configure notarytool credentials, create Developer ID certificates, unblock Gatekeeper warnings, or support direct-download macOS releases alongside future App Store/TestFlight channels.
---

# Sign Apple Apps

Use this with `build-native-apple-app` for distribution work. This skill owns the signing/notarization/release-credential lane; app architecture, UI, and native product validation still belong to the native-app skill.

## Human Boundary

Stop for the operator for:

- Apple Developer Program enrollment, renewal, payment, identity verification, Apple ID password, 2FA, CAPTCHA, or support contact.
- Creating/downloading certificates or API keys if the Apple portal requires private account prompts.
- Saving secrets into GitHub, Keychain, App Store Connect, or another external account unless the operator explicitly authorized that exact destination.

Do not ask the operator to switch branches or manage worktrees. Do that yourself.

## First Checks

1. Confirm the account state in [developer.apple.com/account](https://developer.apple.com/account):
   - Team ID.
   - Program: Apple Developer Program.
   - Enrolled as Individual or Organization.
   - Membership active, expired, or processing.
2. If renewal was just purchased, expect a propagation gap. Apple may show an order confirmation while Certificates, Identifiers & Profiles still says the team is ineligible. Poll the certificate portal instead of assuming the renewal failed.
3. Check certificate access at `https://developer.apple.com/account/resources/certificates/list`.
4. Record Team ID and blockers durably in the task card, never in source code.

## Preferred Direct-Download Path

For macOS direct-download releases:

1. Build the app bundle normally.
2. Developer ID sign the final `.app` with hardened runtime and timestamp:
   ```bash
   codesign --force --deep --options runtime --timestamp --sign "$OURO_CODESIGN_IDENTITY" "App.app"
   codesign --verify --deep --strict --verbose=2 "App.app"
   ```
3. Zip the signed app for notarization upload:
   ```bash
   ditto -c -k --keepParent "App.app" "App-notary.zip"
   ```
4. Submit and wait:
   ```bash
   xcrun notarytool submit "App-notary.zip" --keychain-profile "$OURO_NOTARY_PROFILE" --wait
   ```
5. Staple and verify:
   ```bash
   xcrun stapler staple "App.app"
   xcrun stapler validate "App.app"
   spctl --assess --type execute --verbose=2 "App.app"
   ```
6. Create the public release archive only after stapling.

For installer packages, use a Developer ID Installer certificate for the package, but still sign the app payload with Developer ID Application.

## Credential Modes

Support these notary authentication modes, in this order:

1. `OURO_NOTARY_PROFILE`: a local Keychain profile created with `xcrun notarytool store-credentials`.
2. App Store Connect API key:
   - `APP_STORE_CONNECT_API_KEY_ID`
   - `APP_STORE_CONNECT_API_ISSUER_ID`
   - `APP_STORE_CONNECT_API_KEY_PATH`
3. Apple ID app-specific password:
   - `APPLE_ID`
   - `APPLE_TEAM_ID`
   - `APPLE_APP_SPECIFIC_PASSWORD`

Use `OURO_CODESIGN_IDENTITY` or `DEVELOPER_ID_APPLICATION` for the Developer ID Application identity. Prefer `APPLE_TEAM_ID` or `OURO_APPLE_TEAM_ID` for Team ID. Never commit private keys, `.p12` files, API keys, app-specific passwords, or raw notary credentials.

## Developer ID Certificate Creation

When creating a Developer ID Application certificate:

1. Generate the CSR/private key locally in a locked-down directory.
2. In Apple Certificates, choose `Developer ID Application`.
3. When Apple asks for the Developer ID certificate intermediary, choose `G2 Sub-CA (Xcode 11.4.1 or later)` unless the operator explicitly needs old Xcode compatibility.
4. Upload only the `.csr` file to Apple.
5. Download the issued `.cer`, combine it with the matching local private key, and import the identity into Keychain or export a password-protected `.p12` for CI secrets.

Some browser automation surfaces cannot attach files to Apple’s CSR upload input. Before declaring the account blocked, try a browser/control surface with first-class file upload support. If that is unavailable, stop with an exact one-click handoff:

- URL/page: Apple Developer certificate CSR upload step.
- Selected options: `Developer ID Application`, `G2 Sub-CA`.
- CSR path for the operator to choose.
- Expected next step after upload: click Continue/Create, download the resulting `.cer`, then resume local import/notarization setup.

Do not ask the operator to regenerate the CSR unless the upload validation rejects the file.

## Repo Contract

For each app repo, add or reuse:

- `scripts/check-signing-readiness.sh`: non-secret by default; validates tools (`codesign`, `xcrun notarytool`, `xcrun stapler`) and fails closed only when `OURO_REQUIRE_NOTARIZATION=1` or live credential validation is requested.
- `scripts/prepare-ci-signing-assets.sh`: no-op by default; when signing is explicitly required on GitHub-hosted macOS, imports a base64 `.p12` Developer ID certificate into a temporary keychain, writes a base64 App Store Connect `.p8` key to a temporary file, and appends paths/derived env to `$GITHUB_ENV`.
- `scripts/sign-notarize-app.sh`: signs, submits, staples, and verifies one `.app`; includes a `--selftest` that needs no Apple credentials.
- Release packaging support for `OURO_RELEASE_SIGNING_MODE=developer-id` and `OURO_REQUIRE_NOTARIZATION=1`.
- Manifest fields:
  - `"signingMode": "ad-hoc"` or `"developer-id"`
  - `"notarized": true` or `false`
- Verification that `developer-id` artifacts must have `"notarized": true`.
- CI/preflight selftests for the readiness and signing scripts that do not require secrets.

Default CI should remain safe without Apple credentials. Real release signing should activate only through explicit release env/secrets, not through incidental local state.

## GitHub Actions Notes

GitHub-hosted macOS runners do not have the operator's Keychain certificates. If CI should produce Developer ID releases, import certificates into a temporary keychain from GitHub secrets before packaging, then delete the keychain after the job. Keep dry-run and PR checks non-secret.

Use explicit env names in release workflows:

- `OURO_RELEASE_SIGNING_MODE=developer-id`
- `OURO_CODESIGN_IDENTITY`
- `APPLE_DEVELOPER_ID_CERTIFICATE_BASE64`
- `APPLE_DEVELOPER_ID_CERTIFICATE_PASSWORD`
- `APPLE_DEVELOPER_ID_CERTIFICATE_IDENTITY` when the repo wants the import step to set `OURO_CODESIGN_IDENTITY`
- `APP_STORE_CONNECT_API_KEY_BASE64` or `APP_STORE_CONNECT_API_PRIVATE_KEY_BASE64`
- `APP_STORE_CONNECT_API_KEY_ID`
- `APP_STORE_CONNECT_API_ISSUER_ID`
- `APPLE_TEAM_ID`

For local maintainer releases, a Keychain notary profile is usually less brittle than keeping API-key files in the repo workspace.

## Validation

Before claiming the signing lane is complete:

- `scripts/check-signing-readiness.sh`
- `scripts/check-signing-readiness.sh --selftest`
- `scripts/sign-notarize-app.sh --selftest`
- `scripts/prepare-ci-signing-assets.sh` in default no-op mode.
- Existing app tests and app-bundle verification.
- A dry-run package that stays ad-hoc and records `"signingMode": "ad-hoc"`.
- Once credentials are available, a Developer ID package that signs, notarizes, staples, passes `spctl`, and records `"signingMode": "developer-id"` plus `"notarized": true`.

If Apple Developer membership is active in payment/subscriptions but certificate access still says the team is ineligible, record it as Apple propagation/support state, set a reminder or heartbeat to check again, and continue only with repo-side preparation.

---
name: sign-apple-apps
description: Set up Apple app signing, notarization, stapling, Mac App Store signing, and release-channel checks for native Apple apps. Use when a user asks to sign, notarize, distribute, renew Apple Developer membership, configure notarytool credentials, create Developer ID or App Store certificates, unblock Gatekeeper warnings, submit to App Store Connect, or support direct-download macOS releases alongside App Store/TestFlight channels.
---

# Sign Apple Apps

Use this with `build-native-apple-app` and `mac-app-distribution` for distribution work. This skill owns the signing/notarization/release-credential lane; app architecture, UI, public store metadata, and native product validation still belong to the native-app and distribution skills.

## Shared Distribution Kit

Start every reusable signing/distribution pass from `ourostack/apple-distribution-kit`.
Each app repo should have `distribution/apple-distribution.json` plus a thin
`scripts/apple-distribution-kit.sh` wrapper that resolves, in order:

1. `APPLE_DISTRIBUTION_KIT_BIN`
2. a CI checkout at `.ci/apple-distribution-kit/dist/cli.js`
3. a sibling checkout at `../apple-distribution-kit/dist/cli.js`
4. an installed `apple-distribution-kit` command

The shared kit owns app-neutral manifest validation, dry-run/apply planning,
App Store Connect review-plan generation, and non-secret CI gates. The app repo
owns only app-specific build/package scripts and product metadata.

Canonical current bundle IDs:

- Ouro MD: `bot.ouro.md`
- Ouro Workbench: `bot.ouro.workbench`
- Spoonjoy: `app.spoonjoy`

Use app-neutral names for reusable materials. `OURO_` prefixes are acceptable
inside Ouro-owned app repos but should not leak into non-Ouro apps such as
Spoonjoy. Store App Store Connect automation values as secrets or local config,
not source files:

- `APP_STORE_CONNECT_API_KEY_ID`
- `APP_STORE_CONNECT_API_ISSUER_ID`
- `APP_STORE_CONNECT_API_KEY_PATH` or `APP_STORE_CONNECT_API_KEY_BASE64`
- `APP_STORE_CONNECT_PROVIDER_PUBLIC_ID` when Transporter/altool needs a
  provider short name or public provider id.

## Human Boundary

Stop for the operator for:

- Apple Developer Program enrollment, renewal, payment, identity verification, Apple ID password, 2FA, CAPTCHA, or support contact.
- Creating/downloading certificates or API keys if the Apple portal requires private account prompts.
- App Store Connect agreements, app ownership, or app-transfer decisions.
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

When an Apple app-specific password is generated in a browser, capture it once into the intended secret store, then immediately dismiss the modal and clear any temporary screenshots or clipboard contents. Do not leave the one-time password visible while continuing repo work. If it was exposed in shared UI/logs, offer to revoke and regenerate it.

Do not flip `OURO_RELEASE_SIGNING_MODE=developer-id` or `OURO_REQUIRE_NOTARIZATION=1` in CI until the notary credential path has been live-validated (`xcrun notarytool store-credentials ... --validate`, `notarytool history`, or equivalent Apple ID/API-key validation). Set inert certificate/identity secrets first, prove the import/readiness path, then require notarization.

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

## Mac App Store Signing Lane

Developer ID and Mac App Store signing are different lanes. A working Developer ID Application certificate proves direct-download readiness, but it cannot submit a Mac App Store package.

For Mac App Store macOS uploads, expect three separate materials:

- `Mac App Distribution` certificate in the Apple portal: signs the `.app` bundle for Mac App Store distribution. The imported Keychain identity may appear as `Apple Distribution`, `3rd Party Mac Developer Application`, or another Apple-renamed equivalent depending on current portal/Xcode naming.
- `Mac Installer Distribution` certificate in the Apple portal: signs the `.pkg` uploaded for Mac App Store review. The imported Keychain identity commonly appears as `3rd Party Mac Developer Installer`.
- Mac App Store provisioning profile: embedded in the app when the app uses entitlements or capabilities that require a profile. Some repos make this optional, but do not skip it if Apple's validation or the app capability set requires it.

Probe local readiness with:

```bash
security find-identity -v -p codesigning | rg "Apple Distribution|3rd Party Mac Developer|Mac App|Mac Installer"
security find-certificate -a ~/Library/Keychains/login.keychain-db | rg "Apple Distribution|3rd Party Mac Developer|Mac App|Mac Installer"
```

Do not hard-code the documentation example identity name after certificate creation. Import the downloaded `.cer` plus its matching private key, then record the exact `security find-identity` output and use that exact string in package env.

Recommended local CSR layout:

```text
~/Library/Application Support/<Vendor>/Signing/apple-app-store-<TEAM_ID>/
  MacAppDistribution-<TEAM_ID>.certSigningRequest
  MacAppDistribution-<TEAM_ID>.key
  MacInstallerDistribution-<TEAM_ID>.certSigningRequest
  MacInstallerDistribution-<TEAM_ID>.key
```

Use distinct CSR/key pairs for app and installer certificates. Upload only `.certSigningRequest` files to Apple. Keep private keys local, chmod `600`, and never paste their contents into chat, logs, PRs, or task cards.

Store-build packaging should:

1. Build with an explicit App Store distribution channel flag.
2. Disable direct-download update checks and direct-updater UI.
3. Use App Sandbox and the narrowest entitlements that preserve product behavior.
4. Sign the `.app` with `Apple Distribution`.
5. Build/sign the `.pkg` with `3rd Party Mac Developer Installer`.
6. Validate the package against App Store Connect before upload whenever the repo supports validation mode.
7. Upload only after validation passes, then wait for App Store Connect processing.

Prefer App Store Connect API credentials for repeatable automation:

- `APP_STORE_CONNECT_API_KEY_ID`
- `APP_STORE_CONNECT_API_ISSUER_ID`
- `APP_STORE_CONNECT_API_KEY_PATH` or `APP_STORE_CONNECT_API_KEY_BASE64`
- `APP_STORE_CONNECT_PROVIDER_PUBLIC_ID` when the account has more than one provider.

Apple ID plus an app-specific password can be useful for local one-off validation/upload when a repo's scripts support it:

- `APPLE_ID`
- `APPLE_TEAM_ID`
- `APPLE_APP_SPECIFIC_PASSWORD`

Do not commit `.p8`, `.p12`, provisioning profiles, app-specific passwords, or exported private keys. If a password or private key is visible in shared UI, clean it up immediately and offer to revoke/regenerate.

## Apple Portal Automation Discipline

Browser control against Apple account pages is brittle. Use the most deterministic control surface available and avoid restarting a logged-in browser unless it is already unrecoverable.

Preferred order:

1. Official/local CLI or API path, when the needed operation supports it.
2. Browser automation with first-class DOM and file upload support, using an authenticated session.
3. Live browser UI with keyboard navigation and screenshot gates.
4. Human handoff only for account prompts, 2FA, CAPTCHA, payment, legal agreements, or a browser-auth state that cannot be transferred.

When using a live browser:

- Do not close or restart a browser that the operator just authenticated unless it is already wedged and unusable.
- Prefer direct portal URLs over coordinate clicks for navigation.
- Prefer keyboard navigation over pointer clicks when the page has stable tab/radio behavior.
- If Chrome blocks AppleScript JavaScript, enable `View > Developer > Allow JavaScript from Apple Events`, then verify with a harmless script before depending on it. Some sessions still require a browser restart; do not take that restart while it would lose the only authenticated session unless there is no other path.
- For native file pickers, prefer an automation surface that can set the file input directly. If forced through the macOS open panel, use `Command-Shift-G`, paste the full path, and screenshot/URL-check after selection. If the picker or browser turns into a black/uncapturable state, record the exact state and stop browser driving rather than repeatedly thrashing auth.
- Keychain prompts for browser cookie extraction or signing imports may ask for Chrome Safe Storage or private-key access. Only click `Always Allow` when the operator has explicitly authorized it for the current work. If no password is configured and the operator has authorized blank-password access, use the blank field and `Always Allow`.

If browser cookies are reused in Playwright or another tool, verify the target page renders the actual form controls, not just account chrome. Apple pages can show the signed-in header while a React view fails to render certificate inputs; that is not sufficient evidence that the automation path is usable.

## Repo Contract

For each app repo, add or reuse:

- `distribution/apple-distribution.json`: the canonical app/channel manifest
  consumed by `apple-distribution-kit`.
- `scripts/apple-distribution-kit.sh`: a thin resolver for the shared kit CLI;
  keep it app-neutral except for local path comments if unavoidable.
- `scripts/check-apple-distribution-kit.sh`: non-secret CI/preflight gate that
  validates the manifest, runs `apple-distribution-kit plan --mode dry-run`, and
  rejects committed Apple credential files.
- `scripts/check-signing-readiness.sh`: non-secret by default; validates tools (`codesign`, `xcrun notarytool`, `xcrun stapler`) and fails closed only when `OURO_REQUIRE_NOTARIZATION=1` or live credential validation is requested.
- `scripts/prepare-ci-signing-assets.sh`: no-op only when no signing mode, notarization requirement, or signing identity is configured. When Developer ID signing is required or an identity secret is present on GitHub-hosted macOS, import the base64 `.p12` Developer ID certificate into a temporary keychain, write any base64 App Store Connect `.p8` key to a temporary file, and append paths/derived env to `$GITHUB_ENV`.
- `scripts/sign-notarize-app.sh`: signs, submits, staples, and verifies one `.app`; includes a `--selftest` that needs no Apple credentials.
- `scripts/package-app-store.sh`: builds the App Store channel, embeds the provisioning profile when configured, signs with `Apple Distribution`, creates a Mac App Store `.pkg`, and supports at least validate/upload modes when App Store credentials are present.
- `scripts/check-app-store-build.sh`: builds or inspects the App Store channel without secrets and proves channel-specific behavior such as sandbox entitlements, category, telemetry configuration, and direct-updater suppression.
- Release packaging support for `OURO_RELEASE_SIGNING_MODE=developer-id` and `OURO_REQUIRE_NOTARIZATION=1`.
- Manifest fields:
  - `"signingMode": "ad-hoc"` or `"developer-id"`
  - `"notarized": true` or `false`
- Verification that `developer-id` artifacts must have `"notarized": true`.
- CI/preflight selftests for the readiness and signing scripts that do not require secrets.

Default CI should remain safe without Apple credentials. Real release signing should activate only through explicit release env/secrets, not through incidental local state.

## GitHub Actions Notes

GitHub-hosted macOS runners do not have the operator's Keychain certificates. If CI should produce Developer ID releases, import certificates into a temporary keychain from GitHub secrets before packaging, then delete the keychain after the job. Keep dry-run and PR checks non-secret.

If a release workflow passes `OURO_CODESIGN_IDENTITY` into readiness checks, it must run the signing-assets preparation step before readiness or the identity lookup will fail on the clean runner. The prep step should also selftest this "identity configured implies assets needed" contract.

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

For App Store packaging, use app-neutral names where possible and app-prefixed names only when the repo already has that convention:

- `APPLE_DISTRIBUTION_CERTIFICATE_BASE64`
- `APPLE_DISTRIBUTION_CERTIFICATE_PASSWORD`
- `APPLE_DISTRIBUTION_CERTIFICATE_IDENTITY`
- `APPLE_MAC_INSTALLER_CERTIFICATE_BASE64`
- `APPLE_MAC_INSTALLER_CERTIFICATE_PASSWORD`
- `APPLE_MAC_INSTALLER_CERTIFICATE_IDENTITY`
- `MAC_APP_STORE_PROVISIONING_PROFILE_BASE64`
- `APP_STORE_CONNECT_API_KEY_BASE64`
- `APP_STORE_CONNECT_API_KEY_ID`
- `APP_STORE_CONNECT_API_ISSUER_ID`
- `APP_STORE_CONNECT_PROVIDER_PUBLIC_ID`

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
- `scripts/check-app-store-build.sh` or the repo's equivalent App Store channel preflight.
- Once App Store credentials are available, `scripts/package-app-store.sh --validate` or the repo's equivalent validation path.
- Once the app record exists and validation passes, upload the package and verify the processed build appears under the correct App Store Connect app/version before claiming the store lane is ready for review.

If Apple Developer membership is active in payment/subscriptions but certificate access still says the team is ineligible, record it as Apple propagation/support state, set a reminder or heartbeat to check again, and continue only with repo-side preparation.

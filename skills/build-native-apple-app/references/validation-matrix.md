# Native Apple Validation Matrix

Use this before claiming completion.

## Local Tooling

- `xcodebuild -version`
- `swift --version`
- `xcrun simctl list runtimes`
- `xcodebuild -list -json -project <Project>.xcodeproj`
- `xcodebuild -showdestinations -scheme <Scheme>`

## Build And Test

- Swift package tests: `swift test`
- iOS simulator build: `xcodebuild -scheme <Scheme> -destination 'platform=iOS Simulator,name=<Device>' build`
- iPadOS simulator build: use an iPad destination when the app promises iPad support.
- macOS build: `xcodebuild -scheme <Scheme> -destination 'platform=macOS' build`
- UI/scenario tests: use an Xcode test plan or a repo script with stable pass/fail output.
- Coverage: use `swift test --enable-code-coverage` for package logic or Xcode coverage for app targets.

## Manual/Visual Checks

- Launch on the selected iPhone simulator.
- Launch on the selected iPad simulator if supported.
- Launch the macOS app.
- Verify first-run, auth/session, empty states, offline/error states, and the top three product flows.
- Check Dynamic Type, VoiceOver labels, keyboard navigation, Reduce Motion, and color contrast.
- Capture screenshots when visual design or layout is part of the acceptance criteria.

## Distribution Boundary

- Free Apple developer account: can access tools and test directly on own devices through Xcode.
- Apple Developer Program membership: required for TestFlight, App Store Connect upload/distribution, and App Store release.
- If the paid program is not available, record the account blocker and finish all local engineering validation.

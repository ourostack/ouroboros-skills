# WWDC26 Native Levers

Use current Apple documentation before making product or architecture claims. Good starting points:

- WWDC26 iOS guide: https://developer.apple.com/wwdc26/guides/ios/
- macOS 27 what's new: https://developer.apple.com/macos/whats-new/
- WWDC26 Platforms State of the Union takeaways: https://developer.apple.com/news/?id=lvart8mq
- What's new in SwiftUI: https://developer.apple.com/videos/play/wwdc2026/269/
- Apple Developer Program: https://developer.apple.com/programs/
- Distributing your app for beta testing and releases: https://developer.apple.com/documentation/xcode/distributing-your-app-for-beta-testing-and-releases

## Product-Relevant Capabilities

- Foundation Models: native Swift access to Apple Intelligence models, including on-device use, image input, Dynamic Profiles, and provider abstraction through the Language Model protocol. Use for private, contextual assistance only when it improves the user's workflow.
- Core AI: OS-level on-device model runtime for Apple silicon. Consider for compact custom models, private inference, or zero-server-dependency features.
- App Intents: exposes app entities and actions to Siri, Shortcuts, Spotlight semantic indexing, and system intelligence. Treat this as one of the strongest reasons to build native.
- App Intents Testing: validates intent integrations through real system pathways. Use when App Intents become part of the product surface.
- SwiftUI 2027 updates: refined platform look, document APIs, reordering across lists/grids/sections, toolbar behavior, swipe actions on more views, AsyncImage caching, and lazy Observable state. Use system behaviors instead of custom clones.
- Design updates: Liquid Glass, refreshed materials, refined typography, updated navigation/tab bars, tighter macOS corners, better resizable iOS app behavior, and stronger cross-platform consistency.
- Xcode 27: Apple silicon only, Device Hub replacing Simulator, customizable toolbar/themes, and agentic coding hooks. Adjust local/CI assumptions accordingly.

## Evaluation Prompt

For each proposed native capability, answer:

1. What user workflow becomes better?
2. Is this private, faster, offline-capable, or system-integrated because it is native?
3. What data/entitlement/account state is required?
4. How will it be tested locally and in CI?
5. What is the simplest non-native fallback if the capability is unavailable?

Reject capabilities that cannot answer these questions cleanly.

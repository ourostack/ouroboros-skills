---
name: product-cloner
description: Clone the look, feel, and behavior of an existing application (especially desktop/Electron/web apps) by reading its shipped source as the ground truth instead of guessing. Use when the user says "make X look/behave exactly like Y", "clone Typora/Notion/Linear/etc.", or pushes back that a parity attempt "doesn't match". Covers locating the source of truth (app bundle CSS/JS, plists, `defaults read`, beautifying minified bundles, the DOM template), pinning the user's ACTIVE variant, extracting a complete source-grounded spec (visual tokens, DOM/feature inventory, behavior defaults, string inventory), implementing against the spec, and verifying against the reference. Keeps the IP line clear: read shipped artifacts to extract facts, reimplement originally.
---

Clone a product by **reading its source of truth**, not by rendering-and-nudging against screenshots. Every shipped app carries its own exact values — fonts, colors, sizes, DOM structure, default settings, keyboard maps, UI strings — somewhere readable on the user's machine or in a public bundle. Find it first. One read beats fifty guess-and-compare cycles, and the user pays the cost of every cycle.

This skill exists because the slow, painful way to clone is the *intuitive* way: open the target, eyeball it, implement a plausible value, render, compare, nudge, repeat. That converges glacially because each step is a guess. Don't do that. Decompile, spec, implement.

## When to use

- "Make X look/feel/behave exactly like Y."
- "Clone <app>." / "Build a <Notion/Typora/Linear/Things> clone."
- A parity attempt the user says is "10% there", "wrong font", "wrong colors", "not even close".
- Any time you're tempted to web-search "what font does <app> use" — that's the signal to read the source instead.

## Hard rules

1. **Find the source of truth before implementing.** Spend your first moves locating it, not approximating.
2. **Pin the user's ACTIVE variant.** Don't match "the app" — match the exact theme/config the *user* sees. Check the setting (`defaults read`, config files, a settings export).
3. **When the user says "go read/decompile the source" — do it immediately and thoroughly.** A repeated identical steer means your current approach is wrong. (This skill was born from ignoring that steer four times.)
4. **Write the spec from the source before coding.** A source-grounded spec makes implementation small and the result inevitable.
5. **Reading shipped artifacts to extract facts is fair use; reimplement originally.** Values like `#f8f8f8`, `2.25em`, "Open Sans", a DOM class name, or "auto-save defaults off" are facts, not creative expression. Re-author the CSS/code yourself. Don't copy proprietary code or assets verbatim — except components under a permissive license, which you bundle *with attribution*.

## Phase 1 — Locate the source of truth (the "decompile")

Where the ground truth lives, by app type:

- **macOS app bundle:** `/Applications/<App>.app/Contents/Resources/`. Look for plaintext CSS/JS, `index.html`, theme folders, fonts. List it: `find /Applications/<App>.app -iname '*.css' -o -iname '*.js' -o -iname 'index.html'`.
- **Electron apps (the jackpot):** logic ships as JS, styles as CSS, the UI as an HTML template — all readable.
  - Resources often hold `app.asar` (unpack with `npx asar extract app.asar out/`) or a plain `Resources/<app>/` tree.
  - **The DOM template (`index.html`) is the single highest-value file** — it's the entire UI skeleton with every panel's ids/classes (sidebar, file browser, footer, search, modals). Read it whole.
  - Minified bundles: beautify them — `npx --yes js-beautify big.min.js -o /tmp/dec/big.js` — then grep the beautified file for logic and the minified original for property names/values.
- **Active config / which variant the user sees:** macOS → `defaults read <bundle-id>` (e.g. `defaults read abnerworks.Typora` → `theme = Github`). Also app config dirs under `~/Library/Application Support/<app>/`.
- **Native (non-Electron) apps:** styles/strings in `Assets.car` (use `acextract`/`assetutil`), `.nib`/`.storyboard`, `Info.plist`, `.strings` files. Behavior may be in the binary — fall back to observation + platform conventions.
- **Web apps:** DevTools (computed styles, the DOM, network CSS/JS), or fetch the shipped CSS/JS bundles directly. Beautify and mine the same way.
- **Open-source targets:** read the repo directly; still pin the exact theme/version the user runs.

## Phase 2 — Extract a complete spec (four lenses)

Mine the source across four lenses. Don't stop at visuals — the user will keep finding missing behavior if you do.

1. **Visual tokens (from CSS):** the active theme's exact values — root vars, body font stack + bundled webfonts, font-size, line-height, text/link colors, content max-width (+ responsive breakpoints), heading scale, block spacing, table borders/fills/zebra, code block + inline code bg/border/radius/size, blockquote, hr, selection. Record exact hex/em/px.
2. **Structure / feature inventory (from the DOM template + strings):** every panel and chrome element (sidebar tabs, file browser header/footer, search panel + options, outline, status bar, quick-open, modals). Grep the HTML for `id=`/`class=` and grep all bundles for human-readable string literals and localization labels — the **string inventory is the complete feature map**.
3. **Behavior / defaults (from beautified JS):** the default-settings object (every key + default), editing behaviors (focus/typewriter/source modes, auto-pair, smart punctuation, list continuation, paste handling), file-watching, search engine, sort/group rules, performance caps.
4. **Keyboard map + chrome (from JS + binary + observation):** shortcut→command pairs; native window chrome (frame/titlebar style, traffic-light position, vibrancy, min size) — note that in Electron these live in the main process / compiled binary, so combine grep with screenshots and platform conventions.

Write it all into one spec doc (sections per lens), with exact values and a target→your-app mapping. This is the deliverable that makes implementation mechanical.

## Phase 3 — Implement against the spec

- Implement the exact values; don't re-approximate. Where the target bundles a permissively-licensed font/asset, bundle the same one and attribute it.
- Distinguish **layout/typography (global)** from **theme (color only)** unless the target genuinely couples them — and even then, prefer the cleaner model if the user asks.
- Re-implement behaviors per the decompiled defaults (e.g., match the target's auto-pair set, smart-quote characters, sort order, file-list caps).
- Keep an attribution `NOTICE` for every bundled third-party component + its license.

## Phase 4 — Verify against the reference

- Compare your output to the **actual target**, element by element, using the spec as the checklist — ideally offscreen/headless (render a representative sample and diff against a screenshot of the target's active theme).
- When the user flags a miss, trace it back to the source value, not to a guess. Fix the spec and the implementation together.
- Bonus: a single decompile pass often fixes bugs you'd parked (e.g., re-deriving how the target layers table-row backgrounds reveals why your odd rows were wrong).

## Anti-patterns (the slow, wrong way)

- **Guess-and-nudge:** implementing plausible values and tuning against screenshots. (Converges glacially; burns user attention.)
- **Matching "the app" instead of the user's active theme/config.** You'll match a variant they never see.
- **Stopping at visuals.** Chrome, file browser, search, and behaviors are where "feels like a clone" actually lives.
- **Implementing before the spec exists.** The spec is the work; the code is the easy part.
- **Letting a vague IP worry stall the highest-signal step.** Reading shipped plaintext to extract factual values is fair use; reimplement originally.

## Worked example (Typora → a native clone)

Locate: Typora is Electron; theme CSS is plaintext at `/Applications/Typora.app/Contents/Resources/TypeMark/style/` (`base.css`, `base-control.css`, `themes/github.css`, `codemirror.css`), the full UI is in `…/TypeMark/index.html`, logic in `…/appsrc/main.js` (beautify), file-tree in `…/appsrc/finder-worker.js`. Active theme via `defaults read abnerworks.Typora` → `Github`.

What the four lenses yielded:
- **Visual:** body = bundled **Open Sans** (Apache-2.0), 16px/1.6, `#333`, links `#4183c4`; `#write` max-width 860→1024→1200; headings 2.25/1.75/1.5/1.25/1/1em with `#eee` underlines on h1/h2; tables `#dfe2e5` borders + `#f8f8f8` header/even-row; code `#f8f8f8`/`#f3f4f4` + `#e7eaed` border + 3px; syntax = CodeMirror `cm-s-inner` palette (purple `#708` keywords, `#a11` strings, `#a50` comments) — re-mapped onto highlight.js for a different renderer.
- **Structure:** sidebar tabs Files/Outline/Search; file browser footer `#ty-sidebar-footer` shows the mounted folder name + new-file + list/tree toggle; in-file search `#md-searchpanel` (case/word/regexp); whole-folder search via ripgrep.
- **Behavior:** `DEFAULT_OPTIONS` → `enableAutoSave:false`, `enableInlineMath:true`, `smartQuote/smartDash:false`, `codeIndentSize:4`, `useTreeStyle:false`, sidebar min 160 / hide < 100, file-list cap 400, `wordsPerMinute:382`.
- **Keys:** ⌘F find, ⌘H replace, ⌘/ source mode, ⌘B/I/U; heading ⌘1-6 + F8/F9 are app-menu bindings.

That spec turned a stalled "~10% there" parity attempt into a faithful clone in one focused pass — and incidentally fixed a parked dark-table bug, because reading `github.css` showed the row-background layering exactly.

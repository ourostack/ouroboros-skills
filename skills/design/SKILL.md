---
name: design
description: Design and build production-grade frontend interfaces from scratch. Covers the full workflow from context gathering through visual direction, implementation, and polish. Use when creating new pages, components, or design systems — not just auditing existing UI.
---

This skill guides the creation of distinctive, high-craft frontend interfaces. It covers the full arc: understanding context, gathering inspiration, establishing visual direction, building with intention, and polishing to production quality.

## First: Understand What You're Designing

Before writing any code, have a conversation to understand the project:

### Product & audience
- **What is this?** Marketing page, app UI, docs site, dashboard? Each has different spatial logic.
- **Who sees it?** Developer tool users expect density. Consumer products expect breathing room. Know which world you're in.
- **What devices?** Desktop-first with responsive? Mobile-first? Kiosk? This determines your spatial grid and interaction model.

### Existing design system
- **Check for tokens first.** Look for Tailwind config, CSS custom properties, design token files, or a component library. Never invent a parallel system when one exists.
- **Extract the palette.** Pull exact colors, font stacks, spacing scales, border radii, shadow definitions.
- **Read the room.** Is the existing design minimal or rich? Geometric or organic? Light or dark? Match it.

### Tone & aesthetic
- Ask the user to commit to a direction. Not "clean and modern" (that's nothing). Push for specific language:
  - Brutally minimal. Editorial. Organic and atmospheric. Dense and technical. Warm and approachable. Retro-futuristic.
- If they can't articulate it, ask for 2-3 reference sites or screenshots. Extract the direction from those.

### Constraints
- **Framework/stack**: What are you building with? Astro, Next, plain HTML? Tailwind, vanilla CSS, styled-components?
- **Performance budget**: Heavy animation and large images aren't free. Know the constraints.
- **Accessibility requirements**: WCAG level? Government/enterprise compliance needs?

**Do not proceed until you understand these answers.** The biggest design failures come from building on assumptions.

---

## Gather References Before You Touch Code

Design taste is trained, not innate. Before building, spend time looking at work that matches the intended direction.

### Where to look
- **Awwwards** (awwwards.com) — jury-scored, cutting-edge web craft
- **Mobbin** (mobbin.com) — curated mobile and web UI patterns from real products
- **Cosmos** (cosmos.so) — visual reference collections, searchable by color and mood
- **Variant** (variant.ai) — AI-generated design explorations with code export

### What to extract
Don't just screenshot. Identify the specific decisions that make a reference work:
- **Color**: What's the palette? How many colors? What's the dominant hue? Are neutrals warm or cool?
- **Typography**: What's the display font? Body font? What's the scale ratio? How much weight contrast?
- **Spacing**: How much breathing room between sections? How dense are component interiors?
- **Motion**: Is it static? Subtle reveals? Heavy animation? What eases are used?
- **Layout**: Centered? Asymmetric? Grid-based? How does the eye move through the page?

### Present before building
Show references to the user. "I'm pulling from these three directions — does this match what you're imagining?" Alignment here prevents rework later.

---

## Establish Design Direction

Lock down these decisions before writing implementation code. These are your design constraints — every subsequent decision flows from them.

### Color

- **Choose a color system.** OKLCH produces perceptually uniform palettes. HSL is fine for simple projects. Hex is a last resort.
- **Tint your neutrals.** Pure gray (#808080) is lifeless. Warm neutrals toward your brand hue — even 2-3% saturation makes a difference.
- **60-30-10 rule.** 60% dominant (background/surface), 30% secondary (text/containers), 10% accent (CTAs/highlights). This isn't a law, but it's a strong default.
- **Dark mode isn't just inverted light mode.** Dark backgrounds need lower contrast text (not pure white), reduced saturation on colors, and more spatial separation between layers.

### Typography

- **Pick two fonts maximum.** One display, one body. If you can get away with one family at different weights, even better.
- **Establish a modular scale.** Use a ratio (1.25 major third, 1.333 perfect fourth, 1.5 perfect fifth) to generate your size steps. Don't pick arbitrary pixel values.
- **Use `clamp()` for display text.** Fluid type on marketing/landing pages. Fixed rem scales for app UIs.
- **Weight creates hierarchy.** You need at least three distinct weight levels: bold (headings), regular (body), and light or medium (secondary text). If your font doesn't have enough weights, pick a different font.

### Spacing

- **Choose a base unit.** 4px is the standard. Every spacing value should be a multiple: 4, 8, 12, 16, 24, 32, 48, 64, 96, 128.
- **Sections need room to breathe.** Full-viewport heroes, generous padding between page sections. A page that feels cramped is a page that feels cheap.
- **Tighter inside, looser outside.** Components have tight internal spacing. The gaps between components are larger. The gaps between sections are largest. This creates visual grouping without needing borders.

### Commit to the direction
Write down your decisions: "This page uses [font] at [scale], [palette] colors, [unit] spacing, [tone] aesthetic." This is your reference for every decision that follows.

---

## Build: The Implementation

### Work section by section
- Start with the most important section (usually the hero or primary content area).
- Build it, review it, get feedback before moving on.
- Each section should be able to stand alone as a good piece of design.

### Hierarchy first, decoration later
1. **Structure**: Get the layout right. Spacing, alignment, content flow.
2. **Typography**: Set type sizes, weights, line heights, measure (line length).
3. **Color**: Apply your palette. Background, text, accents.
4. **Polish**: Borders, shadows, radii, micro-interactions, transitions.

Building in this order prevents the trap of making something "look nice" before it works spatially.

### Responsive from the start
- Design for your primary breakpoint first, but test narrow viewports as you go — not as a cleanup pass at the end.
- Use container queries for component-level responsiveness when the framework supports them.
- Never hide critical content on mobile. Adapt the layout, don't amputate it.

---

## The AI Slop Test

> If you showed this interface to someone and said "AI made this," would they believe you immediately? If yes, that's the problem.

These are the tells. Avoid every one of them.

### Typography tells
- **Overused fonts**: Inter, Roboto, Arial, Open Sans, system-ui defaults. If a font ships with every OS or appears in every template, it's not a design choice — it's a non-choice.
- **Monospace as "technical" shorthand**: Using monospace for headings or body text to signal "this is a developer tool" is lazy. Use it for code. Use a real typeface for everything else.
- **Giant icons above every heading**: The icon + heading + description card, repeated six times in a grid. It's a template, not a design.

### Color tells
- **Gray text on colored backgrounds**: It looks washed out. Tint your text toward the background hue.
- **Pure black or pure white**: Always tint. `#0a0a0a` reads as black. `#fafafa` reads as white. Both have more life than the pure values.
- **The AI palette**: Cyan-on-dark, purple-to-blue gradients, neon accents on dark backgrounds. If it looks like it belongs in a crypto dashboard from 2023, rethink it.
- **Gradient text on metrics**: Big number, gradient fill, small label underneath. It's the "impressive stats" template. Find another way.

### Layout tells
- **Cards everywhere**: Not every piece of content needs a border, background, and border-radius. Sometimes text on a page is just text on a page.
- **Cards inside cards**: Nested containment is almost always wrong. If you need hierarchy, use spacing and typography — not more boxes.
- **Identical card grids**: Same icon, same heading size, same description length, repeated N times. Real content has varying weight and importance. Reflect that.
- **Centering everything**: Left-aligned text with asymmetric layout feels more designed than centered text in a centered container. Center sparingly and intentionally.
- **Uniform spacing**: Same gap everywhere = no rhythm. Vary your spacing to create visual grouping and pacing.

### Visual tells
- **Glassmorphism without purpose**: Blur, glass cards, glow borders. These are effects, not design decisions. Use them only when the visual metaphor demands it.
- **Rounded rectangles with drop shadows**: The default card. If you're reaching for `rounded-lg shadow-md`, stop and ask if you need a card at all.
- **Decorative sparklines**: They look sophisticated and convey nothing. Don't add data visualization that isn't visualizing real data.
- **Gradients by default**: Never use gradients unless the design direction specifically calls for them. They are a strong visual choice — treat them that way.

### Interaction tells
- **Every button is primary**: If everything is emphasized, nothing is. One primary action per view. Everything else is secondary or tertiary.
- **Redundant information**: Headers restating what the content already says. Labels repeating the placeholder. Remove the redundancy.

---

## Motion & Interaction Craft

### The animation decision framework
Before adding any animation, answer sequentially:

1. **Should this animate at all?** If the user triggers this action 100+ times per day (keyboard shortcuts, tab switches, repeated clicks), the answer is no. Animation is for infrequent, meaningful transitions.
2. **What's the purpose?** Orientation (where am I?), feedback (did it work?), continuity (what changed?), or personality (does it feel alive?).
3. **What easing?** `ease-out` for entrances (element arriving). `ease-in` for exits (element leaving). `ease-in-out` for things that move across the screen. Never `linear` for UI. Never `ease-in` for entrances (feels sluggish).
4. **How fast?** Interaction feedback: under 200ms. UI transitions: 200-350ms. Elaborate entrances: 400-600ms. Nothing should exceed 700ms — that's an eternity.

### Hard rules
- **Only animate `transform` and `opacity`.** Never animate `width`, `height`, `top`, `left`, `margin`, `padding` — they trigger layout recalculation and will jank.
- **Never animate from `scale(0)`.** Start from `scale(0.95)` with `opacity: 0`. Scale-from-zero looks cheap.
- **Never use `transition: all`.** Specify exact properties. `all` transitions properties you didn't intend and creates visual noise.
- **Respect `prefers-reduced-motion`.** Reduce, don't eliminate — simpler, faster transitions instead of nothing.
- **Gate hover effects** behind `@media (hover: hover) and (pointer: fine)`. Touch devices don't have hover.
- **Use CSS transitions for interruptible UI.** Keyframe animations for predetermined sequences. Don't use keyframes for things the user can interrupt mid-flight.
- **Stagger delay: 30-80ms between items.** Longer feels sluggish. Shorter is imperceptible.

### Useful easing curves
```css
--ease-out:     cubic-bezier(0.23, 1, 0.32, 1);
--ease-in-out:  cubic-bezier(0.77, 0, 0.175, 1);
--ease-spring:  cubic-bezier(0.34, 1.56, 0.64, 1);
```

### Interaction details
- **Buttons**: Scale `0.97-0.98` on `:active` for tactile feedback. Keep it subtle.
- **Popovers**: Set `transform-origin` from the trigger element, not center. Modals are the exception.
- **Tooltips**: Delay before show (~400ms). Instant dismiss. Skip delay when moving between adjacent tooltips.
- **Focus states**: `:focus-visible` only (keyboard users), not `:focus` (which fires on click too). Make focus rings obvious — 2px offset, high contrast.

---

## Accessibility Baseline

These aren't optional. Ship accessible or don't ship.

- **Every interactive element needs an accessible name.** Icon-only buttons get `aria-label`. Inputs get associated labels. Links get meaningful text.
- **Keyboard navigation works.** All interactive elements reachable via Tab. Escape closes overlays. Focus order makes sense.
- **Modals trap focus.** Focus moves into the modal on open, cycles within it, and returns to the trigger on close.
- **Color isn't the only signal.** Don't rely on color alone for error states, status, or meaning. Add icons, text, or patterns.
- **Contrast meets WCAG AA.** 4.5:1 for body text, 3:1 for large text and UI components. Test with a contrast checker, don't eyeball it.
- **Prefer native HTML.** `<button>` over `<div role="button">`. `<a>` over `<span onClick>`. Native elements come with keyboard handling and screen reader semantics for free.

---

## Review & Polish

Before calling a page done, run through this checklist:

### The squint test
Squint at the page (or blur your screenshot). Can you still identify the visual hierarchy? Do you know where to look first, second, third? If the page turns into an undifferentiated blur, your hierarchy needs work.

### Typography check
- [ ] No more than 2 font families
- [ ] Size scale is consistent (uses defined steps, not arbitrary values)
- [ ] Line length (measure) is 45-75 characters for body text
- [ ] Line height is 1.4-1.6 for body, 1.1-1.2 for display/headings
- [ ] `text-balance` on headings, `text-pretty` on body paragraphs
- [ ] `tabular-nums` on any numerical data

### Color check
- [ ] No pure black or pure white
- [ ] Text meets contrast requirements (4.5:1 body, 3:1 large text)
- [ ] Accent color used sparingly (one per view)
- [ ] Neutrals are tinted, not pure gray

### Spatial check
- [ ] Spacing follows the base unit (no arbitrary pixel values)
- [ ] Sections have generous breathing room
- [ ] Component interiors are tighter than component gaps
- [ ] Alignment is consistent (things that should align, do)

### Motion check
- [ ] No animation on layout properties
- [ ] All transitions under 500ms
- [ ] `prefers-reduced-motion` handled
- [ ] Hover effects gated behind `@media (hover: hover)`
- [ ] No animation without clear purpose

### Responsive check
- [ ] Page works at 320px wide without horizontal scroll
- [ ] Touch targets are at least 44x44px on mobile
- [ ] No content hidden on mobile that's critical on desktop
- [ ] Font sizes are readable without zooming on mobile

### Accessibility check
- [ ] Tab through the entire page — focus order makes sense
- [ ] Every interactive element has an accessible name
- [ ] Form errors are linked to their fields (`aria-describedby`)
- [ ] No keyboard traps
- [ ] Screen reader can parse the page structure (headings, landmarks, lists)

---

## Common Mistakes

- **Designing without references.** You're not inventing visual language from scratch. Look at what works, understand why, then apply those principles to your project. Designing "from imagination" produces generic output.
- **Skipping the context phase.** You cannot infer audience, brand, or tone from code alone. A fintech dashboard and a children's game might use the same React stack — the design couldn't be more different.
- **Polishing before the structure is right.** Shadows and gradients on a broken layout are lipstick on a pig. Get the hierarchy, spacing, and flow right first. Polish is the last step.
- **Treating every section the same.** A page with five sections that all use the same layout pattern (heading + 3-column grid) is a template, not a design. Vary your section treatments — let content shape dictate layout shape.
- **Adding complexity for visual interest.** Nested cards, decorative borders, background patterns, floating elements — these add noise, not interest. Visual interest comes from contrast: large vs. small type, dense vs. sparse spacing, dark vs. light surfaces.
- **Forgetting the page as a whole.** Each section might look good in isolation but the page needs rhythm — tension and release, dense and sparse, loud and quiet. Scroll through the full page and feel the pacing.
- **Building the mobile version last.** "We'll make it responsive later" means "we'll cram desktop into mobile and hope." Design the narrow viewport alongside the wide one.
- **Animating because you can.** Every animation has a cost: performance, cognitive load, and distraction. If you can't articulate why something animates, remove the animation.

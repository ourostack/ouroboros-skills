---
name: video-editing
description: Build and edit videos using Remotion with kinetic typography, VO-synced timing, and motion design. Use this skill when the user asks to create, edit, or fix video content — especially presentation videos, demo reels, or kinetic text films. Complements frontend-design for motion/video work.
---

This skill guides the creation of polished, VO-synced video content using Remotion. It covers kinetic typography, demo footage editing, voiceover alignment, particle/motion design, and the editorial workflow for presentation videos.

## First: Interview the Human

Before touching any code, have a conversation to understand the project:

### Assets & materials
- **Voiceover**: Is there a recorded VO? What format? Where is it?
- **Demo footage**: Are there screen recordings or video clips? How many? What do they show?
- **Brand assets**: Logos, icons, textures? Is there an existing website, design system, or brand guide?
- **Music**: Is there a background music track, or should we find/add one?

### Creative direction
- **Reference videos**: Ask the user for examples of the style they want. Don't assume — "kinetic typography" means wildly different things to different people. Get a link, a screenshot, or a description.
- **Design language**: Is there an existing visual identity to match? (Website, app, slide deck?) If so, pull the color palette, fonts, and tokens from that source. **Never invent a parallel brand.**
- **Audience & venue**: Where will this be watched? (Screen-share, projector, mobile?) This determines text size, contrast, and detail density. A Teams screen-share needs much larger text and higher contrast than a Vimeo embed.

### Constraints
- **Duration**: What's the hard time limit? Is it a wall or a target?
- **Pacing**: Does the VO play continuously, or should there be pauses for footage to breathe?
- **Demo handling**: Are the demo clips pre-trimmed to their intended length, or does the user expect you to trim them? How sacred are they?

### Tone
- **Energy level**: Meditative and considered? Punchy and fast? Cinematic and sweeping?
- **Text role**: Should on-screen text emphasize key moments (editorial), or narrate alongside the VO (explanatory)?

**Do not proceed until you understand these answers.** The biggest failures come from building on assumptions.

## Setting Up Whisper for Transcription

Word-level timestamps are non-negotiable. Install whisper-cpp if not present:

```bash
# macOS (Homebrew)
brew install whisper-cpp

# Download a model (base.en is fast + accurate enough for English VO)
curl -L "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin" \
  -o /tmp/ggml-base.en.bin

# Verify installation
whisper-cli --help
```

If `whisper-cpp` is already installed but has no models, just download the model file. Check `brew list whisper-cpp` and look in `/opt/homebrew/share/whisper-cpp/` for existing models.

**Do NOT use Python `whisper`** — it takes 10-30 minutes for a 2-minute file. `whisper-cpp` with Metal acceleration does it in under 10 seconds.

### Transcribing

```bash
# Convert to 16kHz mono WAV (whisper-cpp requirement)
ffmpeg -y -i input.m4a -ar 16000 -ac 1 -c:a pcm_s16le /tmp/vo-16k.wav

# Transcribe with word-level timestamps
whisper-cli -m /tmp/ggml-base.en.bin -f /tmp/vo-16k.wav --output-json-full -of /tmp/vo-output
```

Parse the JSON: each segment has `tokens[]` with per-word `offsets.from` / `offsets.to` in milliseconds. Store in a TypeScript data file.

**CRITICAL**: On-screen text must appear exactly when the narrator says those words — not the sentence start, not "close enough." Always use word-level timestamps, never sentence boundaries.

## Mapping VO to Visuals

For each VO phrase, decide what the viewer sees:

- **Demo footage**: VO introduces the topic → demo appears → demo plays while VO continues
- **Kinetic typography**: Key phrases that EMPHASIZE the VO, not transcribe it
- **Chapter cards**: Brief section labels between demo groups
- **Particle/motion backgrounds**: Living visual world behind text

**Rule**: VO leads, visuals follow. Never show something on screen before the narrator has introduced it. Never show a demo for topic B while the narrator is still talking about topic A.

### Working backwards from constraints

If the video has a time limit, anchor the ending first:
1. Lock the closing VO timing (it can't move)
2. Lock the thesis/climax timing
3. Lock demo durations (full or near-full)
4. Whatever's left is the opening

This prevents running out of time at the end or having dead space.

## Kinetic Typography — What It Is and Isn't

### It is NOT:
- Subtitles with nice fonts
- Every spoken word displayed on screen
- Text that fades in from below (that's a transition, not kinetic typography)
- Centered text on a plain background

### It IS:
- **Key phrases** that editorialize — "doing things? EASY." not "making an agent that can actually do things is the easy part"
- **Text inside an animated visual world** — particles, geometric shapes, connection lines, depth-of-field
- **Graphics that ARE the concept** — "connection" shows two dots linked by a line; "surprise" has particles exploding outward
- **Typography with character-level animation** — letters blur-in, snap, scale, track in sequence
- **Variety** — each phrase gets its own treatment. Some slam, some drift, some snap, some type. Never the same twice.

### Visual treatment vocabulary:
- **Slam**: Spring with low damping, high stiffness — word arrives with overshoot
- **Snap**: Instant opacity 0→1, no easing. Short punchy phrases.
- **Blur-in**: Each character deblurs from 12px→0 with stagger delay
- **Terminal type**: Monospace font, characters appear one at a time
- **Drift**: Text on slow sine-wave translateX — contemplative moments
- **Stack**: Words appear vertically, each slightly larger, building weight
- **Scale slam**: Word starts at 60% and springs to 100%
- **Rule lines**: Horizontal lines extend from text edges — diagrammatic

## VO Audio Architecture

The voiceover is a single file but should NOT play as one continuous track. Split into blocks:

```tsx
<Sequence from={videoFrame}>
  <Audio src={staticFile(voFile)} startFrom={wavStartFrame} endAt={wavEndFrame} />
</Sequence>
```

Pauses between blocks let demo footage breathe silently. The VO introduces what the viewer is about to see, then goes quiet while they watch.

**Alignment rule**: Each VO block starts when its visual content appears.

## Demo Footage Rules

1. **Full-screen, no chrome** — `objectFit: "contain"` on dark background
2. **No text overlays on demos** — kinetic typography is for non-demo sections ONLY
3. **No fade-in/out between demos** — hard cuts. Fades create black flashes.
4. **Respect the user's cuts** — ask before trimming. If they say "intentionally cut," play at or near full length.
5. **Freeze-frame is OK** — Remotion holds the last frame when a clip ends before the Sequence does
6. **Never show a demo before the VO introduces it**

## Particle/Motion System

Build reusable SVG components:

- **ParticleField**: N circles with seeded PRNG positions, organic sin/cos drift, configurable size/opacity/blur. Optional `collapse` prop (0–1) to pull toward center.
- **ConnectionLines**: Lines between particles within maxDistance, opacity fading with distance.
- **KineticWord**: Character-level staggered animation (rise, scale, blur modes).

Keep particles low opacity (0.1–0.4), behind text. They create atmosphere, not compete with content. Particle energy can build through the video.

## Workflow

1. **Interview** — understand assets, creative direction, constraints
2. **Transcribe** — whisper-cpp, word-level timestamps
3. **Map** — VO phrases → visual treatments, phrase by phrase
4. **Build components** — particles, kinetic word, chapter cards
5. **Build scenes** — each scene owns its visual treatment and VO timing
6. **Wire timeline** — data file with visual beats + VO placements
7. **Preview in studio** — `npx remotion studio`, scrub through, check sync
8. **Iterate with user** — they watch studio, give feedback, you fix. NO RENDERS until they say go.
9. **Render** — only when approved: `npx remotion render CompositionId out/filename.mp4`

## Common Mistakes to Avoid

- **Timing math spirals**: Don't calculate frame numbers in your head. Write code, check in studio, adjust.
- **Going silent**: Stay in conversation. If unsure about a creative choice, ask. Don't disappear to plan.
- **Rendering prematurely**: Studio preview is instant. Renders take minutes. Don't render until asked.
- **Dead space**: If the VO is talking, there MUST be visual support. Empty particle background doesn't count.
- **Text before speech**: Use word-level timestamps. Text appears when the word is spoken, never before.
- **Overlapping text**: Every phase must end before the next begins. Use conditional rendering.
- **Subtitle syndrome**: Don't show every word being spoken. Show the KEY phrases that land the idea.
- **Ignoring the brand**: If there's an existing visual identity, match it. Don't make up new colors/fonts.

## Design Language Discovery

When there IS an existing visual identity (website, app, brand guide):

1. Check for a Tailwind config, CSS variables, or design token file
2. Pull the exact color palette, font stack, and spacing scale
3. Look for logo assets (SVG preferred) and textures
4. Match the overall tone (dark/light, minimal/rich, organic/geometric)

When there ISN'T:

1. Ask the user for 2-3 reference videos or images that capture the vibe
2. Establish a color palette together (propose options, get feedback)
3. Pick fonts that match the tone — editorial serif for gravitas, geometric sans for tech, mono for code/engineering
4. Agree on a background treatment before building anything

## Remotion Specifics

- Default composition: 1920×1080, 30fps
- `<Sequence from={frame} durationInFrames={dur}>` for beat placement
- `<Audio startFrom={frame} endAt={frame}>` for VO segment playback
- `<OffthreadVideo>` for demo clips (better than `<Video>` for rendering)
- `spring()` for organic motion, `interpolate()` for linear/eased
- `useCurrentFrame()` is local to the Sequence — frame 0 = Sequence start
- `staticFile()` for assets in `public/`
- `npx remotion studio` for live preview (hot-reloads on save)

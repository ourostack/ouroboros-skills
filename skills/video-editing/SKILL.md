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

## Understanding Raw Footage

Before editing, you need to understand exactly what's in each clip, second by second. You can't watch video — but you can look at extracted frames.

### Frame Extraction

Extract 1 frame per second from each clip, scaled down for fast reading:

```bash
# Create organized output dirs
mkdir -p frames/clip1 frames/clip2

# Extract at 1fps, scale to 1920w for readability
ffmpeg -v error -i "clip1.mp4" -vf "fps=1,scale=1920:-1" -q:v 2 "frames/clip1/frame_%03d.jpg"
```

**1fps is the right interval.** 2fps is overkill (too many near-identical frames), and 1 frame every 2 seconds misses transitions and typed text. For a 100-second clip, 100 frames is very manageable.

**Don't re-encode source footage** to shrink it before editing. Remotion decodes the source and does its own final encode — any intermediate re-encode is generation loss for no benefit. Keep the highest-quality source.

### Building the Breakdown

Read every frame and produce a second-by-second log:

```
| Time | What's on screen |
|------|-----------------|
| 0:01-0:03 | [UI state, visible text, mouse position, what's happening] |
| 0:04 | [transition/animation/new screen] |
```

Group consecutive frames that show the same static state. Note every transition, click, typed text, loading state, and animation. Be specific — "Teams chat showing request card" is not enough; "Request card: Customer Gus, Status Live, phone 973-555-1234, View Transcript button" is.

**Write this to a file in the project folder.** You'll reference it constantly during editing, and context windows compress — if it's only in conversation history, you'll lose it.

### Parallelize with Agents

For multiple clips, launch one agent per clip to review frames simultaneously. Each agent reads its batch of frames and returns a detailed breakdown. This turns a 20-minute serial task into a 5-minute parallel one.

### What to Watch For

- **Static holds** — consecutive identical frames. These are often intentional so the viewer can read what's on screen. Don't assume they need trimming — legibility matters more than pace. Only flag if the user asks about tightening
- **Screen Studio zoom animations** — motion blur frames during transitions. Note start/end so you can decide whether to keep or trim
- **Jump cuts** — where the recording skips ahead (intentional edits the user already made)
- **Divergence from script** — the actual recording rarely matches the planned script exactly. Note differences so you can update the edit plan
- **UI text that shouldn't be there** — product names under NDA, test data, wrong branding. Flag these early

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

**Precision rule**: Always work in milliseconds internally. Whisper gives ms-precision timestamps — use them. Convert to frames only at the final step with `ms(millisec) => Math.round((millisec / 1000) * FPS)`. A tenth of a second is 3 frames at 30fps — that's visible drift. Never round timestamps to one decimal place.

## One-Shot Demo Video Workflow

Given: demo footage, locked VO script, music track. Produce: finished videos.

1. **Extract frames** (1fps) from all footage, review them, write second-by-second breakdown
2. **Generate VO** via Azure Speech (Dragon HD, SSML for rate/pitch, 48kHz, excited punctuation for energy)
3. **Run whisper-cpp** on all VO files — get millisecond-precision sentence timestamps
4. **Build VO-to-footage sync table** — for each VO sentence, identify the exact footage timestamp where that action happens. Store as `{ voStartMs, footageStartMs }` pairs in a TypeScript data file.
5. **Analyze music waveform** — find structural beats (energy builds, drops, quiet sections) at 1-second resolution
6. **Write master script + manifest** — all VO sections in one file, manifest maps sections to videos
7. **Build Remotion components** — title cards, interstitial cards (RevealCard), persona cards, demo footage wrapper, closing card, music track with ducking. Use the frontend-design skill for card design.
8. **Build compositions** — one per video. Place VO Audio components at footage sync points (not sequentially). Split VO files with startFrom/endAt when sentences need to align to different footage moments. Music plays throughout with ducking during VO.
9. **Visual QA** — render stills at key moments, check every card and footage transition
10. **Preview in studio** — user scrubs through, gives feedback, iterate
11. **Render** — only when approved

Key principles:
- **VO drives card pacing** for non-demo sections (punchy, <3s per card)
- **Footage drives VO pacing** for demo sections (VO sentences placed at footage action moments)
- **Music plays from beat 1** — never fade in over the music's own intro. Only fade out at the end.
- **No frame stays the same >3s** unless it's demo footage
- **Card text mirrors VO** — never show text before it's been said
- **Cards are editorial, not labels** — "Business is booming." not "Customer Service Agent"

## Mapping VO to Visuals

For each VO phrase, decide what the viewer sees:

- **Demo footage**: VO introduces the topic → demo appears → demo plays while VO continues
- **Kinetic typography**: Key phrases that EMPHASIZE the VO, not transcribe it
- **Chapter cards**: Brief section labels between demo groups
- **Particle/motion backgrounds**: Living visual world behind text

**Rule**: VO leads, visuals follow. Never show something on screen before the narrator has introduced it. Never show a demo for topic B while the narrator is still talking about topic A.

**Card text rule**: Text on interstitial cards must mirror what the VO is saying at that moment. Never show text that hasn't been spoken yet. Cards are visual punctuation for the VO, not labels or section headers. Avoid naming features on cards ("Customer Service Agent", "AI: Enabled") — instead reflect the narrative moment or the key phrase the VO just landed.

**Pacing rule**: No non-demo frame should stay the same for longer than 3 seconds. If the VO has a phrase longer than 3s, either break it across multiple cards or rewrite the VO to use shorter sentences. The VO drives the card pacing — write punchy VO first, then cards follow naturally.

**VO-to-footage sync rule**: Each VO sentence must be placed at the exact moment in the footage where the described action is happening. Do NOT play VO sections sequentially — place them based on the footage timeline. Use the footage breakdown (second-by-second) AND whisper word-level timestamps to align every sentence to the right visual moment. If the VO says "she uploads her knowledge files" it must start when the upload dialog appears in the footage, not before. Build a precise sentence-to-footage-timestamp mapping table before writing any composition code.

**Music-to-video sync rule**: Analyze the music's waveform at fine resolution (50ms intervals) for the first 5-10 seconds to find precise hits (dings, drops, builds). Then analyze at 1-second resolution for the full track to map structural sections. Align card transitions and scene changes to land exactly on musical hits — use ms-precision timing. A title card should cut to the next visual ON the first musical hit, not before or after. When you find a beat, adjust the card duration to match it exactly. This is the difference between amateur and professional — the viewer feels it even if they can't articulate why. Keep a map of all identified musical moments and which visual transitions they align with.

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

## Generating VO with Azure Speech

When the user doesn't have a recorded voiceover, generate one with Azure AI Speech.

### Voice selection
- **Dragon HD** (`en-US-Name:DragonHDLatestNeural`) is the top tier — LLM-based, auto-detects emotion from text
- **Dragon HD Omni** (`en-US-Name:DragonHDOmniLatestNeural`) is the newest gen
- Standard Multilingual voices are older and less expressive — avoid unless HD isn't available
- Always generate test samples with a script line before committing. Let the user listen and compare voices.

### SSML controls
- `<prosody rate="+10%" pitch="+10%">` — rate and pitch are the main levers
- Pitch max is +50% but sounds unnatural past +20%
- The real energy lever is **punctuation in the text** — Dragon HD reads emotional cues from exclamation marks, questions, etc. This is more effective than cranking pitch.
- Always output at **48kHz** (`Riff48Khz16BitMonoPcm`) — 24kHz can sound garbled

### Script → audio pipeline
1. Write a master script with named sections
2. Generate each section as a separate WAV file
3. Run whisper-cpp on each for word-level timestamps
4. Compare VO durations against footage durations — trim VO text if too long, rather than freeze-framing or padding footage

### Multi-video projects
Use a **master script + manifest** pattern: all VO sections live in one file, a manifest maps which sections go in each video. Edit once, applies everywhere. Only create variant sections (e.g. `INTRO-FULL` vs `INTRO-ESCALATION`) where the context genuinely differs.

## Music Mixing

### Track selection
- Music has a beginning and end — you can't just chop it randomly or loop it blindly
- Prefer ambient/loop-friendly tracks for demo videos (no strong arc)
- One track works across multiple videos — cut to each video's length

### Waveform analysis
- Use ffprobe to analyze volume/energy across the track
- Find natural quiet points for cuts and fades rather than chopping arbitrarily
- Fade in at start (2-3s), fade out at end (3-5s) if the track has a strong intro/outro

### Ducking
- Lower music volume when VO is playing, bring it back up during silent/demo sections
- Use whisper timestamps to know exactly when VO is active
- In Remotion, control audio volume per frame with `interpolate()` on the volume prop

## VO-to-Footage Timing

Before wiring audio into compositions, build a timing table:

| Section | VO Duration | Footage Duration | Gap |
|---------|-----------|-----------------|-----|

- **VO shorter than footage** — ideal. Footage breathes after VO finishes. The viewer reads what's on screen.
- **VO longer than footage** — problem. First try trimming the VO text. Let the footage show the detail; the VO doesn't need to narrate everything visible. If still too long, freeze-frame at a natural hold point (a results screen, a completed state).
- **No footage (interstitial/title)** — VO duration determines the card duration. Add 1-2s padding.

## VO-to-Footage Sync Mapping (THE MOST IMPORTANT STEP)

Before writing any composition code, build a **sentence-to-footage mapping table**. This is the single most important step in the editing process. Without it, VO will drift from what's on screen.

### How to build the table

1. Get sentence-level timestamps from whisper for each VO section
2. Open the footage breakdown (second-by-second) side by side
3. For each VO sentence, find the footage timestamp where that action STARTS happening
4. Write it down as: `{ voStart: X, footageStart: Y }` — where X is seconds into the VO file, Y is seconds into the footage file
5. Store this in a TypeScript data file that the compositions import

### The offset trick

VO sections are separate audio files. Each starts at 0. But within a composition, they need to play at specific absolute frame numbers. The formula:

```
absoluteStartFrame = clipStartFrame + s(footageStart)
```

For VO sentences within a section, use `<Audio startFrom={s(voStart)}>` to skip to the right sentence.

### Common mistakes

- Playing VO sequentially from clip start — causes drift. Each sentence must be placed independently.
- Eyeballing sync — always use the footage breakdown timestamps. "About 30 seconds in" is not good enough.
- Forgetting that footage has its own pacing (holds, animations, transitions) — the VO must respect these visual beats, not fight them.

### When VO and footage don't align

If a VO sentence describes something that happens much later in the footage, you have three options:
1. **Leave silence** — let the footage play without narration until the right moment, then start the VO sentence
2. **Split the VO into separate Audio components** — one per sentence or group, each placed at the right frame
3. **Re-record/regenerate** the VO with different pacing

Option 2 is the most flexible and what you should default to for demo videos.

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

## Timing Reference Document (WRITE THIS FIRST)

Before touching composition code, write a `timing-reference.md` file in the project folder with ALL of the following:

1. **Every VO file's sentence timestamps** — copy from whisper JSONs in a readable table
2. **Every footage clip's second-by-second breakdown** — summarize key moments
3. **VO-to-footage sync map** — for each VO section, where it starts (absolute ms), what footage it covers
4. **Music structural beats** — from waveform analysis, with ms precision
5. **The complete timeline** — every section's start time, duration, and frame count
6. **voRanges for ducking** — every VO range in absolute ms

This file is your single source of truth. Context windows compress — if timings are only in conversation history, you WILL lose them and introduce drift. Write them down, reference the file, update it when you make changes.

## VO Placement Strategy

Not all VO sections need the same treatment. Choose based on how VO pacing relates to footage pacing:

### The "VO denser than footage" problem

This is the most common timing problem. The VO spends 8 seconds describing an agent response, but the footage only shows it for 2 seconds before moving to the next action. If you play the VO as one continuous track, it falls hopelessly behind the footage — the VO is talking about the greeting while the footage shows the pricing response.

**Diagnosis:** Compare VO duration per action vs footage duration per action. If the VO takes 3x longer to describe something than the footage shows it, you have a density mismatch.

**Fix: Multiple short freezes on the actual footage.** Pause the demo video at key moments (max 3s each) while the VO narrates what's on screen. The VO plays continuously; the footage pauses to let it catch up. Never use static screenshots before footage — showing a screenshot then cutting to the same footage looks jarring.

```
WRONG:  [--- 23s VO as one track, no freezes ---]
        VO drifts 8+ seconds behind by mid-clip

ALSO WRONG: [screenshot freeze] → [footage starts]
            Looks weird — same image twice in a row

RIGHT:  [play] [freeze 2.5s] [play] [freeze 3s] [play] [freeze 3s] [play]
        footage 0:00-0:04  0:04     0:04-0:07  0:07     0:07-0:10  0:10     0:10+
        VO plays continuously — freezes absorb the 8s density gap
```

### Freezing footage with Remotion's Freeze component

Use `<Freeze frame={0}>` to hold a video frame while the VO narrates over it:

```tsx
// Freeze at footage 0:07 for 3 seconds
<Sequence from={freezeStart} durationInFrames={s(3)}>
  <Freeze frame={0}>
    <DemoFootage src="footage/clip.mp4" startFrom={s(7)} />
  </Freeze>
</Sequence>
```

Rules for freezes:
- **Max 3 seconds per freeze** — longer feels broken, not intentional
- **Use multiple freezes** (2-4) spread across the clip rather than one long one
- Freeze at moments where the on-screen content is worth reading (a response, a score, a result)
- The VO should be actively narrating during the freeze — silence + freeze = dead air
- Build a `fToC(footageSec)` helper that maps footage timestamps to composition frames accounting for all freezes — use this for ALL VO placements after the freeze points
- Also useful for "let the viewer read this": freeze on a scores dashboard, a detail modal, etc.

### Split into sentence-level blocks (more precise)
Use when the footage has large gaps between described events (transitions, typing, waiting states). Each VO block is placed at the exact footage timestamp where the action happens.

**Example:** An AI-assisted resolution VO where the agent interaction has 10-15 second gaps between events (agent processing, reading responses). Split into blocks: "asks about discounts" at footage 0:53, "asks about gift packages" at footage 1:09, etc.

### Sequential placement after previous section
Use when multiple VO sections narrate the same footage clip. Place each section AFTER the previous one ends, with a small gap (~0.5-2s).

**Example:** Customer conversation VO (23s) followed by escalation VO (13s) over the same clip. Start escalation at customerConvo end + 0.7s gap. Verify the footage at that moment matches what the VO describes.

### Dramatic pauses via VO splitting

To add editorial breathing room (e.g., a pause before a punchline), split the VO file and insert dead space:

```tsx
// "Better documents in, better AI out." [pause] "Early engineering preview."
<Sequence from={clip3Start} durationInFrames={DOC_SPLIT}>
  <Audio src={staticFile("vo/doc-eval.wav")} endAt={DOC_SPLIT} />
</Sequence>
<Sequence from={clip3Start + DOC_SPLIT + s(2)} durationInFrames={VO.docEval - DOC_SPLIT}>
  <Audio src={staticFile("vo/doc-eval.wav")} startFrom={DOC_SPLIT} />
</Sequence>
```

Find the split point in the whisper timestamps — always split at a sentence boundary (after a period).

### Always verify no overlaps programmatically

**Never eyeball VO placement.** After building the timeline, run a verification script that prints every VO block's start/end and checks gaps:

```js
// Print and verify in Node
voRanges.sort((a,b) => a.startFrame - b.startFrame);
for (let i = 0; i < voRanges.length - 1; i++) {
  const gap = voRanges[i+1].startFrame - voRanges[i].endFrame;
  if (gap < 0) console.error('OVERLAP at range', i, ':', gap, 'frames');
}
```

If any gap is negative, you have an overlap. Fix it before proceeding.

## The ms()/s() Double-Conversion Trap

**CRITICAL**: If you define VO durations using `ms()` (which converts milliseconds to frames), those values are ALREADY IN FRAMES. Do NOT then use `s()` on them — that would multiply by FPS again (a 30x error).

```tsx
// WRONG — double conversion
const VO_DUR = ms(9600);           // = 288 frames
const dur = s(VO_DUR);             // = s(288) = 8640 frames (288 SECONDS!)

// RIGHT — ms() already returns frames
const VO_DUR = ms(9600);           // = 288 frames
const dur = VO_DUR;                // = 288 frames ✓

// Also RIGHT — use s() only on raw seconds
const dur = s(9.6);                // = 288 frames ✓
```

Pick ONE unit convention and stick with it. Recommended: define all VO durations with `ms()` at the top, use the frame values directly everywhere else. Comment every constant with its unit.

## Whisper Endpoint vs Actual File Duration

Whisper's last token timestamp is NOT the audio file's duration. The audio file typically has 200-400ms of tail after the last detected word (the final consonant's decay, room tone, etc.). If you use the whisper endpoint as your `durationInFrames`, you cut off the end of the last word.

```bash
# Always check actual file duration
ffprobe -v error -show_entries format=duration -of csv=p=0 vo/one-more-thing.wav
# → 1.608s (whisper says 1.300s — 300ms of audio you'd lose!)
```

**Rule:** For `durationInFrames` on VO Sequences, use the actual WAV file duration from `ffprobe`, not the whisper last-token timestamp. Use whisper timestamps only for `startFrom`/`endAt` when splitting within a file (those need sentence-boundary precision, not file-end precision).

## Music Track Length

After computing your composition's total duration, verify the music track is long enough to cover it:

```js
console.log('Composition:', totalDuration/FPS, 's');
console.log('Music track: 133s — ' + (133 > totalDuration/FPS ? 'OK' : 'TOO SHORT'));
```

If the original track is too short, you need a looped version. But looping can flatten dynamics — listen to it. The MusicTrack component's fadeout is computed from `totalDurationFrames`, so it will try to fade at the end regardless of whether the music has already ended. Silence + fadeout = nothing audible = abrupt music ending well before the video ends.

## Music Waveform Analysis

Analyze the music track at 50ms resolution for the first 10-15s to find precise hits:

```bash
ffmpeg -v error -i track.m4a -ss 0 -t 15 -af "aresample=1000,asetnsamples=n=50" -f wav - | \
python3 -c "
import sys, struct, math
data = sys.stdin.buffer.read()
samples = data[44:]  # skip WAV header
chunk_size = 100     # 50 samples * 2 bytes = 50ms chunks
for i in range(0, len(samples), chunk_size):
    chunk = samples[i:i+chunk_size]
    if len(chunk) < 4: break
    vals = struct.unpack(f'<{len(chunk)//2}h', chunk)
    rms = math.sqrt(sum(v**2 for v in vals) / len(vals)) if vals else 0
    db = 20 * math.log10(rms / 32768) if rms > 0 else -96
    print(f'{(i // chunk_size) * 50}ms: {db:.1f}dB')
"
```

Look for: silence (-60dB+) followed by sharp attack (-15dB or louder) = a "ding" or "hit." These are your visual cut points.

### RMS vs Peak — why RMS misses dings

RMS (root mean square) averages energy over a window. A short percussive hit (a bell ding, a cymbal tap) can have a massive peak but low RMS because the energy is concentrated in a few milliseconds. **Always use peak amplitude analysis for finding dings/hits**, not RMS.

```bash
# Peak analysis at 5ms resolution — catches percussive transients
ffmpeg -v error -i track.m4a -ss 2.5 -t 2 -af "aresample=8000" -f wav - | \
python3 -c "
import sys, struct, math
data = sys.stdin.buffer.read()
samples = data[44:]
window = 40  # 40 samples at 8kHz = 5ms
for i in range(0, len(samples) - window*2, window*2):
    chunk = samples[i:i+window*2]
    vals = struct.unpack(f'<{window}h', chunk)
    peak = max(abs(v) for v in vals)
    peak_db = 20 * math.log10(peak / 32768) if peak > 0 else -96
    t_ms = 2500 + (i // (window*2)) * 5
    print(f'{t_ms}ms: {peak_db:.1f}dB')
"
```

### Anatomy of a ding

A percussive "ding" has three phases:
1. **Attack** (1-10ms): Peak amplitude spike. The loudest moment.
2. **Resonance** (50-300ms): Ring/sustain as the sound decays. Multiple peak transients.
3. **Landing** (at decay end): Where the ring fades to silence. This is the **perceptual landing point**.

**The visual cut should land AFTER the ding, not before or during it.** If the music is being ducked for VO, and the VO starts when the cut happens, the duck ramp will eat the ding. The ding must ring out at full music volume FIRST, then the cut happens, then the VO begins.

Calculate: ding resonance end frame + duck ramp frames = earliest safe cut frame.

```
ding attack:     frame 119 (3970ms)
resonance ends:  frame 122 (4060ms)
duck ramp:       10 frames
earliest VO:     frame 132
safe cut:        frame 135 (gives 3-frame margin)
```

Cutting BEFORE a ding kills it. The music ducks when VO starts — if the VO starts before the ding, the duck ramp silences the beat. Always let the beat land, then transition.

### Timecode formats

Remotion studio displays time as SS:FF (seconds:frames), not decimal seconds. When the user says "3:26" they mean 3 seconds and 26 frames = `3 * FPS + 26` frames, NOT 3.26 seconds. Always clarify or compute both:
- "3:26" at 30fps = frame 116 = 3.867s
- "3.26s" = frame 98

When writing code, use `N * FPS + F` for SS:FF values to make the format explicit.

## Taste: Editorial VO Splits Around Visual Moments

VO doesn't have to play continuously. Splitting VO around a visual moment (a zoom, a transition, a reveal) creates dramatic punctuation. The silence between VO phrases lets the visual breathe.

**Example:** "Early engineering preview," [silence — zoom-in happens] "more to come."

The VO phrase before the visual sets it up. The visual lands in silence. The VO phrase after punctuates it. This is the difference between narration and storytelling.

### Implementation pattern
1. Find the visual moment's footage timestamp (e.g., zoom at 0:23-0:24)
2. Find the VO split point in whisper timestamps (comma, period, natural pause)
3. Place VO part A so it ENDS when the visual starts
4. Place VO part B so it STARTS when the visual finishes
5. The gap between parts = the visual moment's duration

```tsx
// "early engineering preview," ends → zoom → "more to come."
const doc2a = { at: clip3Start + s(23) - doc2aDur, dur: doc2aDur };  // ends at zoom start
const doc2b = { at: clip3Start + s(24), dur: doc2bDur };             // starts at zoom end
```

### Whisper word timestamps need buffer

Whisper's word-level `offsets.from` can be 50-100ms late relative to the actual audio onset. When splitting VO at word boundaries, **back up the startFrom by 200-400ms** to capture the breath/onset before the word. A too-tight split cuts off the beginning of words — the user hears "come" instead of "more to come."

## VO-Music Mix Balance

VO must always sit clearly above the music. Err on the side of VO too loud — it's a narrated demo, not a music video.

Starting points:
- **VO volume: 3.5x** (Remotion `volume` prop)
- **Music full: 0.10** (when no VO is playing)
- **Music ducked: 0.02** (when VO is active)
- **Duck ramp: 10 frames** (333ms transition)

If the user says VO is hard to hear, bump VO volume first (cheaper than re-recording). Only lower music if VO clipping becomes an issue. The music should feel like atmosphere, not competition.

Example from a real track:
```
3000ms: peak -1.9dB  ← attack (sharp transient)
3165ms: peak -6.6dB  ← resonance (ring)
3225ms: peak -9.5dB  ← resonance (fading)
3260ms: peak -24.6dB ← landing (ring finished) ← CUT HERE
```

## Common Mistakes to Avoid

### Timing & audio (the ones that waste hours)
- **s()/ms() double-conversion**: The #1 timing bug. `ms()` returns frames. Never pass its result to `s()`. See section above.
- **Whisper endpoint as file duration**: Whisper's last token != end of audio. Use `ffprobe` for actual WAV duration. See section above.
- **VO overlaps**: When multiple VO sections play over the same footage, verify each starts AFTER the previous ends. Print the timeline and check gaps programmatically.
- **VO denser than footage**: VO takes 8s to describe what footage shows in 2s. Fix with freeze frames + split VO — don't play one long VO track and hope it syncs. See "VO denser than footage" section.
- **Keeping timings in your head**: ALWAYS write a timing reference document. Future sessions (and context compression) will lose anything not written down.
- **Guessing music beats**: "The ding is at ~4s" is not good enough. Analyze the waveform at 50ms resolution. A beat you place by ear can be 500ms off — that's 15 frames of visible desync.
- **Music track too short**: Always verify the music file is longer than your composition. A looped version may flatten dynamics — listen to it.
- **voRanges stale after VO changes**: Every time you move, add, split, or remove a VO block, rebuild ALL voRanges. Stale ranges = music ducked at wrong times or not ducked when VO is playing.

### Creative & workflow
- **Timing math spirals**: Don't calculate frame numbers in your head. Write code, run a verification script, check in studio.
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

## Visual QA Loop

You cannot watch video — but you CAN render stills and look at them. **Do this constantly.**

```bash
npx remotion still src/index.ts CompositionId stills/check.png --frame=60
```

Then read the PNG to see what it looks like. Check every component (title cards, interstitials, persona cards, closing cards, demo footage) before moving on.

**4K gotchas**: Everything needs to be much larger than you'd think. Font sizes, avatars, logos, spacing — all need to be roughly 2-3x what looks right for 1080p. Render a still, look at it, adjust. Don't guess.

## Remotion Specifics

- **Symlinks don't work** in `public/` — Remotion's static file server returns 404. Copy files instead.
- **Node version**: Remotion's rspack binding may not work with the latest Node. Test early with `npx remotion studio`. Node 20 is a safe bet.
- Default composition: 1920x1080, 30fps (use 3840x2160 for 4K)
- `<Sequence from={frame} durationInFrames={dur}>` for beat placement
- `<Audio startFrom={frame} endAt={frame}>` for VO segment playback
- `<OffthreadVideo>` for demo clips (better than `<Video>` for rendering)
- `spring()` for organic motion, `interpolate()` for linear/eased
- `useCurrentFrame()` is local to the Sequence — frame 0 = Sequence start
- `staticFile()` for assets in `public/`
- `npx remotion studio` for live preview (hot-reloads on save)

---
name: video-editing
description: Plan and produce demo, presentation, and product videos across Final Cut Pro, Premiere, Remotion, and hybrid workflows. Use when the user asks to create, edit, or fix video content. Covers script-first story design, footage breakdowns, edit packets, VO sync, motion graphics, audio, and visual QA.
---

# Video Editing

## 1. OVERVIEW

This skill guides the creation of polished demo, presentation, and product videos. It supports human-led NLE edits in Final Cut Pro or Premiere, agent-led Remotion compositions, and hybrids where the human owns the timeline while the agent supplies selects, graphics, audio, captions, and timing evidence.

Choose the production seat and story order before building. Narrative-led films usually lock the outline and script before footage and timing. Footage-led walkthroughs start from the source recording. The later phases are Understand Footage, Voiceover, Music, Build Reference Docs, Build or Package Visuals, Beat-Sync and Taste, and QA and Render.

**The single most important principle**: write everything down. Context windows compress. If timings, breakdowns, or sync maps exist only in conversation history, they will be lost. Every phase produces a file.

**The second most important principle**: VO is narration, not background audio. Every VO sentence must match what's on screen at that exact moment. If the footage shows a website chat, the VO must describe the website chat — not something happening off-screen. If the footage cuts to a different perspective, the VO must go silent or describe the new perspective. Render a still at every VO placement frame and verify. No exceptions.

## 2. PROJECT STRUCTURE

```
project-root/
├── PROJECT.md               <- entry point (creative brief, constraints, status)
├── edit-packet.md           <- NLE-led source selects, timecodes, overlays, and assembly notes
├── timing-reference.md      <- Remotion/audio timing source of truth (see Phase 5)
├── media/                   <- production footage, audio, and design assets
│   ├── footage/             <- clips + breakdown.md
│   ├── vo/                  <- wavs + timestamps/ + timestamps.md + master.md + manifest.md + generate-vo.py
│   ├── music/               <- tracks + analysis.md
│   └── assets/              <- design files + style-reference.md
├── demo-sources/            <- archival originals (not consumed by Remotion)
├── output/                  <- rendered finals and review proxies
├── graphics/                <- alpha overlays, title cards, and export-ready motion assets
├── fcp/                     <- optional FCPXML, marker lists, and editor handoff files
└── remotion-demo/           <- optional code-only graphics or full composition
```

**Why this layout:**

- **`media/` contains production assets.** When Remotion is used, make it the publicDir so `staticFile()` resolves against the same tree. Configure in `remotion.config.ts`: `Config.setPublicDir("../media")`.
- **`demo-sources/` is archival.** Raw screen recordings, original exports, reference clips. These are NOT in `media/` because Remotion would index them, slowing studio startup and bloating renders.
- **Each subdirectory has its own reference doc alongside the files it describes.** `footage/breakdown.md`, `vo/timestamps.md`, `music/analysis.md`, `assets/style-reference.md`. These are deep-dive docs for verification. The agent's primary reference is `timing-reference.md` at the root.
- **`remotion-demo/` is optional.** Use it for a full Remotion-led edit or for isolated graphics and alpha overlays in an NLE-led project. Components, compositions, and utilities live here. No media files.

## 3. PHASE 1: DISCOVERY — Establish the Story and Production Seat

Before touching code or building a timeline, gather the unanswered project facts. Do not repeat questions the user has already answered. If the audience, editor, duration, source footage, and reference are clear, record them and move.

### Assets & materials
- **Voiceover**: Is there a recorded VO? What format? Where is it?
- **Demo footage**: Are there screen recordings or video clips? How many? What do they show?
- **Brand assets**: Logos, icons, textures? Is there an existing website, design system, or brand guide?
- **Music**: Is there a background music track, or should we find/add one?

### Creative direction
- **Reference videos**: Ask for examples. "Kinetic typography" means wildly different things to different people. Get a link, screenshot, or description.
- **Design language**: Is there an existing visual identity to match? (Website, app, slide deck?) If so, pull the color palette, fonts, and tokens from that source. **Never invent a parallel brand.** If there ISN'T one, ask for 2-3 reference images, establish a palette together, and agree on background treatment before building.
- **Audience & venue**: Where will this be watched? Teams screen-share needs larger text and higher contrast than a Vimeo embed.

### Constraints
- **Duration**: Hard limit or target?
- **Pacing**: Continuous VO or pauses for footage to breathe?
- **Demo handling**: Pre-trimmed or expect you to trim? How sacred are they?

### Tone
- **Energy level**: Meditative? Punchy? Cinematic?
- **Text role**: Editorial emphasis at key moments, or explanatory narration alongside VO?

Proceed once the material unknowns are settled. Do not gate obvious preparation behind another interview.

### Choose the production seat

Name who owns the editorial timeline before building anything:

**Final Cut Pro-led or Premiere-led.** The human editor owns the timeline, final cuts, speed ramps, and taste. The agent prepares a low-friction edit packet: script drafts, footage breakdowns, source selects with exact in/out points, marker lists, contact sheets, crop instructions, freeze recommendations, caption files, separate VO/music stems, and export-ready graphics. Render motion graphics with transparency when useful. Do not build a competing full Remotion edit unless the user asks for one.

**Remotion-led.** The agent owns the composition, timing, motion, audio placement, renders, and revision loop. The human reviews story and taste.

**Hybrid.** The human assembles in the NLE. The agent uses Remotion or ffmpeg for title cards, magnifiers, diagrams, overlays, freeze clips, audio mixes, captions, and repeatable exports.

Record the chosen seat in `PROJECT.md`. It can change, but do not silently switch editors mid-project.

### Script-first or footage-first

Use **script-first** for narrative product films, hackathon demos, launch videos, explainers, and any story where the argument matters more than preserving a source recording. Lock the outline first. Draft the script next. Build the production storyboard after the human is happy with the story. A style reference supplies visual grammar, not the new film's runtime or asset inventory.

Use **footage-first** for product walkthroughs, rebrands, customer demos built around an existing recording, and edits where the source footage constrains the story. Break down the footage before rewriting narration.

Do not use an animatic to settle a story the human has not read. A motion study is fine for proving a visual treatment, but label it internally and keep it out of the main review path until the script is ready.

### Technical hackathon demos: earn the so what

A technical audience may understand the mechanism and still miss how to use it. Give the practical model enough time:

1. Establish the familiar baseline and the problem.
2. Explain the operating model in concrete terms.
3. Show one complete worked example.
4. Name the behavior the audience should copy in its own work.
5. End on proof, expansion, or the next capability.

For agent demos, explain how to delegate: give the agent an outcome, constraints, and the human decisions to retain. Show the agent doing routine work without handholding. Show what information reaches the human, what the decision authorizes, and what happens on approval and rejection. Approval count is not the payoff. Useful autonomy with deliberate human judgment is.

### Low-token collaboration

When the human is token constrained or editing directly in an NLE, move detail into files instead of chat. Keep the conversation for story, wording, and taste. Prepare the source selects, frame sheets, edit packet, overlays, stems, captions, and exact paths without asking the human to supervise the mechanics.

Open the one artifact that needs judgment. Do not make the human review scaffolding, implementation notes, failed experiments, or process history. Keep iteration scars in git history and task records, not in the clean creative brief or script.

### Working backwards from constraints

If the video has a time limit, anchor the ending first:
1. Lock the closing VO timing (it can't move)
2. Lock the thesis/climax timing
3. Lock demo durations (full or near-full)
4. Whatever's left is the opening

## 4. PHASE 2: UNDERSTAND FOOTAGE — Frame Extraction & Breakdowns

You cannot watch video — but you can look at extracted frames.

### Frame extraction

Extract 1 frame per second from each clip, scaled for fast reading:

```bash
mkdir -p frames/clip1 frames/clip2
ffmpeg -v error -i "clip1.mp4" -vf "fps=1,scale=1920:-1" -q:v 2 "frames/clip1/frame_%03d.jpg"
```

**1fps is the right interval for the initial overview, but 1fps timestamps are NEVER accurate enough for VO placement.** They tell you WHAT happens, not exactly WHEN. A 1fps frame showing "toggle ON" could mean the toggle happened anywhere during that second. Always refine at 10fps before using a timestamp for VO placement. 2fps produces too many near-identical frames. 1 frame every 2 seconds misses transitions. For a 100-second clip, 100 frames is very manageable for the overview.

**Do NOT re-encode source footage** to shrink it. Remotion decodes the source and does its own final encode — any intermediate re-encode is generation loss for no benefit.

### Targeted high-precision extraction (sync points only)

1fps gives 1-second precision — good for an overview but **too lossy for VO-to-footage sync**. At 60fps, 1 second = 60 frames of potential drift. But extracting every clip at 10fps or higher produces thousands of frames to review — overkill for static holds.

**The balance: targeted extraction at sync points.** After the initial 1fps pass, identify the ~10-15 specific moments that compositions will reference (freeze points, VO placement landmarks, transitions). Then extract a 2-3 second window around each at 10fps:

```bash
# Extract 10fps for a 2-second window around a sync point (e.g., footage 0:07)
ffmpeg -v error -i "clip2.mp4" -ss 6 -t 2 -vf "fps=10,scale=1920:-1" -q:v 2 "frames/clip2-sync-07/frame_%03d.jpg"
```

This gives 100ms precision exactly where it matters. ~12 windows x 20 frames = ~240 frames total — minimal cost, maximum value.

**What needs sub-second precision:**
- Freeze points — determines what frame the viewer stares at for 3 seconds
- VO placement landmarks — when does the action the VO describes actually start?
- Transition boundaries — when does a zoom/cut/animation begin and end?

**What stays at 1-second precision:**
- Static holds (nothing changes for 3-10 seconds)
- Typing sequences (gradual, no hard sync point)
- Loading states

Update `breakdown.md` with sub-second timestamps for sync points: `0:06.8` not `0:07`.

### Building the breakdown

Read every frame and produce a second-by-second log (refined at sync points). Write it to `media/footage/breakdown.md`:

```
| Time | What's on screen |
|------|-----------------|
| 0:01-0:03 | [UI state, visible text, mouse position, what's happening] |
| 0:04 | [transition/animation/new screen] |
```

Group consecutive static frames. Note every transition, click, typed text, loading state, animation. Be specific — "Teams chat showing request card" is not enough; "Request card: Customer Gus, Status Live, phone 973-555-1234, View Transcript button" is.

### Parallelize with agents

For multiple clips, launch one agent per clip. Each reads its batch of frames and returns a detailed breakdown. 20-minute serial task becomes 5-minute parallel.

### Map scene changes and cutaways

Before placing ANY VO, identify every moment the footage changes perspective, scene, or context. These are the moments where VO timing goes wrong if you're not careful.

Examples of scene changes to map:
- Website view → Teams view (different application)
- Split view appearing/disappearing
- Brief cutaway to customer's perspective then back
- Zoom transitions that change what's visible
- Jump cuts that skip time

Write these in the breakdown with exact timestamps. When placing VO later, check every sentence against this map: does the VO describe what's visible during this scene, or a different scene?

### What to watch for

- **Static holds** — often intentional for legibility. Don't trim unless asked.
- **Screen Studio zoom animations** — motion blur frames during transitions. Note start/end.
- **Jump cuts** — intentional edits the user already made.
- **Divergence from script** — actual recording rarely matches planned script exactly.
- **UI text that shouldn't be there** — NDA names, test data, wrong branding. Flag early.

## 5. PHASE 3: VOICEOVER — Generation, Transcription, Timestamps

### Generating VO with Azure Speech

When the user doesn't have a recorded voiceover:

- **Dragon HD** (`en-US-Name:DragonHDLatestNeural`) is top tier — LLM-based, auto-detects emotion from text.
- **Dragon HD Omni** (`en-US-Name:DragonHDOmniLatestNeural`) is newest gen.
- Avoid Standard Multilingual voices (older, less expressive).
- Always generate test samples before committing. Let the user compare.

If the user doesn't have a recorded VO, a ready-to-use Azure Speech generation script is bundled at `generate-vo.py` alongside this skill file. Copy it into the project's `media/vo/` directory, edit the SECTIONS dict with the script text, and run. See the docstring in that file for config notes (supported SSML, voice settings, gotchas).

**Auth: Use Entra ID, not API keys.** Azure Cognitive Services resources should have local auth (API keys) disabled. Authenticate with `DefaultAzureCredential` from `azure-identity`:

```python
from azure.identity import DefaultAzureCredential
import azure.cognitiveservices.speech as speechsdk

token = DefaultAzureCredential().get_token("https://cognitiveservices.azure.com/.default").token
config = speechsdk.SpeechConfig(endpoint="https://<custom-domain>.cognitiveservices.azure.com/")
config.authorization_token = token  # raw token, no prefix
```

Requirements: `pip install azure-identity`, a custom domain on the Speech resource, and `Cognitive Services Speech User` role assigned to the calling identity. This is the preferred auth pattern for all Azure resources — never hardcode or commit API keys.

**Generate per-sentence, not per-section.** Long single-file TTS generations produce clicking artifacts at sentence boundaries. Generate each sentence as its own WAV file (e.g., `setup--toggle.wav`, `setup--summary.wav`). Benefits: no clicking, precise per-sentence placement with `placeVO()`, easy to regenerate one sentence without re-recording the whole section, and word-onset alignment (see Phase 3 transcription) becomes trivially useful.

### Pronunciation overrides

Dragon HD auto-detects pronunciation from context, but it gets ambiguous words wrong (e.g., "Live Chat" as "lɪv" instead of "laɪv"). Fixes, in order of reliability:

1. **`<sub alias="...">` (most reliable).** Forces the TTS to read a different word. Example: `<sub alias="lyve">Live</sub> Chat` — always produces "laɪv". Works inside `<prosody>` tags.
2. **`<phoneme alphabet="ipa" ph="...">` (inconsistent).** Sometimes ignored depending on surrounding sentence context. Try `<sub>` first.
3. **Respelling in text** (last resort). Changing "Live" to "Lyve" works but makes the script unreadable.

**Pronunciation varies by sentence context.** The same word with the same SSML can be pronounced differently in different sentences. Always listen to EVERY generated segment — don't assume a fix in one segment carries to another. If a word is mispronounced in some segments but not others, add the override only where needed (the override itself can change the cadence, so don't apply it unnecessarily).

### Punctuation and emotion gotchas

Punctuation is Dragon HD's primary emotion lever, but it's unpredictable:

- `!` adds energy but can also **shorten** delivery — Dragon HD rushes excited lines. "This is Lydia!!" (0.84s) was shorter than "This is Lydia!" (1.70s).
- `<emphasis level="strong">` compressed a 1.7s line to 0.79s — worse than `!!`.
- **Em-dash `—` adds a dramatic beat/pause** and generally increases duration. Useful for hero lines: "This — is Lydia!".
- **Rate adjustment can paradoxically help.** `rate="+15%"` on a short phrase gave a more deliberate, energetic delivery than `+10%` with `!!`. Higher rate forces the model to make stronger prosodic choices.
- **Always generate multiple variants for hero lines** (openers, closers, thesis statements). Vary punctuation, em-dashes, and rate. Let the human pick — Dragon HD's response to these levers is hard to predict.

**Multi-video projects**: Use a master script + manifest pattern. All VO sections in one file, manifest maps sections to videos. Edit once, applies everywhere.

### Script collaboration with the user

VO script writing is iterative. Expect multiple rounds of feedback. Use a draft document (e.g., `master-v2-draft.md`) with:
- **[NEW]** / **[CHANGED]** / **[KEPT]** annotations on each sentence
- Footage descriptions between sentences (what's on screen when this plays)
- Placement notes in composition time, not footage-relative

This lets the user read the script as a story, see what changed, and understand what's on screen at each moment — without needing to cross-reference breakdowns or timecodes. Commit the draft and let the user edit it directly. Track their changes via file modification notifications.

### Transcription with whisper-cpp

Word-level timestamps are non-negotiable. Install whisper-cpp if not present:

```bash
brew install whisper-cpp
curl -L "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin" \
  -o /tmp/ggml-base.en.bin
```

**Do NOT use Python `whisper`** — it takes 10-30 minutes for a 2-minute file. `whisper-cpp` with Metal does it in under 10 seconds.

```bash
ffmpeg -y -i input.m4a -ar 16000 -ac 1 -c:a pcm_s16le /tmp/vo-16k.wav
whisper-cli -m /tmp/ggml-base.en.bin -f /tmp/vo-16k.wav --output-json-full -of /tmp/vo-output
```

Parse the JSON: each segment has `tokens[]` with per-word `offsets.from` / `offsets.to` in milliseconds. Store in a TypeScript data file.

**CRITICAL — on-screen text timing**: Text must appear exactly when the narrator says those words. Always use word-level timestamps, never sentence boundaries.

**CRITICAL — whisper endpoint vs actual file duration**: Whisper's last token timestamp is NOT the audio file's duration. The file typically has 200-400ms of tail after the last word. Use `ffprobe` for actual duration:

```bash
ffprobe -v error -show_entries format=duration -of csv=p=0 vo/section.wav
```

Use whisper timestamps for `startFrom`/`endAt` splits within a file. Use `ffprobe` duration for `durationInFrames` on the full VO Sequence.

**Whisper word timestamps need buffer**: Whisper's `offsets.from` can be 50-100ms late relative to actual audio onset. When splitting VO at word boundaries, **back up startFrom by 200-400ms** to capture the breath/onset. A too-tight split cuts off word beginnings. Note: this buffer applies ONLY to splitting a WAV at a word boundary. When using word onsets for placement offset calculations (see below), use the raw value — the slight lateness means VO arrives before the visual, which is correct ("VO leads, visuals follow").

### Per-sentence word-onset alignment

When you have per-sentence WAV files and need a specific word to land at a specific footage moment, use Whisper word onsets to calculate the sentence's start:

```
sentenceStart = clipStart + ms(footageTimestamp) - ms(wordOnset)
```

Example: `setup--toggle.wav` says "One toggle! Customer Connect Agent — on!" Whisper says "toggle" starts at 310ms. Footage shows toggle click at 4.2s.

```ts
// "toggle" at 310ms into sentence → hits at footage 4.2s
setupVO1 = placeVO(clipStart + ms(4200 - 310), [
  { file: "setup--toggle", durMs: 3288 },
  ...
])
```

This places the sentence so "One" starts at 3.89s (while the toggle is about to be clicked), and "toggle" lands exactly at 4.2s when the click happens. Far more precise than aligning sentence boundaries to footage.

**WARNING**: This formula is only as accurate as its inputs. If the footage timestamp (4.2s) came from a 1fps breakdown, it could be off by up to 1 second. Always verify with 10fps extraction or a rendered still at the placement frame. The formula's mathematical precision can mask imprecise inputs — you get a confident wrong answer.

**When to use this technique:**
- Per-sentence WAV files (not splitting a single file)
- The sentence has a key action word that should sync to a visual moment
- The visual moment has sub-second precision from 10fps frame extraction

**When NOT needed:**
- Sequential sentences where the flow naturally carries (playground Q&A, doc eval narration)
- Intro cards where timing is flexible (no footage sync point)

### Generate first, measure, then place

**NEVER estimate VO durations from word count.** Word-count heuristics (e.g., "2.75 words/sec") are routinely 30-40% off for Dragon HD at +10% rate. A 20-word sentence estimated at 7.3s may actually be 5.1s. This compounds across a timeline and leads to false "doesn't fit" conclusions that waste hours of restructuring.

The correct workflow:
1. Write the script
2. Generate ALL audio files
3. Measure EVERY duration with `ffprobe`
4. THEN calculate placements using real numbers
5. Verify with rendered stills

Never calculate timing, check feasibility, or propose changes based on estimated durations. Generate the audio first. It takes seconds.

### Precision rule

Always work in milliseconds internally. Convert to frames only at the final step: `ms(millisec) => Math.round((millisec / 1000) * FPS)`. A tenth of a second is 3 frames at 30fps — that's visible drift. Never round timestamps to one decimal place.

**FPS-agnostic examples**: Use `ms(4500)` not `4 * FPS + 15`. The skill should work regardless of FPS setting.

## 6. PHASE 4: MUSIC — Waveform Analysis, Beat Identification, Ding Anatomy

### Track selection and length matching
- Music has a beginning and end — you can't chop it randomly or loop it blindly.
- **Never blindly loop a track** to make it longer. Looping flattens dynamics at the join and sounds amateur.
- One track can work across multiple videos — but each needs a bespoke cut to length.

### Bespoke track cutting (the right way)

The workflow: analyze first, edit video, THEN cut the music to fit.

1. **Analyze the original track** at full resolution (5ms peak). Map structural sections, find dips/transitions.
2. **Build the composition** and determine exact duration needed.
3. **Make a surgical cut** that preserves the intro and natural fadeout:

```
Original:  [INTRO 0-9s] [PLATEAU A 9-42s] [DIP] [PLATEAU B 42-76s] [QUIET 77-101s] [PLATEAU C 103-117s] [FADEOUT 118-133s]

Need 90s:  [INTRO 0-9s] [PLATEAU A 9-42s] [DIP] [PLATEAU B 42-60s] → splice to → [FADEOUT 118-133s]
                                                            ^cut at energy dip^              ^natural ending^

Need 200s: [INTRO 0-9s] [PLATEAU A 9-42s] [DIP] [PLATEAU B 42-76s] → loop back to → [PLATEAU A 9-42s] ... [FADEOUT 118-133s]
                                                                ^splice at matching energy^
```

**Splice points** are structural dips where energy briefly drops — cuts there are inaudible because the listener expects a moment of breath. Find these in the waveform analysis (look for 1s windows where RMS drops 6-10dB below surrounding plateaus).

Use ffmpeg to make the cuts:
```bash
# Extract segments and concatenate
ffmpeg -i track.m4a -ss 0 -t 60 -c copy /tmp/part1.m4a
ffmpeg -i track.m4a -ss 9 -t 42 -c copy /tmp/part2.m4a  # loop middle
ffmpeg -i track.m4a -ss 118 -c copy /tmp/part3.m4a       # fadeout
# Concatenate with crossfade at splice points
ffmpeg -f concat -safe 0 -i list.txt -c:a aac output.m4a
```

Do this AFTER the video edit is locked — the music length depends on the final composition duration.

### Waveform analysis — full track at millisecond resolution

Unlike footage (where each frame must be visually reviewed), music analysis is just math on audio samples. Analyze the **entire track at 5ms peak resolution** in one pass — it takes seconds, not minutes. No need for the targeted windowing approach used for footage.

```bash
# 5ms peak analysis for the FULL track — cheap, do it all
ffmpeg -v error -i track.m4a -af "aresample=8000" -f wav - | \
python3 -c "
import sys, struct, math
data = sys.stdin.buffer.read()
samples = data[44:]
window = 40  # 40 samples at 8kHz = 5ms
for i in range(0, len(samples) - window*2, window*2):
    chunk = samples[i:i+window*2]
    vals = struct.unpack(f'<{window}h', chunk)
    peak = max(abs(v) for v in vals)
    rms = math.sqrt(sum(v**2 for v in vals) / len(vals)) if vals else 0
    peak_db = 20 * math.log10(peak / 32768) if peak > 0 else -96
    rms_db = 20 * math.log10(rms / 32768) if rms > 0 else -96
    t_ms = (i // (window*2)) * 5
    print(f'{t_ms}ms: peak={peak_db:.1f}dB rms={rms_db:.1f}dB')
"
```

Store the full analysis in `media/music/analysis.md`. You'll reference it for every beat-sync decision.

**Why peak, not RMS, for dings**: RMS averages energy over a window. A sharp percussive hit (bell, cymbal, ding) has a massive peak but low RMS because the energy is concentrated in milliseconds. RMS will miss it entirely. Always use peak analysis for finding hits.

**Cost comparison**: Music analysis = seconds of compute, no review. Footage analysis = each frame must be read as an image. This is why footage uses targeted extraction at sync points, but music can be analyzed wall-to-wall.

Then analyze at 1-second resolution for the full track to map structural sections. Write results to `media/music/analysis.md`.

### RMS vs Peak — why RMS misses dings

RMS averages energy over a window. A short percussive hit (bell ding, cymbal tap) has a massive peak but low RMS because energy is concentrated in a few milliseconds. **Always use peak amplitude analysis for finding dings/hits:**

```bash
ffmpeg -v error -i track.m4a -ss 2.5 -t 2 -af "aresample=8000" -f wav - | \
python3 -c "
import sys, struct, math
data = sys.stdin.buffer.read()
samples = data[44:]
window = 40
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
2. **Resonance** (50-300ms): Ring/sustain as the sound decays.
3. **Landing** (at decay end): Where the ring fades to silence. The perceptual landing point.

Example from a real track:
```
3000ms: peak -1.9dB   <- attack (sharp transient)
3165ms: peak -6.6dB   <- resonance (ring)
3225ms: peak -9.5dB   <- resonance (fading)
3260ms: peak -24.6dB  <- landing (ring finished) <- CUT HERE
```

This anatomy matters for beat-sync decisions in Phase 7.

## 7. PHASE 5: BUILD REFERENCE DOCS — timing-reference.md

### The single-pass file

`timing-reference.md` is THE document an editing session needs. An agent should be able to read it ONCE and have every number needed to build or modify any composition. Subdirectory docs (`breakdown.md`, `timestamps.md`, `analysis.md`) are for deep dives and verification.

For a Final Cut Pro-led or Premiere-led project, use `edit-packet.md` as the human editor's single-pass file. Keep Remotion implementation details out of it. The editor needs composition time, source filename, source in/out, speed, crop, transition, overlay filename, VO line, and the reason the shot exists.

### What it must contain

1. **VO durations** — every file's total duration (from `ffprobe`, not whisper) and sentence timestamps
2. **VO split points** — where each VO file gets split, with ms-precision boundaries
3. **Card pacing** — every non-demo section's start time, duration, text content
4. **Music beats** — all identified hits with ms precision, which visual transitions they align with
5. **Freeze config** — which clips get freeze frames, at what footage timestamps, for how long
6. **VO placement summary** — for each composition, every VO block's absolute start frame and strategy (continuous, split, sentence-level)
7. **Mix levels** — VO volume, music full/ducked levels, duck ramp duration
8. **voRanges** — every VO range in absolute ms, for ducking computation
9. **Video manifest** — which compositions exist, their durations, which VO/footage/music they use

**Update this file every time you change timing.** Stale timing references cause drift.

### NLE edit packet

For every source clip, write one row:

| Composition time | Source | Source in/out | Picture | Treatment | Audio | Purpose |
|---|---|---|---|---|---|---|
| 0:42-0:49 | `agent-request.mp4` | 1:27.2-1:34.2 | Native approval arrives | Crop to request, 108% push | VO sentence 8 | Proves the decision reaches Teams |

Also deliver:

- a contact sheet labeled in composition time;
- 10fps frame strips around every cut, click, freeze, or UI transition;
- FCP marker CSV or FCPXML only when it genuinely saves editor work;
- separate transparent graphics, title cards, captions, VO stems, and music stems;
- a short open-decisions list limited to story and taste.

Do not hand the editor a Remotion source tree as the primary deliverable. The packet and rendered assets should be usable without reading code.

## 8. PHASE 6: BUILD COMPOSITIONS OR PACKAGE NLE ASSETS

For Remotion-led projects, build the full composition below. For Final Cut Pro-led or Premiere-led projects, build only the reusable graphics, audio, freeze clips, and exports the edit packet calls for. The NLE owns the final timeline.

### Remotion configuration

```ts
// remotion.config.ts
Config.setPublicDir("../media");
```

This points Remotion at the shared `media/` directory. `staticFile("footage/clip1.mp4")` resolves to `media/footage/clip1.mp4`.

**Symlinks don't work** in publicDir — Remotion's static file server returns 404. Copy files instead.

**Node version**: Remotion's rspack binding may not work with latest Node. Test early with `npx remotion studio`. Node 20 is a safe bet.

### Core Remotion patterns

- Default composition: 1920x1080, 30fps (3840x2160 for 4K)
- `<Sequence from={frame} durationInFrames={dur}>` for beat placement
- `<Audio startFrom={frame} endAt={frame}>` for VO segment playback
- `<OffthreadVideo>` for demo clips (better than `<Video>` for rendering)
- `spring()` for organic motion, `interpolate()` for linear/eased
- `useCurrentFrame()` is local to the Sequence — frame 0 = Sequence start
- `staticFile()` for assets in publicDir
- `npx remotion studio` for live preview (hot-reloads)

### Composition time vs footage time

In any composition with freezes, skips, or multiple clips, composition time ≠ footage time. A frame at composition second 50 might show footage second 45 (if there was a 5s skip earlier) or footage second 38 (if there were freeze frames).

Build helper functions to convert between the two:

```ts
// Footage seconds → composition frame (accounting for skip at footage 59-64)
const f = (footageSec: number) => {
  const cr = footageSec >= SKIP_TO ? footageSec - SKIP_DUR : footageSec;
  return clipStart + ms(cr * 1000);
};

// fToC for freezes
const fToC = (footageSec: number) => {
  let extra = 0;
  for (const f of freezes) {
    if (footageSec > f.footageSec) extra += s(f.durSec);
  }
  return s(footageSec) + extra;
};
```

**Always present timings to the user in composition time (MM:SS from start of video).** Footage-relative seconds are meaningless to someone watching the composition. When debugging, show both.

### The ms()/s() double-conversion trap

**CRITICAL**: If you define VO durations using `ms()` (which converts milliseconds to frames), those values are ALREADY IN FRAMES. Do NOT pass them to `s()` — that multiplies by FPS again (a 30x error).

```tsx
// WRONG — double conversion
const VO_DUR = ms(9600);           // = 288 frames
const dur = s(VO_DUR);             // = s(288) = 8640 frames (288 SECONDS!)

// RIGHT — ms() already returns frames
const VO_DUR = ms(9600);           // = 288 frames
const dur = VO_DUR;                // = 288 frames

// Also RIGHT — use s() only on raw seconds
const dur = s(9.6);                // = 288 frames
```

Pick ONE unit convention. Recommended: define all durations with `ms()` at the top, use frame values directly everywhere else. Comment every constant with its unit.

### VO audio architecture

With per-sentence WAV files (recommended), each sentence is its own `<Audio>` element in its own `<Sequence>`. No `startFrom`/`endAt` splitting needed:

```tsx
{allPlacements.map((p, i) => (
  <Sequence key={i} from={p.at} durationInFrames={p.dur}>
    <Audio volume={3.5} src={staticFile(`vo/${p.file}.wav`)} />
  </Sequence>
))}
```

Gaps between sentences let demo footage breathe silently. The VO introduces what the viewer is about to see, then goes quiet while they watch.

If you're working with a legacy single-file-per-section VO, you can split with `startFrom`/`endAt` — but per-sentence files are strongly preferred (see Phase 3).

### Freeze pattern for "VO denser than footage"

When VO takes 8s to describe what footage shows in 2s, use multiple short freezes:

```
WRONG:  [--- 23s VO as one track, no freezes ---]
        VO drifts 8+ seconds behind by mid-clip

ALSO WRONG: [screenshot freeze] -> [footage starts]
            Same image twice in a row — looks jarring

RIGHT:  [play] [freeze 2.5s] [play] [freeze 3s] [play] [freeze 3s] [play]
        VO plays continuously; freezes absorb the density gap
```

Use Remotion's `<Freeze frame={0}>`:

```tsx
<Sequence from={freezeStart} durationInFrames={ms(3000)}>
  <Freeze frame={0}>
    <DemoFootage src="footage/clip.mp4" startFrom={ms(7000)} />
  </Freeze>
</Sequence>
```

Rules for freezes:
- **Freeze at moments worth reading** (a response, a score, a summary, a reply). Long freezes are fine if the viewer is absorbing meaningful content — a 14s freeze on an AI summary while VO explains why it matters is powerful. Dead freeze on nothing is broken.
- **Use multiple freezes** spread across the clip, not one massive one with no purpose
- VO must be actively narrating during freezes — silence + freeze = dead air
- **Never show a screenshot then cut to the same footage** — it looks like a glitch
- **Freeze on clean frames only.** Extract 10fps around the freeze point and pick a frame where the cursor is settled and the UI is in a resting state. A frozen cursor mid-motion looks wrong.
- Build a `fToC(footageSec)` helper that maps footage timestamps to composition frames accounting for all freeze offsets

**CRITICAL — freeze duration changes cascade.** When you extend a freeze, every VO placed AFTER that freeze in composition time shifts later, but the footage events don't move. A sequential VO chain anchored to a previous VO's `endFrame` will silently drift away from the footage moments it's supposed to describe. After ANY freeze duration change: re-verify every subsequent VO placement against the footage. The safest pattern: anchor key VOs to footage moments using `f(footageSec)`, not to `previousVO.endFrame + gap`. Sequential chains are safe only within ~5s windows where drift doesn't matter.

### VO placement workflow (the process that prevents timing bugs)

This is the step-by-step process for placing VO over footage. Every shortcut here costs hours later.

1. **Use the footage breakdown (Phase 2) to map footage time → composition time.** Account for freezes, skips, and clip boundaries. Identify scene changes, cutaways, and perspective shifts. Know what's on screen at every second of the composition. If the breakdown is stale or approximate, extract fresh frames from the raw footage at 10fps around critical moments to verify.

2. **For each VO sentence, identify the footage moment it describes.** Find the composition time where that moment is on screen. This is the anchor.

3. **Decide: anchored or sequential?** If the events a group of sentences describe happen within ~5 seconds of each other, sequential placeVO is fine. If events are spread across 10+ seconds, anchor each sentence individually. Never assume sequential placement will land sentences at the right footage moments — verify.

4. **Generate all audio files and measure with ffprobe.** Real durations, not estimates.

5. **Calculate placements** using real durations. Check every gap: no overlaps, and no VO playing during a scene change to a different perspective.

6. **Render a still at every VO start frame.** Read the image. Confirm what's on screen matches what the VO says. This is not optional.

7. **Present the full timeline to the user in composition time (MM:SS).** Footage-relative times are meaningless to someone watching the video. When the user gives feedback with timestamps, map their comp time to footage internally — never ask them to think in footage time.

8. **Iterate.** The user will watch and give feedback. Placements will shift. This is normal. Re-verify after every change.

9. **Characters must be introduced before being named.** First VO reference to any character must establish their role: "A prospective customer, Gus, visits the website!" not "Gus visits the website!" A name without context is confusing. The pattern: "Meet Maya! She runs Whisker Wonderland." establishes the character; subsequent "Maya" is fine.

10. **Silent moments are intentional.** When footage shows a character's natural reaction (typing a response, reading something, acknowledging — "sure! take your time :)"), let it breathe with NO VO. These moments are pacing. VO should never compete with a character moment. If VO is playing over a cutaway, it must describe something OTHER than what the cutaway shows.

11. **Intro sections need beats between ideas.** Different concepts (person → product → person) need ~1s silence between them. Build the beat INTO the card's visual duration so the card stays on screen during silence. `personaCard.dur = ms(voDuration + 1000)` — not a separate gap that shows black.

### VO placement strategies

**Continuous with freezes**: VO plays as one track, footage pauses to let it catch up. Best when VO and footage describe the same sequence but at different densities.

**Sentence-level blocks**: Each VO sentence placed at the exact footage timestamp where the action happens. Best when footage has large gaps between described events. Example: "asks about discounts" at footage 0:53, "asks about gift packages" at footage 1:09.

**Sequential after previous section**: Multiple VO sections over the same clip, each placed after the previous ends with ~0.5-2s gap. **WARNING**: This is the most dangerous strategy. It looks correct in code (placeVO handles the math cleanly) but silently places sentences at wrong footage moments when the events are spread across time. Only use when events happen within ~5 seconds of each other. For events spread across 10+ seconds, anchor each sentence individually. ALWAYS verify the footage at each sentence's actual start time — do not trust that sequential placement will land at the right moment.

### Ducking implementation

Lower music when VO plays, bring it back during silent/demo sections:
- **Duck to speech, not to file.** Whisper segment boundaries include silence/pauses. Use word-level timestamps to find where words are actually spoken, and duck only during those moments. Ducking to file boundaries creates weird pumping during pauses.
- **Two-step process**: (1) sync VO to video first, (2) then build ducking from the placed VO. Never try to do both at once.
- In Remotion, control audio volume per frame with `interpolate()` on the volume prop
- For pre-mixed audio outside Remotion: detect speech from amplitude envelope or word-level timestamps mapped to final timeline positions.
- **Every time you move, add, split, or remove a VO block, rebuild ALL voRanges.** Stale ranges = music ducked at wrong times.

### Pre-mixed audio workflow (non-Remotion)

When adding audio to an existing video (e.g., rebranding an FCP/Premiere project), build a single pre-mixed audio file and mux it into the video with ffmpeg. This avoids complex NLE timeline manipulation.

**Process:**
1. **Get the silent video** — have the editor export video with no audio.
2. **Build the visual breakdown** — extract 1fps frames, log what's on screen second by second. Verify sync-critical transitions at 10fps.
3. **Generate VO per-sentence** — one WAV file per sentence. Long single-file TTS generations produce clicking artifacts. Individual files also give precise placement control. Use the bundled `generate-vo.py`.
4. **Transcribe VO** — whisper-cpp with `--output-json-full` for word-level timestamps. Use these ONLY for finding word positions within a file (e.g., aligning a specific word to a visual transition). NEVER use whisper segment boundaries as sentence boundaries — they split on arbitrary line lengths, not punctuation.
5. **Map VO sentences to video** — for each sentence, READ THE ACTUAL FRAME at the candidate placement time. Do not guess from a breakdown or trust an agent's assessment. Read it yourself, confirm the visual matches the narration, then commit the placement. This is the step you will be tempted to skip. Do not skip it.
6. **Build the VO track** — place each VO sentence file at its video position in a silent buffer matching the video duration. Verify no overlaps programmatically. Print every placement with start, end, and gap to next.
7. **Build the music track** — extend if needed with bespoke splice (preserve intro + natural fadeout). Music must cover the ENTIRE video. The natural fadeout must END at the video's end, not begin there. Verify by checking amplitude in the last 5s.
8. **Duck the music** — use amplitude detection on the placed VO track (RMS > threshold). Do NOT map whisper timestamps through placement offsets — that's indirect and error-prone. Just detect where the audio is loud. Duck only during speech, not during silence between sentences. **Critical parameters for pre-mixed ducking:**
   - **RMS window: 50ms** (not 10ms). A 10ms window tracks individual syllables and the music volume oscillates rapidly — physically uncomfortable. 50ms smooths to phrase-level detection.
   - **Hold time: 1-2s after speech ends.** Once speech is detected, keep music ducked for 1-2s after it stops. Without this, the duck envelope pumps between every word/pause within a sentence. The hold ensures music only comes back up during real gaps between VO segments.
   - **Ramp: 500ms.** Smoother than 333ms, less noticeable transitions.
   - Note: the Remotion workflow ducks per-voRange (whole sentences) and doesn't have this problem — hold time is only needed for amplitude-based detection in pre-mixed audio.
9. **Run the MANDATORY VERIFICATION GATE** (see section below) before proceeding.
10. **Mix and mux** — combine VO + ducked music, then mux into the video:

```bash
ffmpeg -y -i silent-video.mp4 -i premix-vo-music.wav \
  -c:v copy -c:a aac -b:a 320k \
  -map 0:v:0 -map 1:a:0 output.mp4
```

**Freeze frames for VO overflow:** If VO is longer than the available visual (e.g., closing text slide needs to hold while VO finishes), the best option is to **have the human extend the clip in their NLE (FCP/Premiere) and re-export** — zero quality loss. If that's not possible, use ffmpeg to freeze a frame, but note that re-encoding introduces visible quality degradation on static frames where compression artifacts are most noticeable:

```bash
# Split video at freeze point, hold frame, then append remainder
ffmpeg -y -i input.mp4 -t {freeze_start} -c copy part1.mp4
ffmpeg -y -i input.mp4 -ss {freeze_start} -frames:v 1 freeze.png
ffmpeg -y -loop 1 -i freeze.png -t {freeze_duration} -c:v libx264 -pix_fmt yuv420p -r 60 freeze.mp4
ffmpeg -y -i input.mp4 -ss {resume_point} -c copy part3.mp4
# Concatenate parts
```

### MANDATORY VERIFICATION GATE — do not skip this

Before muxing audio into video, you MUST complete this checklist. Do not ship without it.

**1. Read every placement frame.** For each VO sentence, read the actual video frame at that placement time. Confirm the visual matches the narration. Do this yourself — do not delegate to an agent and trust "MATCH." If any placement is wrong, fix it before proceeding. This is not optional.

**2. Check for overlaps programmatically.** Print every placement's start, end, and gap to next. If any gap is negative, fix it. If any gap is under 0.3s, flag it.

**3. Verify music reaches end of video.** Play the last 5s of the pre-mix. Confirm music is audible and fading naturally, not cutting off abruptly. If the music track is shorter than the video, you MUST extend it with a bespoke splice that preserves the natural fadeout — and the fadeout must END at the video's end, not BEGIN there.

**4. Verify ducking is speech-accurate.** Listen to a VO section: music should duck only while words are being spoken, not during pauses between sentences. If ducking pumps weirdly during silence, you're ducking to file boundaries instead of speech. Use amplitude detection on the placed VO track, not timestamp mapping.

**5. Verify closing sequence.** Read the last 20s of frames. Confirm: VO finishes before any non-narrated end card (logo, etc.). Music fades naturally through to the end. No abrupt silence.

### Demo footage rules

1. **Full-screen, no chrome** — `objectFit: "contain"` on dark background
2. **No text overlays on demos** — kinetic typography is for non-demo sections only
3. **No fade-in/out between demos** — hard cuts. Fades create black flashes.
4. **Respect the user's cuts** — ask before trimming
5. **Never show a demo before the VO introduces it**

### Particle/motion system

Build reusable SVG components:
- **ParticleField**: N circles with seeded PRNG, organic sin/cos drift, configurable size/opacity/blur. Optional `collapse` prop (0-1).
- **ConnectionLines**: Lines between particles within maxDistance, opacity fading with distance.
- **KineticWord**: Character-level staggered animation (rise, scale, blur modes).

Keep particles low opacity (0.1-0.4), behind text. Atmosphere, not competition.

## 9. PHASE 7: BEAT-SYNC & TASTE

### Title card cut timing

**The visual cut must land AFTER the ding, not before or during it.** If music is being ducked for VO, and VO starts when the cut happens, the duck ramp eats the ding. The ding must ring out at full volume FIRST, then cut, then VO begins.

```
ding attack:     ms(3970)
resonance ends:  ms(4060)
duck ramp:       10 frames
earliest VO:     ms(4060) + 10 frames
safe cut:        ms(4060) + 13 frames (3-frame margin)
```

Cutting BEFORE a ding kills it. The duck ramp silences the beat before it plays.

### Timecode formats: SS:FF vs decimal seconds

Remotion studio displays time as SS:FF (seconds:frames), NOT decimal seconds. When the user says "3:26" they mean 3 seconds and 26 frames = `3 * FPS + 26` frames, NOT 3.26 seconds. Always clarify:
- "3:26" at 30fps = frame 116 = 3.867s
- "3.26s" = frame 98

### VO splits around visual moments

Splitting VO around a visual moment (zoom-in, reveal, transition) creates dramatic punctuation. The silence lets the visual breathe.

**Example:** "Early engineering preview," [silence -- zoom happens] "more to come."

The phrase before sets it up. The visual lands in silence. The phrase after punctuates. This is the difference between narration and storytelling.

```tsx
// "early engineering preview," ends -> zoom -> "more to come."
const doc2a = { at: clip3Start + ms(23000) - doc2aDur, dur: doc2aDur };  // ends at zoom start
const doc2b = { at: clip3Start + ms(24000), dur: doc2bDur };              // starts at zoom end
```

1. Find the visual moment's footage timestamp
2. Find the VO split point in whisper timestamps (comma, period, natural pause)
3. Place VO part A so it ENDS when the visual starts
4. Place VO part B so it STARTS when the visual finishes
5. Gap between parts = visual moment's duration

### VO-music mix balance

There's no formula — mix balance is found by ear. But you can't hear, so use these defaults and let the user iterate.

**Starting defaults:**
- **VO volume: 3.5** (Remotion `volume` prop)
- **Music full: 0.10** (when no VO playing)
- **Music ducked: 0.02** (when VO active)
- **Duck ramp: 20 frames @60fps / 10 frames @30fps** (~333ms transition)

**The tuning process:**
1. Start with the defaults above. They're biased toward VO-loud, which is correct for narrated demos.
2. Have the user preview in studio and listen to a VO-over-footage section.
3. The user will say one of:
   - "VO is hard to hear" → bump VO volume (3.5 → 4.0 → 4.5). This is cheaper than lowering music because it doesn't affect the non-VO sections.
   - "Music is too loud during VO" → lower MUSIC_DUCKED (0.02 → 0.01).
   - "Music is too quiet during footage" → raise MUSIC_FULL (0.10 → 0.15). But be careful — this also affects the moments right before/after VO where the duck ramp transitions.
   - "Sounds good" → done.
4. VO volume and music levels are in different components (Audio `volume` prop vs MusicTrack constants), so they can be tuned independently.

**Rule of thumb:** VO should be the clear foreground. If you can't tell whether the VO or music is louder, the music is too loud. The viewer should never strain to hear the narrator.

### Mapping VO to visuals

For each VO phrase, decide what the viewer sees:
- **Demo footage**: VO introduces topic, demo appears, demo plays while VO continues
- **Kinetic typography**: Key phrases that EMPHASIZE the VO, not transcribe it
- **Chapter cards**: Brief section labels between demo groups
- **Particle/motion backgrounds**: Living visual world behind text

**Rules:**
- VO can anticipate visuals by 0.5-1s (say "in Teams" right before Teams appears). But VO must NEVER describe a scene that isn't on screen — if the footage shows a website, the VO cannot talk about Teams. Anticipation ≠ ignoring what's visible. When in doubt, render a still.
- Card text mirrors VO — never show text not yet spoken. Cards are visual punctuation, not labels.
- No non-demo frame stays the same >3 seconds. Break long VO across multiple cards.
- Music plays from beat 1 — never fade in over the music's own intro. Only fade out at end.

### MANDATORY: Render still at every VO placement

Before committing ANY composition change, for EVERY VO placement:
1. Calculate the absolute frame number
2. `npx remotion still src/index.ts CompositionId still.png --frame=N`
3. Read the image
4. Confirm what's on screen matches what the VO describes
5. If it doesn't match, fix the anchor BEFORE moving on

This is not optional. This is not "spot check a few." This is every single placement. The cost of rendering stills is seconds; the cost of wrong timing is hours of debugging and frustrated users.

### Always verify no overlaps programmatically

**Never eyeball VO placement.** Print every VO block's start/end and check gaps:

```js
voRanges.sort((a,b) => a.startFrame - b.startFrame);
for (let i = 0; i < voRanges.length - 1; i++) {
  const gap = voRanges[i+1].startFrame - voRanges[i].endFrame;
  if (gap < 0) console.error('OVERLAP at range', i, ':', gap, 'frames');
}
```

### Music track length

After computing total duration, verify the music covers it:

```js
console.log('Composition:', totalDuration/FPS, 's');
console.log('Music track: 133s - ' + (133 > totalDuration/FPS ? 'OK' : 'TOO SHORT'));
```

If the track is too short, a looped version may flatten dynamics — listen to it.

## 10. PHASE 8: QA & RENDER

### Studio preview

`npx remotion studio` — instant preview with scrubbing. Use this constantly. **Never render until the user says go.** Renders take minutes; studio preview is instant.

### Visual QA with stills

You cannot watch video, but you CAN render stills:

```bash
npx remotion still src/index.ts CompositionId stills/check.png --frame=60
```

Read the PNG to check. Verify every component: title cards, interstitials, persona cards, closing cards, demo footage transitions.

**4K gotcha**: Everything needs to be 2-3x larger than you'd think. Font sizes, avatars, logos, spacing. Render a still, look at it, adjust.

**Text card rule: 7 words max, each card stands alone.** Title cards, interstitials, and reveal cards must never exceed 7 words total. These are visual punctuation, not subtitles — the VO carries the message, the card reinforces it. If the VO sentence is long, distill to the core idea. **Each card must speak for itself** — when a new card appears, the previous card's text must not persist. Use separate `<Sequence>` blocks so each card replaces the last, never accumulates. Examples: "Remember Sam?" (2 words) → cut → "Here's how Maya set it up." (7 words). Never stack text from multiple VO sentences on the same card.

### Word-synced closing cards (subtitle-level text card timing)

For closing sequences where text cards match VO word-by-word (e.g., "Customer Connect Agent:" → "Faster resolutions." → "Happier customers." → "Ready from day one."), use Whisper word timestamps to sync each card to when the narrator says the corresponding word:

```ts
// Whisper: "faster" at 1210ms, "happier" at 2420ms, "ready" at 4300ms
const cardCC = { at: t, dur: ms(1210) };                    // "Customer Connect Agent:"
const cardFR = { at: t + ms(1210), dur: ms(2420 - 1210) };  // "Faster resolutions."
const cardHC = { at: t + ms(2420), dur: ms(4300 - 2420) };  // "Happier customers."
const cardRD = { at: t + ms(4300), dur: ms(5568 - 4300 + 800) }; // "Ready from day one." + beat
```

Each card appears at the exact moment the narrator says its first word. This creates a subtitle-level sync that feels deliberate and polished.

### FCP / Remotion division of labor

Treat Final Cut Pro as the primary editor when the user says they want to cut the film themselves. The split is not limited to multicam footage.

**Human handles in FCP:**
- Final story rhythm and taste calls
- Timeline assembly and shot order
- Multicam cuts between views (website ↔ Teams)
- Typing speed ramps (8x speedup in compose boxes)
- DOM artifact removal (accidental DevTools, console hacks)
- Agent-thinking dead time cuts
- Final reframes, transition feel, and editorial trims

**Agent prepares:**
- Script and source-grounded outline before the production storyboard
- Select reels, exact source in/out points, contact sheets, and marker lists
- 10fps frame strips around edit-critical moments
- Title cards, magnifiers, diagrams, cards, lower thirds, and closing sequences as standalone exports
- Transparent ProRes 4444 overlays when the NLE should composite the graphic
- VO generation, transcription, timestamps, and separate sentence files after script lock
- Music analysis, bespoke cuts, ducked premixes, and separate stems after picture timing is stable
- Captions, thumbnails, review proxies, QA frames, and the final evidence packet

The agent does not need to build a shadow edit to be useful. It should make the editor's next action obvious and cheap. When the human is token constrained, prepare the files and open the one script, select reel, or review proxy that needs judgment.

The human gives the agent a clean clip when possible. The agent never attempts typing speed ramps from 1fps evidence. If the human wants the agent to prepare speed-ramp guidance, extract 10fps around the exact typing boundaries and record the range in the edit packet. The human applies the ramp in FCP.

### VO audit checklist for character changes (v2 → v3)

When a composition changes characters (e.g., Maya → Sam as service rep), EVERY VO file must be audited:

1. **Transcribe all VO files** with Whisper. Don't trust filenames or memory.
2. **Check names**: "Maya asks about..." → "Sam asks about..." / "He asks about..."
3. **Check pronouns**: "She asks..." → "He asks..." (or vice versa)
4. **Check possessives**: "Maya's internal documents" → "Whisker Wonderland's internal documents" (use the business name, not the person's name, for resources that belong to the business)
5. **Check stale v2 files**: Old files like `resolution--discounts` ("Maya asks about first-time discounts") may still exist and get accidentally included. Remove them from the composition.
6. **Regenerate, don't patch**: If a file has the wrong name/pronoun, regenerate it. Don't try to edit audio.

### Bespoke music cut workflow

Music cutting comes LAST, after the edit is locked. During iteration, accept that the track will be too short — don't waste time building cuts that become stale with each freeze change.

1. Lock all VO placements, freezes, and pacing
2. Determine exact composition duration
3. Analyze the original track for structural dips (already done in `media/music/analysis.md`)
4. Splice at dips: `[0-N] + [loop section at matching energy] + [natural fadeout]`
5. Verify energy at splice points — no jarring drops
6. Wire into composition, render, verify music doesn't cut or loop audibly

### In-place footage replacement (re-exports from Screen Studio)

When the user re-exports footage from Screen Studio with different zoom animations, the file gets replaced in `media/footage/` but:
- **Duration may change slightly** — always re-check with `ffprobe` and update `s(clipDur)` in the composition
- **Zoom timing shifts mean breakdowns are stale** — re-extract frames at key moments and verify what's on screen at each VO placement. Don't trust the old breakdown.
- **Freeze points may need adjustment** — if a zoom now lands at a different moment, the freeze at that footage second may show the wrong frame
- The composition code structure stays the same, but every timing constant needs re-verification

### Session handoff

Multi-session projects WILL lose context. Before ending a session:
1. Update `PROJECT.md` with current state — what's done, what's in progress, what's next
2. List every file that needs to be generated/changed in the next session
3. Commit everything including working files and drafts
4. The next session should be able to read `PROJECT.md` and know exactly where to pick up

Use the "In Progress" section of PROJECT.md as the handoff doc, not conversation history.

### Render workflow

Only when approved:

```bash
npx remotion render CompositionId out/filename.mp4
```

## 11. REFERENCE: KINETIC TYPOGRAPHY

### It is NOT:
- Subtitles with nice fonts
- Every spoken word displayed on screen
- Text that fades in from below (that's a transition)
- Centered text on a plain background

### It IS:
- **Key phrases** that editorialize — "doing things? EASY." not the full sentence
- **Text inside an animated visual world** — particles, geometric shapes, depth-of-field
- **Graphics that ARE the concept** — "connection" shows two dots linked; "surprise" has particles exploding
- **Typography with character-level animation** — letters blur-in, snap, scale, track in sequence
- **Variety** — each phrase gets its own treatment. Never the same twice.

### Visual treatment vocabulary
- **Slam**: Spring with low damping, high stiffness — word arrives with overshoot
- **Snap**: Instant opacity 0->1, no easing. Short punchy phrases.
- **Blur-in**: Each character deblurs from 12px->0 with stagger delay
- **Terminal type**: Monospace, characters appear one at a time
- **Drift**: Slow sine-wave translateX — contemplative moments
- **Stack**: Words appear vertically, each slightly larger, building weight
- **Scale slam**: Word starts at 60%, springs to 100%
- **Rule lines**: Horizontal lines extend from text edges — diagrammatic

## 12. REFERENCE: COMMON MISTAKES

### Timing & audio (the ones that waste hours)
- **ms()/s() double-conversion**: The #1 timing bug. `ms()` returns frames. Never pass its result to `s()`.
- **Whisper endpoint as file duration**: Whisper's last token != end of audio. Use `ffprobe` for actual WAV duration.
- **VO overlaps**: When multiple VO sections play over the same footage, verify each starts AFTER the previous ends. Check programmatically.
- **VO_GAP accumulation in intro sections**: If visual cards are sized to match individual VO sentence durations (e.g., `persona.dur = ms(2736)`, `widgetHero.dur = ms(3888)`), but `placeVO` adds VO_GAP between sentences, the total VO duration exceeds the visual card sum by `(N-1) * VO_GAP`. This means the last intro VO bleeds into the next section (footage start). Fix: `t = Math.max(t, introVO.endFrame)` after sizing visual cards. With 5 sentences and 300ms VO_GAP, the overshoot is 1.5 seconds — very audible.
- **VO denser than footage**: Fix with freeze frames + split VO. Never play one long VO track hoping it syncs.
- **Keeping timings in your head**: ALWAYS write `timing-reference.md`. Future sessions will lose anything not written down.
- **Guessing music beats**: "The ding is at ~4s" is not enough. Analyze at 50ms resolution. Ear-placed beats can be 500ms off (15 frames).
- **Music track too short**: Verify music is longer than composition. Looped tracks may flatten dynamics.
- **voRanges stale after changes**: Every VO move/add/split/remove requires rebuilding ALL voRanges.
- **Cutting before a ding**: Duck ramp kills the beat. Let it ring out, THEN cut.
- **RMS for percussive detection**: Use peak analysis. RMS averages away short transients.
- **Whisper word onset precision**: Back up startFrom by 200-400ms when splitting at word boundaries.
- **Cutting VO at whisper segment boundaries, not sentence boundaries**: Whisper segments break on arbitrary line lengths, NOT sentence structure. "different types" and "of appointments" can end up in different segments. ALWAYS use word-level timestamps to find actual sentence ends (periods, exclamation marks, question marks). Never trust segment boundaries for VO splits.
- **Syncing VO to breakdown timestamps, not FCPXML math**: If you have the actual video, extract frames and build a visual breakdown. Sync VO to what you SEE, not to reverse-engineered XML offsets. FCPXML offset math is error-prone (parent-relative coordinates, NDF timecode, nested clips) and the errors compound invisibly.
- **Breakdown timestamps drift from reality**: A 1fps extraction gives frame numbers, not precise timestamps. frame_199.jpg does NOT mean the content appears at exactly 199.000s — it means the content was visible sometime during second 199. For sync-critical moments, ALWAYS verify with 10fps extraction before committing to a placement.
- **Music must cover the full video**: Never assume the original edit's music coverage is correct for the new version. Always verify: does music play from start to finish? If the track is shorter than the video, make a bespoke extension (splice at energy-matched dip, preserve natural fadeout). Never let music just stop.

### Creative & workflow
- **Timing math spirals**: Don't calculate in your head. Write code, run verification, check in studio.
- **Going silent**: Stay in conversation. If unsure, ask.
- **Rendering prematurely**: Studio preview is instant. Don't render until asked.
- **Dead space**: If VO is talking, there MUST be visual support. Empty background doesn't count.
- **Text before speech**: Use word-level timestamps. Text appears when spoken, never before.
- **Overlapping text**: Every phase must end before the next begins. Conditional rendering.
- **Subtitle syndrome**: Show KEY phrases, not every word spoken.
- **Ignoring the brand**: Match the existing visual identity. Don't invent new colors/fonts.
- **SS:FF vs decimal confusion**: Remotion studio shows SS:FF. "3:26" = frame 116 at 30fps, not 3.26s.

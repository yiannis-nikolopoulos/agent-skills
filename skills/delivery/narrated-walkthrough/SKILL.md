---
name: narrated-walkthrough
description: >
  Produces a narrated product walkthrough video (1080p MP4 with voiceover and
  subtitles) by driving the real web app with Playwright from a step-by-step
  script, voicing each step offline with Kokoro or macOS say, and placing every
  line of narration where its step really happens on screen. Use when someone
  needs a demo, training, enablement, or customer-success video of a feature
  flow, not a short clip proving an animation. Triggers on "walkthrough video",
  "narrated demo", "video with voiceover", "record a demo of", "CS video",
  "training video for", "/narrated-walkthrough".
argument-hint: '[<feature-or-flow>] [--url <base-url>] [--voice <kokoro-voice>] [--engine auto|kokoro|say|files]'
license: MIT
metadata:
  author: mthines
  version: '1.0.0'
  workflow_type: scaffolder
  tags:
    - video
    - voiceover
    - narration
    - walkthrough
    - playwright
    - text-to-speech
    - ffmpeg
    - customer-success
---

# Narrated Walkthrough

Turns one `walkthrough.json` into a finished MP4: real UI, a visible cursor, a voice, and subtitles.
Three scripts do the work; this file says when to run each and what to check between them.

| Script | Does | Run with |
| --- | --- | --- |
| [`scripts/lib.mjs`](./scripts/lib.mjs) | Validates the spec; shared timing, subtitle, and frame-list helpers | `node … --validate <spec>` |
| [`scripts/narrate.py`](./scripts/narrate.py) | One audio clip per step plus `audio/manifest.json` | `uv run …` (or `python3 … --engine say`) |
| [`scripts/record.mjs`](./scripts/record.mjs) | Drives Chromium; captures frames and real step start times | `node …` |
| [`scripts/assemble.mjs`](./scripts/assemble.mjs) | Frames + audio at real step times + subtitles → MP4 | `node …` |

**Timing model.**
Narration sets the minimum length of a step; the app sets the maximum.
A step starts, its actions run while its narration plays, and it ends when both are done.
`assemble.mjs` then places each step's audio at the moment that step really started, so a slow request adds a pause but never pushes the voice out of sync.

Do **not** use this skill for:

- A short clip proving an animation or interaction: use `screen-recorder`.
- An animated explainer of a concept or architecture rather than a real UI: build an HTML page instead.
- Reviewing an existing recording: use `video-analyser`.

---

## Phase 0 — Preflight (halt and ask before installing anything)

```bash
node --version                                    # >= 18
command -v ffmpeg ffprobe                         # assembly and audio
command -v uv || command -v say                   # Kokoro via uv, or the macOS fallback
node -e "require.resolve('playwright')" 2>/dev/null || ls ~/.cache/narrated-walkthrough/node/node_modules/playwright
```

| State | Action |
| --- | --- |
| All present | Proceed to Phase 1. |
| `ffmpeg` missing | **Halt.** Ask, then `brew install ffmpeg`. |
| Playwright not resolvable | **Halt.** Ask, then install it into the skill runtime: `npm --prefix ~/.cache/narrated-walkthrough/node install playwright && npx --prefix ~/.cache/narrated-walkthrough/node playwright install chromium`. |
| No `uv` and no `say` | **Halt.** Ask, then `brew install uv`; or use `--engine files` with the user's own recordings. |
| Kokoro never run on this machine | Tell the user the first `narrate.py` run downloads about 350 MB to `~/.cache/narrated-walkthrough/kokoro`. |

## Phase 1 — Inputs

Collect, then echo back as one summary before going further:

| Input | Required | Default | Notes |
| --- | --- | --- | --- |
| Feature or flow | Yes | — | What the viewer should be able to do after watching. |
| Audience | Yes | — | Customers, CS team, sales; sets vocabulary and depth. |
| Base URL | Yes | — | Local dev, preview, or staging. |
| Sign-in | When the app needs it | — | A Playwright storage-state JSON. Prefer the project's own authenticated-browser skill to produce it; otherwise `npx playwright codegen --save-storage=<workspace>/auth-state.json <url>` and the user signs in. |
| Preconditions | Yes | — | Feature flags, seed data, and the exact org or project to record in. The flow must work before filming it. |
| Voice | No | `af_heart` | See § Voices. |

**Data rule.**
Record only demo or internal data.
Refuse to film a production organization holding customer data unless the user names that organization explicitly and confirms nothing sensitive is on screen.
The storage-state file holds live session cookies: keep it inside the workspace, never commit it, and delete it when the video is delivered.

Workspace: `.agent/walkthroughs/<slug>/` in the current repo.
Confirm `.agent/` is gitignored; add it if not.

## Phase 2 — Draft `walkthrough.json`

1. Copy [`templates/walkthrough.json`](./templates/walkthrough.json) into the workspace; every selector in it is illustrative.
2. Find real selectors: read the feature's components for roles, accessible names, and test ids, or open the page with `record.mjs --headed --check` and adjust.
3. Write `setup` to reach the starting screen in a clean state, and `steps` per [`rules/walkthrough-spec.md`](./rules/walkthrough-spec.md).
4. Write the narration per [`rules/script-writing.md`](./rules/script-writing.md).
5. Validate until it prints `OK`:

   ```bash
   node ${CLAUDE_SKILL_DIR}/scripts/lib.mjs --validate .agent/walkthroughs/<slug>/walkthrough.json
   ```

## Phase 3 — Script approval (mandatory gate)

Show the approval table from [`rules/script-writing.md`](./rules/script-writing.md#approval-table) with the estimated length, and wait for an explicit yes.
Never generate audio or record before that yes.
Apply requested edits to `walkthrough.json` and show the changed rows again.

## Phase 4 — Dry run

```bash
node ${CLAUDE_SKILL_DIR}/scripts/record.mjs .agent/walkthroughs/<slug>/walkthrough.json --check
```

It runs every action at full speed with no capture and prints one `ok` or `FAIL` line per action; a failure saves `failure-<step>-<n>.png` in the workspace.
Read the screenshot, fix the selector or add a `waitFor`, and repeat until it prints `CHECK OK`.
A flow that mutates data (creating a silence, deleting a rule) must be reset in `setup` or by hand before every run, including the next one.

## Phase 5 — Narrate

```bash
uv run ${CLAUDE_SKILL_DIR}/scripts/narrate.py .agent/walkthroughs/<slug>/walkthrough.json
```

- Writes `audio/<step-id>.wav` and `audio/manifest.json`; prints a JSON summary with total seconds.
- Re-running re-voices only steps whose lines, voice, engine, or speed changed (`revoiced` lists them); `--force` re-voices all.
- `--engine say` needs no `uv`: `python3 ${CLAUDE_SKILL_DIR}/scripts/narrate.py <spec> --engine say`.
- `--engine files` takes human recordings from `audio/src/<step-id>.(wav|m4a|mp3|aiff)`.

## Phase 6 — Record

```bash
node ${CLAUDE_SKILL_DIR}/scripts/record.mjs .agent/walkthroughs/<slug>/walkthrough.json
```

- Writes `frames/`, `frames.json`, and `timeline.json`; holds each step for at least its narration length.
- `WARN: step <id> actions ran N s past its narration` means dead air: add a line to that step or split it, re-narrate, re-record.
- `WARN: no audio for …` means Phase 5 was skipped; the take is timed on estimates and `assemble.mjs` will refuse it.

## Phase 7 — Assemble and verify

```bash
node ${CLAUDE_SKILL_DIR}/scripts/assemble.mjs .agent/walkthroughs/<slug>/walkthrough.json
```

Writes `<slug>.mp4` (H.264, AAC, soft English subtitles) and `<slug>.srt`.
It refuses when audio changed after recording, because the holds no longer match.

Verify before delivering:

1. `ffprobe -v error -show_entries stream=codec_type,duration -of compact <slug>.mp4` shows video, audio, and subtitle streams of matching length.
2. Extract one frame from the middle of every step (`ffmpeg -ss <start + 1> -i <slug>.mp4 -frames:v 1 <id>.png`, starts from `timeline.json`) and read each: the screen matches the narration, no spinner, no error toast, no stray dialog.
3. You cannot hear the audio: ask the user to watch once and report misread words; fix those with `speak`.

## Phase 8 — Deliver

```text
Video:      <absolute path>.mp4  (<size>, <seconds> s, 1920x1080)
Subtitles:  <absolute path>.srt  (also embedded as a soft track)
Voice:      <engine> / <voice>
Steps:      <n>  — overruns: <none | step ids>
Workspace:  .agent/walkthroughs/<slug>/  (delete auth-state.json when done)
```

## What to re-run after a change

| Changed | Re-run |
| --- | --- |
| A narration line, voice, or speed | Phase 5 → 6 → 7 |
| An action or selector | Phase 4 → 6 → 7 |
| `setup` only | Phase 4 → 6 → 7 |
| Output quality (`--crf`) or subtitles on or off | Phase 7 only |
| The app itself (new build) | Phase 4 → 6 → 7 |

## Voices

Kokoro voice ids start with a language letter and a gender letter: `a` American English, `b` British English; `f` female, `m` male.
Good English choices: `af_heart` (default, warmest), `af_bella`, `am_michael`, `am_fenrir`, `bf_emma`, `bm_george`.
Set `voice` in the spec or pass `--voice`.
For a customer-facing release, offer the user `--engine files`: they record each step's lines themselves and the take keeps its timing.

## Definition of done

- [ ] Script approved explicitly before any audio was generated.
- [ ] `record.mjs --check` printed `CHECK OK`.
- [ ] `record.mjs` reported no overrun above 1 s, or the user accepted the named ones.
- [ ] `assemble.mjs` produced an MP4 with video, audio, and subtitle streams.
- [ ] One frame per step was inspected and matches its narration.
- [ ] The user listened once and pronunciation fixes, if any, are applied.
- [ ] `auth-state.json` deletion reminded in the delivery summary.

---
title: walkthrough.json — Spec Format and Action Verbs
impact: HIGH
tags:
  - spec
  - playwright
  - selectors
---

# `walkthrough.json`

One file drives all three scripts.
`record.mjs` performs it, `narrate.py` voices it, and `assemble.mjs` subtitles it.
Validate it after every edit:

```bash
node ${CLAUDE_SKILL_DIR}/scripts/lib.mjs --validate .agent/walkthroughs/<slug>/walkthrough.json
```

## Top-level fields

| Field | Required | Default | Meaning |
| --- | --- | --- | --- |
| `title` | Yes | — | Video title; its kebab-case form names the output file. |
| `slug` | No | from `title` | Overrides the output file name. |
| `baseUrl` | When any `goto` is relative | — | Origin plus optional path prefix, e.g. `http://localhost:3000`. |
| `storageState` | No | — | Playwright storage-state JSON for a signed-in session, relative to the spec. |
| `viewport` | No | `{"width": 1280, "height": 720}` | CSS pixels the app lays out in. |
| `scale` | No | `1.5` | Device scale factor; output pixels are `viewport × scale` (1920×1080 by default). |
| `colorScheme` | No | app default | `light` or `dark`. |
| `voice` | No | `af_heart` | Kokoro voice id; see `SKILL.md` § Voices. |
| `speed` | No | `1.0` | Voice speed multiplier. |
| `beatMs` | No | `350` | Pause after each action so its result is visible. |
| `stepGapMs` | No | `600` | Silence after a step's narration before the next step starts. |
| `leadInMs` / `tailMs` | No | `800` / `1500` | Still time before the first step and after the last one. |
| `setup` | No | `[]` | Actions run **before** capture starts: navigation, dismissing banners, resetting state. Never narrated, never filmed. |
| `steps` | Yes | — | Ordered list of narrated steps. |

## Steps

```json
{
  "id": "select-checks",
  "say": [
    "Select the checks you want to silence.",
    { "text": "Dash0 keeps your selection across pages.", "speak": "Dash zero keeps your selection across pages." }
  ],
  "do": [
    { "click": "role=checkbox[name=\"Select checkout-latency\"]" },
    { "click": "role=checkbox[name=\"Select cart-errors\"]" }
  ],
  "holdMs": 500
}
```

- `id` is kebab-case and unique; audio clips and subtitles key on it.
- `say` holds one or more lines; a line is a string, or `{text, speak}` when the subtitle and the pronunciation differ.
- `do` runs while the narration plays, starting at the step's first word.
- The step ends when both its actions and its narration are done, plus `stepGapMs`, plus optional `holdMs`.

## Action verbs

Each action is an object with **exactly one** verb key.
Targets are Playwright selector strings; the first match is used unless `nth` is given.

| Verb | Value | Extra keys | On screen |
| --- | --- | --- | --- |
| `goto` | path or URL | — | Navigates, then waits for network idle (10 s cap). |
| `click` | target | `nth` | Cursor glides to the target, ripple, click. |
| `hover` | target | `nth` | Cursor glides and rests; reveals hover UI. |
| `type` | target | `text`, `delay` (ms per key, default 60) | Clicks the field and types visibly. |
| `fill` | target | `text` | Sets the value instantly; use for long text nobody needs to watch. |
| `press` | key name | — | Keyboard press, e.g. `Enter`, `Escape`, `Meta+K`. |
| `select` | target | `value` | Picks a native `<select>` option. |
| `scroll` | target or pixel delta | `nth` | Smooth-scrolls the target to center, or wheels by N pixels. |
| `wait` | milliseconds | — | Holds still. |
| `waitFor` | target | `state` (`visible` default, `hidden`, `attached`, `detached`) | Waits for the UI to settle; no cursor motion. |
| `highlight` | target | `ms` (default 1500) | Dims the page around the target and rings it. |

## Selectors

Pick the first rung that works, top to bottom:

1. `role=button[name="Add to silence"]`: matches what the viewer reads, survives restyling.
2. `data-testid=bulk-silence-button`: stable when the app ships test ids.
3. `text=Silenced 2 checks`: fine for assertions in `waitFor`.
4. CSS such as `[aria-label="Select row"] >> nth=0`: only when nothing above is unique.

### Good

```json
{ "click": "role=menuitem[name=\"Add to silence\"]" }
```

### Bad

```json
{ "click": "div.sc-1x9k > div:nth-child(3) button" }
```

Why bad: generated class names change on every build, so the next take fails on a selector nobody can read.

## Waiting for the app

Every action already waits up to 15 s for its target.
Add an explicit `waitFor` after any action that triggers a request, so the next step does not start on a spinner:

```json
[
  { "click": "role=button[name=\"Silence 2 checks\"]" },
  { "waitFor": "text=2 checks silenced" }
]
```

Never use `wait` to cover a network request; a fixed sleep is too short on a slow day and dead air on a fast one.

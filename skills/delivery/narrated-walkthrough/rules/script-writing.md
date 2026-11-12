---
title: Writing the Narration Script
impact: HIGH
tags:
  - narration
  - script
  - voiceover
---

# Writing the narration script

The script is the `say` lines in `walkthrough.json`.
Write it before any audio exists, and get an explicit yes on it: a line of text costs nothing to change, while new audio forces a new take.

## Structure

1. **Open on the problem, in one step.**
   Say who hits this and why it hurts, with the relevant screen already on display.
   Example: "When a deploy trips twenty checks at once, silencing them one by one takes minutes."
2. **One step per user decision.**
   A step is one thing the viewer would do themselves: select, open a menu, choose a duration, confirm.
3. **Close on the result, then the one thing to remember.**
   Show the end state and say where to find it again.

## Lines

- One or two lines per step, one sentence per line.
- Narrate the intent, not the click: "Pick how long the silence should last." beats "Click the dropdown and select two hours."
- Speak about what is on screen at that moment; the action starts with the first word.
- Never read on-screen text aloud word for word.
- Second person, present tense, active voice: "You select", not "The user will be selecting".
- About 150 words per minute; keep the whole video under 3 minutes and cut steps rather than packing lines.

### Good

```json
{ "id": "duration", "say": ["Pick how long the silence lasts.", "When it expires, alerts resume on their own."] }
```

### Bad

```json
{ "id": "duration", "say": ["Now we are going to click on the duration dropdown menu which is located on the right hand side of the dialog, and then we will select the option labelled two hours."] }
```

Why bad: one long sentence that describes clicks the viewer can already see, and runs far past the actions it narrates.

## Pronunciation

Write the subtitle in `text` and the spoken form in `speak` whenever a voice would misread it:

| Written | Speak |
| --- | --- |
| `Dash0` | `Dash zero` |
| `P99` | `p ninety-nine` |
| `k8s` | `Kubernetes` |
| `OTel` | `oh-tel` |
| `v2.4.1` | `version two point four point one` |
| `2h` | `two hours` |
| `API` | `A P I` |

```json
{ "text": "Silences in Dash0 expire after 2h.", "speak": "Silences in Dash zero expire after two hours." }
```

## Approval table

Present the script to the user as this table, with the total estimated length, before Phase 5:

```markdown
| Step | Narration | On screen |
| --- | --- | --- |
| `intro` | When a deploy trips twenty checks at once, … | Failed checks list, filtered to one service |
| `select` | Select the checks you want to silence. | Two rows ticked |
```

Estimated length: total words ÷ 150 minutes, plus about 1 s per step for gaps.

---
title: PR description contract — the shared narrative + length rules
impact: HIGH
tags:
  - create-pr
  - review-loop
  - pr-description
  - single-source-of-truth
---

# PR description contract

The single source of truth for **what a good PR body looks like** and **how to
write it**. Two skills consume this contract:

- `create-pr` — writes the initial body when it opens the draft PR.
- `review-loop` — refreshes the body after the loop converges, so the
  description matches the code that actually shipped (fixes applied during the
  loop can drift the diff away from `create-pr`'s first draft).

Both apply the same body via `gh` (`gh pr create --body …` for the first write,
`gh pr edit --body …` for a refresh). This file owns the contract; neither skill
restates it.

## Length budget — the hard rule

A reviewer should read the entire description in **under 30 seconds**. The budget is counted in
**words**, because a Markdown line can hold any number of them: a 25-line body of 35-word bullets is
400 words.

- **Body target: ≤ 120 words.** Hard ceiling: 200. Count every word outside the exempt regions below, headings excluded.
- **Why: 1–2 sentences, ≤ 40 words.** Not paragraphs.
- **What changed: 2–4 bullets, ≤ 20 words each.** No sub-bullets, no code blocks inside bullets.
- **How to verify: one line.** One command or one scenario.
- **Notes for reviewers: optional, ≤ 2 items, ≤ 25 words each.** Only a risk, a judgment call the reviewer must make, or a known gap with its ticket link.
- **Test in preview: only when [Step 3b](#step-3b-decide-on-a-test-in-preview-section) says so. 2–5 numbered steps, ≤ 15 words each, ≤ 60 words in total.** It has its own budget and does not count toward the body's.

If you can't fit the change inside this budget, the PR is probably too big — stop and offer the user `/create-pr --split` instead of expanding the description.

**Two regions are exempt.** Content between these markers does **not** count toward the ≤ 120 / 200 budget:

- the UI verification spec block, `<!-- ui-verify:v1 -->` … `<!-- /ui-verify:v1 -->` (see [UI verification spec](#ui-verification-spec-optional)). It is collapsed and machine-oriented, not reviewer-facing prose.
- the visuals region, `<!-- pr-visuals:v1 -->` … `<!-- /pr-visuals:v1 -->` (see [PR visuals region](#pr-visuals-region-optional)). It holds images, not prose.

## Core principles

1. **Narrative over checklist.** Reads like prose explaining a decision, not a bullet-point manifest of every file touched.
2. **Why first, then what, then how to verify.** Motivation drives understanding. A reviewer should be able to predict the diff after reading the description.
3. **Group by concept, not by file.** Don't enumerate every changed file — describe the *ideas* the change introduces.
4. **No filler.** Skip empty checklists, stock "Code follows guidelines" boxes, and boilerplate that adds noise without information.
5. **One idea per bullet.** If a bullet wants a follow-up clause, it's two changes — split or cut the second.
6. **Write for a reviewer who has not read the code or the ticket.** Describe what a user or caller sees, not how the code is built.
   - Name at most **one** code identifier per bullet, in backticks. Prefer the behaviour: "the sidebar counts older silences", not "coverage merges the exact-anchor read with the `silencedBy` stamp".
   - Spell out every internal abbreviation on first use, or replace it with what it is ("the control plane API", not "CPA").
7. **Never describe the process.** No agent, phase or tool names (`executor`, `review-branch`, `aw`), no review rounds, no "validation" section. Test results take the one "How to verify" line.
8. **One fixed shape.** Use the lean default headings below, or the repo's template headings. Never `Summary`, `TL;DR`, `Problem` / `Solution` or `Open questions` in a repo without a template.

Correct bullet:

```markdown
- Unsilence and Agent0 also end silences made on earlier versions of the check.
```

Wrong: 35 words, three internal identifiers, and a second sentence that belongs in the diff.

```markdown
- Unsilence and Agent0's `endSilences` call the existing `DELETE ?coversFailedCheckId=` once per covering anchor. A silence with no failed-check anchor is never ended from a failed check.
```

## Step 1: Gather information

Run these in parallel:

```bash
git branch --show-current
git log main..HEAD --oneline
git diff main...HEAD --name-status
git diff main...HEAD --stat
git diff main...HEAD              # full diff — needed to understand intent
```

Also check for a PR template:

```bash
# Common template locations (check all)
ls .github/pull_request_template.md \
   .github/PULL_REQUEST_TEMPLATE.md \
   .github/PULL_REQUEST_TEMPLATE/ \
   docs/pull_request_template.md \
   PULL_REQUEST_TEMPLATE.md 2>/dev/null
```

When **refreshing** an existing PR (the `review-loop` case), diff against the
PR's base branch and read the PR's current body first, so the refresh is a
minimal edit rather than a rewrite — keep the reviewer's mental model stable.

## Step 2: Understand the narrative

Before writing anything, answer these questions for yourself by reading the diff:

- **What problem or goal motivated this change?** (the *why*)
- **What is the core idea of the solution?** (one sentence — the *headline*)
- **What are the 2–4 conceptual moves the diff makes?** (not files — concepts)
- **What should a reviewer pay extra attention to?** (risk areas, judgment calls, follow-ups)
- **How was it verified?** (tests added, manual checks, scenarios covered)

If you can't answer these from the diff alone, ask the user — don't pad the description with guesses.

## Step 3: Choose output format

**Branch A — Repository has a PR template:** Use it. Fill each section with the *narrative* version (short, focused, no filler). The word budget applies to the template's prose too; a template table of links (preview, feature flag) does not count. Leave optional sections empty rather than padding with `N/A` boilerplate. Keep checkbox lists if the template has them, but only check what genuinely applies. When Step 3b says to write a `## Test in preview` section and the template has no testing section, add it after the template's last section.

**Branch B — No PR template:** Use the lean default below. Do not invent extra sections.

One worked example of each branch — plus a bug fix and a **bad** verbose one to recognise — lives in [`description-examples.md`](./description-examples.md).

### Lean default (when no template exists)

```markdown
## Why

[1–2 sentences, ≤ 40 words. The problem or user-visible outcome. Link the issue if there is one. Don't restate the title.]

## What changed

- [Conceptual change 1, ≤ 20 words]
- [Conceptual change 2, ≤ 20 words]
- [Conceptual change 3, ≤ 20 words]

## How to verify

[One test command or one scenario.]

## Test in preview

1. [Only when Step 3b says to write it. Where to start, ≤ 15 words.]
2. [What to do, ≤ 15 words.]
3. [What the reviewer should see, ≤ 15 words.]

## Notes for reviewers

- [Optional, ≤ 2 items, ≤ 25 words each. Skip the section if there's nothing load-bearing to flag.]
```

Follow-up work goes in a ticket. Link it from a note; never list it in the body.

Aim for **2–4 bullets** under "What changed". If you have 6+, the PR is too big or you're enumerating files instead of concepts.

## Step 3b: Decide on a "Test in preview" section

Write a `## Test in preview` section when the PR is UI only, or when its preview deployment runs every
changed component. Decide mechanically with `ui-verify`'s classifier over every changed file:

```bash
FILES=$(git diff --name-only origin/<base>...HEAD | paste -sd, -)
node <ui-verify-skill-dir>/scripts/is-ui-diff.mjs --files "$FILES" [--surface-json '<surface>']
```

`<ui-verify-skill-dir>` is the directory holding `ui-verify`'s `SKILL.md`, e.g.
`~/.claude/skills/ui-verify`. Pass the same `--surface-json` that `ui-verify` uses when LoreKit holds
one. The JSON's `matched` array lists the UI files. A **neutral** file is a test, a doc (`*.md`), a
translation file, or a lockfile. Take the first row that matches:

| # | Condition | Record | Write the section |
| - | --- | --- | --- |
| 1 | The script exits 2 | `skipped (classifier error: <stderr line>)` | No |
| 2 | `UI_DIFF: no`, and no changed file has preview evidence (below) | `skipped (no UI files and no preview evidence)` | No |
| 3 | `UI_DIFF: yes`, and every changed file is in `matched` or is neutral | `written (UI only)` | Yes |
| 4 | Every other changed file has preview evidence | `written (preview runs <components>: <evidence>)` | Yes |
| 5 | Otherwise | `skipped (<first file without evidence> not in preview)` | No |

**Preview evidence** for a non-UI file is one of these, read from the repository, never inferred from a
component's name:

- a workflow in `.github/workflows/` triggered on `pull_request` that builds that file's component and deploys it to a per-PR environment;
- a preview deployment config whose root contains the file, such as a `vercel.json` or `.claude/aw-targets/preview.yml` naming that component;
- repository docs stating that per-PR previews run that component.

A UI preview that calls a shared backend does **not** run the backend: a backend file in that repo is
row 5.

After rows 3 and 4, skip anyway when a person cannot see or trigger the change in the preview, such as
a refactor with no visible effect. Record `skipped (no manual check beyond the unit tests)`.

Write the section to these rules:

- Place it after `## How to verify`, or after the template's last section.
- Write 2–5 numbered steps, ≤ 15 words each.
- In step 1, name the page or route to open, plus any feature flag, organization or data the check needs. Never write a preview URL; the deployment posts it.
- Name controls by their visible label, in bold.
- End with the result the reviewer should see.
- No code identifiers, selectors or commands. The machine-run checks belong in the `ui-verify` spec.
- Do not repeat the steps in `## How to verify`. That section keeps the automated test command.

Correct:

```markdown
## Test in preview

1. Open **Alerting → Failed checks** and pick a check silenced before its rule changed.
2. Open the sidebar.
3. **Silenced by** lists the older silence.
```

Wrong: a URL that is not known yet, a selector, and no expected result.

```markdown
## Test in preview

1. Go to https://preview-1234.example.com/alerting and click `[data-testid=fc-row]`.
2. Test the sidebar.
```

**On refresh (the `review-loop` case):** re-run this step on the converged diff. Edit the steps only
when the behaviour they check changed. Remove the section when the gate now says skip.

## UI verification spec (optional)

When the diff touches the UI, the PR body can carry a **collapsed, machine-findable UI verification spec** — a step-by-step checklist an agent runs against the PR's live preview deployment.
`create-pr` authors it by delegating to `ui-verify`; it is not part of the narrative body a reviewer reads.

- **Author it by delegation**, never by hand: `Skill("ui-verify", "author <pr-url>")`. That skill owns the spec grammar, the marker contract, and the authoring memory loop. `create-pr` decides *whether* to call it (UI diff, flag unset); `ui-verify` decides *what* the spec says.
- **The block is a single owned region**, delimited by `<!-- ui-verify:v1 -->` … `<!-- /ui-verify:v1 -->`. There is at most one per PR.
- **It is exempt from the length budget** (see above) and **preserved verbatim on refresh** (see Step 5 and the refresh note below).
- Full contract: [`skills/testing/ui-verify/rules/spec-format.md`](../../../testing/ui-verify/rules/spec-format.md).

**On refresh (the `review-loop` case):** carry the whole `<!-- ui-verify:v1 -->` … `<!-- /ui-verify:v1 -->` region forward unchanged.
The refresh rewrites narrative sections only; re-authoring the spec is `ui-verify author`'s job, not the refresh's.

## PR visuals region (optional)

`create-pr` Step 9.5 can add screenshots and a PR Lens diagram to the body, inside one region
delimited by `<!-- pr-visuals:v1 -->` … `<!-- /pr-visuals:v1 -->`. There is at most one per PR.
It sits immediately before the body's second `## ` heading.

- **Author it only through [`pr-visuals.md`](./pr-visuals.md).** Its image URLs are GitHub-uploaded assets that cannot be recreated from the diff.
- **It is exempt from the length budget** (see above).
- **On refresh, carry the whole region forward unchanged**, at the same position. If a refresh drops it, the uploaded images are lost from the PR.

## Step 4: Write the title

- Imperative mood, specific, under ~70 chars.
- Follow Conventional Commits if the repo uses them: `type(scope): brief description`.
- Good: `fix(auth): refresh token when API returns 401`
- Bad: `Bug fix`, `Various improvements`, `feat: stuff`

## Step 5: Length self-check (before writing the body)

Count the words, **skipping headings, any `<!-- ui-verify:v1 -->` … `<!-- /ui-verify:v1 -->` or `<!-- pr-visuals:v1 -->` … `<!-- /pr-visuals:v1 -->` region, and the `## Test in preview` section**, which has its own budget (see [Length budget](#length-budget--the-hard-rule)). Count mechanically; do not estimate:

```bash
perl -0pe 's/<!-- (ui-verify|pr-visuals):v1 -->.*?<!-- \/\1:v1 -->//sg; s/^## Test in preview\n.*?(?=^## |\z)//msg; s/^#+ .*$//mg' body.md | wc -w
perl -0ne 'print $1 if /^## Test in preview\n(.*?)(?=^## |\z)/ms' body.md | wc -w   # ≤ 60
awk '/^[-*] |^[0-9]+\. /{ if (NF-1 > 20) print NF-1 ": " $0 }' body.md   # bullets over 20 words
```

If the body is over 120 words, the Test in preview section is over 60, or any bullet is over 20, cut. Common cuts:

- **Collapse "Notes for reviewers"** unless it flags a real risk or judgment call. "We chose X because Y" usually belongs in a code comment.
- **Drop "internal narration"** — explanations of memo deps, useEffect timing, and other implementation detail that a reviewer will read in the diff anyway.
- **Replace identifiers with behaviour.** "Calls `DELETE ?coversFailedCheckId=` once per anchor" → "also ends the older silences".
- **Merge bullets that share a verb.** "Added X. Added Y. Added Z." → one bullet listing the three.
- **Cut "How to verify" prose** — one command beats three sentences.
- **Drop sub-bullets entirely.** If a bullet needs a sub-bullet, split it into two top-level bullets or remove the detail.

If you've cut as much as you can and it's still over 200 words, the PR is too big. Stop and offer the user `/create-pr --split` before pushing.

## Step 5b: Plain-language pass

After the length check, run `Skill("writing:unslop", "<body>")` on the narrative sections, then
re-run the Step 5 count. Pass only the prose: never the exempt regions, the title, code spans or
commands. When `writing:unslop` is not installed (`Skill()` raises), skip this step and continue.

On a refresh (the `review-loop` case), run it only on the sections the refresh changed.

---
title: PR visuals — before/after screenshots, feature screenshots, and a PR Lens diagram
impact: MEDIUM
tags:
  - create-pr
  - screenshots
  - pr-lens
  - ui-verify
---

# PR visuals

The procedure behind `create-pr` Step 9.5. It adds up to two kinds of image to
the PR description, in one `<!-- pr-visuals:v1 -->` region:

- **Screenshots** of the UI: before/after pairs when the diff changes existing
  UI, or "after" shots only when the diff only adds new UI.
- **A PR Lens diagram** of the architecture or data flow, only when the diff
  meets the criteria in [V3](#v3-decide-whether-a-pr-lens-diagram-earns-its-place).

Every sub-step below records a value for the Step 10 `Visuals` slot. A skipped
sub-step is recorded with its reason. It is never silently omitted.

## V0: Preconditions

Run V1 through V5 only when **all** of these hold. Otherwise record the first
matching skip and go to Step 10.

| Condition | Record when it fails |
| --- | --- |
| `--no-visuals` not in `$ARGUMENTS` | `skipped (--no-visuals)` |
| Not in split mode | `skipped (split mode)` |
| Step 0 resolved the `gh` path (not `mcp`, not neither) | `skipped (needs gh CLI for --attach)` |
| `gh --version` is 2.99 or later | `skipped (gh < 2.99, no --attach)` |

The `mcp` path has no attachment upload, so an image reference written there would point at a
local file no reader can fetch. Never write one.

## V1: Choose the screenshot mode

Screenshots need the `ui-verify` spec that Step 6.4 authored. Take the first row that matches:

| # | Condition | `SHOT_MODE` |
| - | --- | --- |
| 1 | `--no-screenshots` in `$ARGUMENTS` | `none (--no-screenshots)` |
| 2 | Step 6.4 recorded anything other than `authored (<N> specs)` | `none (no ui-verify spec: <Step 6.4 value>)` |
| 3 | Some *modified* (not added) file in the diff is UI, per the classifier below | `before-after` |
| 4 | Otherwise (the UI files in the diff are all new) | `feature` |

The row 3 check is mechanical. Run `ui-verify`'s own classifier on the modified, renamed and deleted
files only. Pass the same `--surface-json` that `ui-verify author` used when it read one from LoreKit:

```bash
MODIFIED=$(git diff --name-only --diff-filter=MRD origin/<base>...HEAD | paste -sd, -)
node <ui-verify-skill-dir>/scripts/is-ui-diff.mjs --files "$MODIFIED" [--surface-json '<surface>']
# read the final line: UI_DIFF: yes → row 3, UI_DIFF: no → row 4
```

An empty `$MODIFIED` is row 4. Do not guess from file names instead of running the script. Do not
treat a non-zero exit as `no`: exit 2 is an error, so record `none (classifier error: <stderr line>)`.

`<ui-verify-skill-dir>` is the directory holding `ui-verify`'s `SKILL.md`, e.g.
`~/.claude/skills/ui-verify` or `skills/testing/ui-verify` in this repository.

## V2: Capture the screenshots

Skip when `SHOT_MODE` is `none (…)`.

Both runs write to the same `.agent/{branch}/.aw-tester/captures/` directory, so **move each run's
output out before the next run starts**. Otherwise the after run overwrites the before shots.

### V2a: "after" — the PR preview

```
Skill("ui-verify", "run <pr-url> [--driver <d>]")
```

`ui-verify` resolves the preview for the PR's head SHA. CI has settled by now, so the preview is
normally deployed. Then:

```bash
mkdir -p .agent/<branch>/pr-visuals/after
mv .agent/<branch>/.aw-tester/captures/*.png .agent/<branch>/pr-visuals/after/
```

If the run returned `inconclusive: …` or `NOT RUN (…)`, record `none (after run: <reason verbatim>)`,
skip V2b, and continue to V3. Before shots with nothing to pair against are useless. A `fail`
verdict is **not** a reason to skip: the screenshots show the failure, and the verdict is reported
separately.

If the first run asked the user to choose a driver, pass that same `--driver` to V2b so the user is
not asked twice.

### V2b: "before" — the base URL (`before-after` mode only)

Resolve the base URL. The first source that is present wins:

1. `--before-url <url>` in `$ARGUMENTS`.
2. A `before_url:` key in the committed `.claude/aw-targets/preview.yml`, for example the
   production app or the preview of the base branch.
3. Neither → set `SHOT_MODE` to `feature` and record `before skipped (no base URL; pass
   --before-url or set before_url in .claude/aw-targets/preview.yml)`.

Never construct or guess a base URL from the preview URL's shape.

Run the **same spec** against it. `--url` bypasses preview resolution, and auth comes from the same
`preview.yml`:

```
Skill("ui-verify", "run <pr-url> --url <before-url> [--driver <d>]")
```

```bash
mkdir -p .agent/<branch>/pr-visuals/before
mv .agent/<branch>/.aw-tester/captures/*.png .agent/<branch>/pr-visuals/before/
```

A `fail` verdict on the base is **expected**. The spec asserts the new behaviour, and the base does
not have it yet. That is what the before shot shows, so keep it. If the run returned
`inconclusive: …` or `NOT RUN (…)`, for example because the base's auth rejected the preview
credentials, fall back to `feature` mode and record `before skipped (<reason verbatim>)`.

**Never report the base run's verdict as the PR's verdict.** It is a camera, not a check.

### V2c: Select the shots

Use `<spec-id>-auto-final.png` per spec, plus any explicit `CAPTURE` shots the spec author named.
Leave the intermediate `-auto-<seq>` navigation shots in the directory. Cap at **4 specs**, taken
in spec order. If there are more, add one line under the images:
`<N> more specs captured; screenshots not attached.`

A before shot and an after shot are a pair only when their file names match exactly. A spec with
no before file shows its after shot alone, with the caption `(new in this PR)`.

## V3: Decide whether a PR Lens diagram earns its place

Skip with `diagram: skipped (--no-diagram)` on `--no-diagram`, and with
`diagram: skipped (pr-lens not available)` when `Skill("pr-lens", …)` raises.

Otherwise draw one when **at least one** of these holds in `git diff --find-renames origin/<base>...HEAD`:

| # | Criterion | Example |
| - | --- | --- |
| D1 | The diff adds or removes a deployable unit, service, worker, job, queue, or data store | a new consumer service; a new ClickHouse table and its writer |
| D2 | The diff adds, removes or re-routes a call **between** two units | a new HTTP endpoint and its client in another component; an API call replaced by a queue |
| D3 | The diff changes the order of steps in a request or data flow that crosses two or more units | auth check moved from the API proxy into the backend |
| D4 | The diff touches code in three or more top-level components or modules (e.g. `components/*`, `modules/*`, `packages/*`) **and** at least one call between them changes | a cross-cutting refactor of a shared client |

Do **not** draw one, even if a criterion seems to fit, when the diff is only:

- UI styling, copy, layout or a single-component UI change (screenshots cover it);
- tests, docs, config, dependency bumps or generated files;
- changes inside one module with no new call across its boundary.

Record the criterion that decided, e.g. `diagram: drawn (D2)`, or `diagram: skipped (no D1–D4 match)`.

When drawing, follow the `pr-lens` skill's operating manual, steps 1 to 4, with these fixed inputs:

- **Base:** the merge base (`origin/<base>...HEAD`).
- **Theme:** light.
- **Destination:** an SVG for this PR, not a canvas. Do not run `canvas push`, and do not add `payload` to flow steps.
- **Attach:** the top architecture view, plus one data-flow view only when D3 matched. Two diagrams at most.

Stop at pr-lens step 4 (render). Step V4 below does the attaching, together with the screenshots, in
a single edit. If `validate` still fails after fixing what it names, record
`diagram: failed (<error code>)` and continue without it.

## V4: Write the region and attach

Skip when there are no screenshots and no diagram. Record `Visuals: none (<reasons>)`.

1. Read the current body: `gh pr view <pr> --json body -q .body > .agent/<branch>/pr-visuals/body.md`.
2. Remove an existing `<!-- pr-visuals:v1 -->` … `<!-- /pr-visuals:v1 -->` region, so a re-run replaces it instead of stacking a second one.
3. Insert the new region **immediately before the body's second `## ` heading**. That puts it after
   the Why / Summary section and before What changed. If the body has fewer than two `## ` headings,
   append the region at the end. Never place it inside the `<!-- ui-verify:v1 -->` block.
4. Write every image as a Markdown image whose path is the local file. `gh` rewrites each one to the
   uploaded asset. An HTML `<img>` is **not** rewritten, and the file gets appended at the bottom of
   the body instead, so never use one.
5. Upload with one `--attach` per referenced file:

   ```bash
   gh pr edit <pr> --body-file .agent/<branch>/pr-visuals/body.md \
     --attach .pr-lens/overview-light-<hash>.svg \
     --attach .agent/<branch>/pr-visuals/before/spec-1-auto-final.png \
     --attach .agent/<branch>/pr-visuals/after/spec-1-auto-final.png
   ```

   A non-zero exit with a PR URL on stdout means only some files uploaded. Record `Visuals: partial
   (<files that failed>)`. Do not retry the whole edit, because that would upload the good files a
   second time.

The region, for `before-after` mode with a diagram:

```markdown
<!-- pr-visuals:v1 -->
### Architecture

![Architecture after this change: the new silence lookup endpoint between the UI and the control plane](.pr-lens/overview-light-4f9bd6c1.svg)

### Screenshots

| Before | After |
| --- | --- |
| ![Before: failed check panel with no silence list](.agent/ins-1042/pr-visuals/before/spec-1-auto-final.png) | ![After: failed check panel listing two covering silences](.agent/ins-1042/pr-visuals/after/spec-1-auto-final.png) |
<!-- /pr-visuals:v1 -->
```

In `feature` mode, use a heading per spec instead of the table:

```markdown
### Screenshots

**Silence list on a failed check** (new in this PR)

![Failed check panel listing two covering silences](.agent/ins-1042/pr-visuals/after/spec-1-auto-final.png)
```

Wrong: the first line's HTML is never uploaded, and the second has no alt text.

```markdown
<img src=".agent/ins-1042/pr-visuals/after/spec-1-auto-final.png">
![](.agent/ins-1042/pr-visuals/after/spec-1-auto-final.png)
```

Each alt text says in one line what the image shows. Write it from the spec's goal line, not from
the file name.

## V5: Record for Step 10

Record exactly one line:

```
Visuals (Step 9.5): screenshots <before-after (<N> pairs) | feature (<N> shots) | none (<reason>)>; diagram <drawn (D<n>) | skipped (<reason>) | failed (<code>)>; <attached | partial (<files>) | not attached (<reason>)>
```

## Hard rules

- **Never commit the images.** `.agent/` and `.pr-lens/` are scratch. The uploaded assets are the durable copy.
- **Never let a screenshot or the base run change the PR's verdict.** Step 10 reports the review and CI outcomes exactly as they were.
- **Never capture a page that shows real customer data.** The spec runs against the base URL with the preview credentials. If the base URL is a production app, the spec's account must be a test or demo organisation. If you cannot tell, stop and ask the user before attaching.
- **The region is exempt from the description's length budget** and is preserved verbatim by a description refresh. See the [description contract](./description-contract.md#pr-visuals-region-optional).

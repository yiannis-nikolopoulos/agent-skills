---
title: Review guide — a published reading companion for a large or stacked PR
impact: MEDIUM
tags:
  - create-pr
  - review-guide
  - artifact
  - pr-description
---

# Review guide

The procedure behind `create-pr` Step 9.6. It writes a **review guide**: one HTML page, published as
a Claude artifact and linked from the first line of the PR body, that tells a reviewer where the PR
sits, what each part of the diff is for, and in which order to read it.

The PR body stays short ([description contract](./description-contract.md)) and forbids file lists.
The guide is where the file-level map, the reading order, the worked example and the evidence go.
It supplements the body. It never replaces it: a reviewer who cannot open the guide must still
understand the PR from the body alone.

Every sub-step below records a value for the Step 10 `Review guide` slot. A skipped sub-step is
recorded with its reason. It is never silently omitted.

## G0: Preconditions

Run G1 through G6 only when **all** of these hold. Otherwise record the first matching skip and go to
Step 10.

| Condition | Record when it fails |
| --- | --- |
| `--no-review-guide` not in `$ARGUMENTS` | `skipped (--no-review-guide)` |
| Not in split mode | `skipped (split mode)` |
| An artifact-publishing tool is available (the `Artifact` tool in Claude Code) | `skipped (no artifact tool)` |
| Step 0 resolved a GitHub path (`gh` or `mcp`), so the body can be edited | `skipped (no GitHub access path)` |

Do not fall back to a local HTML file or a gist. A guide nobody can open from the PR is worse than
no guide, because the body would link to it.

## G1: Decide whether a guide earns its place

Skip this sub-step when `--review-guide` is in `$ARGUMENTS`; that flag forces a guide and is
recorded as `R0`.

Otherwise write a guide when **at least one** of these holds. Count only **source** files: exclude
tests, snapshots, generated files, lockfiles and Markdown.

```bash
SOURCE=$(git diff --name-only --diff-filter=AMRD origin/<base>...HEAD \
  | grep -vE '(\.test\.|\.spec\.|_test\.go$|/__tests__/|/tests?/|\.snap$|\.lock$|-lock\.(json|yaml)$|\.md$|/generated/|\.gen\.)')
echo "$SOURCE" | grep -c .                                    # R1 file count
git diff --numstat origin/<base>...HEAD -- $SOURCE | awk '{s+=$1+$2} END {print s}'   # R2 line count
```

| # | Criterion |
| - | --- |
| R1 | 8 or more source files changed |
| R2 | 300 or more source lines added plus deleted |
| R3 | The PR is in a stack: its base is not the default branch, or another open PR uses this PR's head branch as its base |
| R4 | Step 9.5 recorded `diagram: drawn (D<n>)` |

R3 check:

```bash
gh pr view <pr> --json baseRefName,headRefName
gh repo view --json defaultBranchRef -q .defaultBranchRef.name
gh pr list --state open --base <headRefName> --json number,title,url
```

When none matches, record `skipped (no R1–R4 match)`. Record the first criterion that matched, e.g.
`R1 (14 source files)`.

## G2: Gather the inputs

Read every input below that exists. Do not invent an input that is missing; its section is then
omitted (see G3).

| Input | Source |
| --- | --- |
| Head SHA | `git rev-parse HEAD` after Step 9.5 |
| Current body | `gh pr view <pr> --json body,title,url,number` (already refreshed by Step 6.5) |
| Diff | `git diff --find-renames origin/<base>...HEAD` |
| Plan | `.agent/<branch>/plan.md`, then `.agent/<branch>/brief.md` |
| Ticket | The ticket ID in the branch name or PR title, e.g. `INS-1357` |
| Stack | The R3 commands above, walked down to the default branch and up through every PR based on this one |
| Tests | Test files added or changed in the diff |
| Screenshots | `.agent/<branch>/pr-visuals/before/*.png` and `after/*.png` from Step 9.5 |
| Diagram | The `.pr-lens/*.svg` files Step 9.5 attached |
| Guide URL from an earlier run | The URL inside an existing `<!-- review-guide:v1 -->` region of the body |

## G3: Write the page

Load the `artifact-design` skill before writing the file. Use its **utilitarian** treatment: a
document a reviewer reads beside the diff, not a landing page. No hero, no big-number tiles.

Write the file to `.agent/<branch>/review-guide/guide.html`. Never commit it.

### Sections

Write the sections in this order. Omit a conditional section when its condition does not hold. Never
write an empty section or a placeholder such as "N/A".

| # | Section | Include when | Content |
| - | --- | --- | --- |
| 1 | Header | Always | A name for the change (2–4 words, not "Review guide for #123"). One metadata line: ticket, area, stack position, and `Written for <short head SHA>`. |
| 2 | Summary | Always | 2–4 sentences on what a user or caller sees after the merge, and what still does not work yet. |
| 3 | Where this PR sits | R3 holds | Every PR in the stack, bottom to top, each linked, with this PR marked. One paragraph on what each PR adds and which gap is expected because a later PR fills it. |
| 4 | Deviation from the plan | The plan or brief states something the diff does differently | Each deviation: what the plan said, what the diff does, why. Name the approver only when the plan or the conversation names one. |
| 5 | What changes | Always | A two-column table, **Area** \| **Change**. One row per group of files that serve one purpose, grouped by layer (types, core logic, state, UI, consumers). Each file path links to the file at the head SHA: `https://github.com/<owner>/<repo>/blob/<sha>/<path>`. |
| 6 | Read it in this order | Always | A numbered list of 3–7 steps from contracts and types, through core logic and its tests, to consumers and UI. Name the one distinction the reviewer must keep track of (e.g. form index vs. saved index), if the diff has one. |
| 7 | Worked example | The diff transforms data (maps, re-keys, filters, migrates or parses it) **and** a test in the diff supplies concrete values | A `<pre>` block with input and output side by side, using the test's values. Cite the test file. |
| 8 | Architecture | Step 9.5 drew a diagram | The diagram, inlined. |
| 9 | Seen in the browser | Step 9.5 has screenshots | The environment, what the test data held, what was **not** changed (e.g. "nothing was saved"), and each screenshot with its alt text. |
| 10 | Testing | Always | What the tests cover, one line per area, plus any manual or review rounds the conversation records. |

Section 5 is where the file paths go. It is the one place this skill lists files, because the guide
is a navigation aid for the diff, not a description of the change.

### Content rules

- **Every claim comes from the diff, the plan, the tests, the PR body or the conversation.** When
  you cannot source a section, omit it.
- **Embed every image as a `data:` URI.** The artifact viewer blocks images from any other host, so
  a GitHub `user-attachments` URL renders as a broken image. Inline an SVG diagram as markup. Keep
  the page under 16 MB.
- **Use the screenshot alt texts from Step 9.5.** Do not write new ones from file names.
- **Never include secrets, tokens, customer names or customer data**, in text or in a screenshot.
- Put a `<title>` at the top with the same name as the header.

Correct metadata line and header:

```html
<h1>SQL opt-in for widget kinds</h1>
<p class="meta">INS-1357 · query builder · Q1, on top of P2 · Written for 4f9bd6c</p>
```

Wrong: the title restates the PR number, and the line omits the SHA a reader needs to see whether
the guide is stale.

```html
<h1>Review guide for PR #23767</h1>
<p class="meta">INS-1357</p>
```

## G4: Publish

Take the first row that matches:

| # | Condition | Call |
| - | --- | --- |
| 1 | This session already published the guide | `Artifact(file_path: <same path>)`, which updates the same URL |
| 2 | The body has a `<!-- review-guide:v1 -->` region with a URL | `Artifact(action: "read", url: <url>)`, then `Artifact(file_path: <path>, url: <url>)` |
| 3 | Otherwise | `Artifact(file_path: <path>, icon: "checklist", description: "<one sentence on what the PR does>")` |

On row 2, if the read says the user is not a writer of that artifact, publish a new one (row 3) and
record `republished as new (no edit access to <old url>)`.

If the publish fails, record `failed (<error verbatim>)` and go to Step 10. Do not edit the body.

## G5: Link it from the PR body

The link is the first region of the body:

```markdown
<!-- review-guide:v1 -->
**Review guide:** https://claude.ai/code/artifact/<id>
<!-- /review-guide:v1 -->

## Why
...
```

1. Read the current body.
2. Remove an existing `<!-- review-guide:v1 -->` … `<!-- /review-guide:v1 -->` region, so a re-run
   replaces it instead of stacking a second one.
3. Insert the new region as the first lines of the body, followed by one blank line.
4. Write the body back with `gh pr edit <pr> --body-file <file>`, or the `mcp` path's
   pull-request update. Do not pass `--attach`; this edit uploads nothing.

Never put the link inside the `<!-- pr-visuals:v1 -->` or `<!-- ui-verify:v1 -->` region.

## G6: Hand the sharing step to the user

An artifact is **private when published**, and the artifact tool cannot change who can see it. A
reviewer who opens the link before it is shared sees an access error.

Do not mark the PR ready for review on the user's behalf. Add this line to the Step 10 "needs you"
items, every time a guide was published or republished as new:

```
Share the review guide with your organization before you mark the PR ready: open <url> → Share.
```

## G7: Record for Step 10

Record exactly one line:

```
Review guide (Step 9.6): <published (<R0–R4 reason>) <url> for <short sha> | updated <url> for <short sha> | republished as new (<reason>) <url> | skipped (<reason>) | failed (<reason>)>
```

At Step 10, compare `<short sha>` with the final head SHA. When they differ, because the Step 6.7
feedback loop pushed after the guide was written, append `; stale (head is now <sha>)`, so the user knows
the guide describes an earlier state of the diff.

## Hard rules

- **Never commit the guide.** `.agent/` is scratch. The artifact is the durable copy.
- **The body must stand alone.** Never move content out of the body into the guide to meet the length budget.
- **Never let the guide change a verdict.** Step 10 reports the review and CI outcomes exactly as they were.
- **The region is exempt from the description's length budget** and is preserved verbatim by a description refresh. See the [description contract](./description-contract.md#review-guide-link-optional).

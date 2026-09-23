---
name: pr-review
description: >
  One-shot read-only review of a GitHub PR — dispatches the `pr-reviewer` agent with
  `--no-post` and reports its verdict and proposed comments without touching your code
  or writing anything to GitHub; you decide what gets posted. The short entry point
  for "review this PR" when you do not want an apply-and-converge loop. Also writes
  maintainer relevance rules via `/pr-review remember <fact>`. Invoke with /pr-review.
disable-model-invocation: true
argument-hint: '[<pr-url>|#<n>] [--critical] [--full] [--effort high] [--with a,b,c] [--no-holistic] [--no-escalate] [--no-optimize] [--no-standards] [--skip-gates] [--fix-links] | remember <fact>'
license: MIT
metadata:
  author: mthines
  version: '1.2.0'
  workflow_type: command
---

# /pr-review — one-shot read-only PR review

This is the thin entry point the [`pr-reviewer`](../../../agents/pr-reviewer.md) agent's own
documentation already promises (`Trigger with /pr-review <PR-URL|#n>`), and it does exactly one
thing: dispatch that agent at a PR and report what came back.

It **never applies a finding, never pushes, never resolves a thread, and never posts to GitHub**.
That is the whole distinction from its neighbours, and it is the reason to reach for this command
rather than one of them: you get a review, your working tree is exactly where you left it, and the
PR carries nothing you did not choose to post.

## Contents

- [Operations](#operations)
- [Step 0: Parse the argument](#step-0-parse-the-argument)
- [Step 1: Resolve the PR](#step-1-resolve-the-pr)
- [Step 2: Dispatch the agent](#step-2-dispatch-the-agent)
- [Step 3: Report](#step-3-report)
- [`remember` — write a maintainer relevance rule](#remember--write-a-maintainer-relevance-rule)
- [Which review command do I want?](#which-review-command-do-i-want)
- [Hard rules](#hard-rules)

---

## Operations

Parse the **first token** of `$ARGUMENTS`.

| First token | Operation | Runs |
| --- | --- | --- |
| `remember` | [memory write](#remember--write-a-maintainer-relevance-rule) | one `mcp__lorekit__memory_write`, no review |
| anything else (or empty) | [review](#step-2-dispatch-the-agent) | one `pr-reviewer` dispatch, read-only |

There is no third operation, and no mode flag that turns this command into an apply pass.
A request to fix what the review found is [`/review-changes`](../review-changes/SKILL.md), below.

## Step 0: Parse the argument

Everything after the PR reference is a **pass-through flag**: forward it verbatim and interpret
none of it.
The agent owns its own flag grammar, so a flag this skill has never heard of must still reach it.

```bash
# Known agent flags, listed for the argument-hint only — NOT a validation allowlist.
#   --critical --full --effort high --with a,b,c --no-holistic --no-escalate
#   --no-optimize --no-standards --skip-gates --fix-links
```

**Never validate the flag list.** A skill that rejects an unrecognised flag has to be edited every
time the agent gains one, and the failure mode is silent: the user's flag is dropped and the review
runs without it. Forward the tail unchanged and let the agent reject what it does not know.

## Step 1: Resolve the PR

```bash
case "$ARGUMENTS" in
  *github.com/*/pull/*|*\#[0-9]*) PR_REF="<the reference as given>" ;;
  *) PR_REF=$(gh pr view --json url -q .url 2>/dev/null) ;;   # current branch's open PR
esac
```

If no reference was given **and** the current branch has no open PR, stop with one line:

```text
/pr-review: no PR reference given and no open PR on this branch. Pass a URL or #<n>, or open a draft PR first (/create-pr).
```

`pr-reviewer` has no PR-less mode — it reads threads, gates, and its own prior state from the PR
object — so there is nothing to degrade to here.

**Where `gh` is unavailable** (a sandbox with only the GitHub MCP server, for instance), resolve the
reference with `mcp__github__pull_request_read` instead of failing.
The agent itself is MCP-capable, so a missing `gh` is a resolution problem in this step and never a
reason to skip the review.

## Step 2: Dispatch the agent

`pr-reviewer` is an **agent, not a skill**.

**Always prepend `--no-post`.** It is not a pass-through flag and not optional: this command is
the caller who decides what reaches the PR, so the agent must return its report and proposed
inline comments instead of posting them (`pr-reviewer.md § No-post mode`). There is no flag that
removes it — a user who wants the agent to post uses `/review-changes`.

```text
✅ RIGHT — through the harness's sub-agent dispatch tool
Task(subagent_type="pr-reviewer", prompt="<PR_REF> --no-post <pass-through flags>")

❌ WRONG — without --no-post the agent posts a sticky report and an inline review on your behalf
Task(subagent_type="pr-reviewer", prompt="<PR_REF> <pass-through flags>")

❌ WRONG — there is no skill by that name; this errors with `Unknown skill: pr-reviewer`
Skill("pr-reviewer", …)
```

**That tool's NAME varies by harness — `Task` in the Claude Code CLI, `Agent` in
the Claude Agent SDK harness behind Claude Code on the web.** Use whichever one
this session exposes; the call shape is identical. A tool taking a
`subagent_type` (or equivalent agent-name) parameter is the dispatch tool
whatever it is spelled.

Dispatch **once**. This command does not loop: a second pass over an unchanged head re-reads the
same code and returns the same report, and iterating a review against fixes is what
[`review-loop`](../review-loop/SKILL.md) exists for.

### When sub-agent dispatch is unavailable

Some harnesses expose no sub-agent dispatch tool at all. Establish that by
capability — **no** available tool dispatches a sub-agent under **any** name —
never from the absence of the single name `Task`, which would skip the review on
every harness that spells it `Agent`. When the capability is genuinely absent,
report the skip and stop:

```markdown
/pr-review — skipped (sub-agent dispatch unavailable; pr-reviewer requires it).
```

**Do not play the reviewer role in this context, and do not retry the dispatch.**
The agent's review independence comes from running in a fresh, isolated context; performing it
inline produces a self-review wearing a reviewer's label, which is worse than no review because it
is reported as one.
One absent-dispatch return is conclusive — the capability's absence is a property of the dispatch
topology, settled before any code is read, so a retry costs a round trip and returns the same answer.

Where another process reviews the PR instead (a review bot, a CI-triggered agent), the supported
path is `Skill("review-loop", "<PR> --external-review")`, which waits on that reviewer rather than
dispatching one.

## Step 3: Report

Nothing reached GitHub. The agent returns the report and every proposed inline comment, and this
skill turns them into a terminal summary the user can decide from:

```text
/pr-review on PR #<n> (<owner>/<repo>) — nothing posted

Verdict: <PASS | WARN | FAIL>
Run mode: <full | incremental | incremental-quick | zero-delta> · <deep | standard | quick> · <checkout | tarball | diff-only>
Findings: <N proposed inline (<K> blocking)>, <D deferred (low-confidence, advisory)>
Gates: <one line naming any non-passing gate, or "all passing">

Proposed comments:
<k>. <path>:<line> — <prefix> (<tier>): <the ask, one line>   [blocking]
...

Full report: <NO_POST_DIR>/report.md
Comment bodies + anchors: <NO_POST_DIR>/inline-comments.json
```

List **every** proposed comment, numbered, blocking ones first, so the user can say "post 1 and 3"
by number. Surface **non-passing gates prominently** — this summary is the only place the result
reaches the user.

If the agent's return mentions **any** GitHub write (a sticky URL, a posted review, a resolved
thread), say so as the first line of the summary: the `--no-post` contract was broken and the user
needs to know what is now on the PR.

**Posting is a separate, explicit step.** Post a proposed comment only when the user names it in a
later message, post exactly the ones named, and post the body as returned. Never post the report
comment unless the user asks for it by name.

Report the verdict **as returned**. Do not soften a `FAIL` because the findings look minor to you,
and do not upgrade a `PASS` because the diff looks risky: the gates and the verifier already made
that call with evidence, and re-adjudicating it here would make two disagreeing verdicts for one
run.

## `remember` — write a maintainer relevance rule

`/pr-review remember <fact>` is the maintainer's direct write into the relevance memory the reviewer
reads on every run — the local equivalent of leaving the same comment on a PR, and the one write
path that needs no corroboration.
[`memory.md`](../../../agents/pr-reviewer/rules/memory.md#pr-review-remember--an-explicit-instruction-needs-no-corroboration)
owns the semantics; this section owns only the invocation.

Classify the direction from the wording:

| Wording | `direction` |
| --- | --- |
| "don't flag …", "stop flagging …", "we don't care about …" | `suppress` |
| "always check …", "watch for …", "this repo cares about …" | `amplify` |

### The key must be an `fp`, or there is no rule to write

The reviewer matches rules **by fingerprint** at read time, so a rule stored under any other key is
never read again.

```bash
node agents/pr-reviewer/scripts/fingerprint.mjs build \
  --finder <finder> --defect-class <class> --symbol <symbol|-> --path <repo-relative path>
```

That needs three things the prose may not carry: a `finder`, a `defect-class`, and a `path`
(`--symbol -` covers a whole-file rule).
Infer what the fact determines, then:

- **All three resolved** → build the `fp` and write the rule.
- **Any one missing** → ask for it in one question, naming the candidates from the enums the script
  validates against (`FINDERS` and `DEFECT_CLASSES` in `fingerprint.mjs`).

**Never invent a key to make the write succeed.** A prose-slug key writes a record the read path
cannot see, which is indistinguishable from having stored nothing while looking like success — the
exact failure the structural `fp_v: 2` space replaced.

```text
✅ RIGHT
/pr-review remember don't flag maintainability in scripts/eval/golden/
→ fp = quality:maintainability:-@scripts/eval/golden/   → write suppress

❌ WRONG
/pr-review remember stop being so picky
→ no finder, no class, no path. Ask which finder and where; never write `rule::stop-being-so-picky`.
```

### The write

```text
mcp__lorekit__memory_write
  tag:    loop::reviewer-comment-relevance
  key:    rule::<fp>
  scope:  repo::{owner}/{repo}
  ttl:    60d
  body:   { direction, status: "active",
            source: { type: "human", agent: "other", explicit: true },
            reason: "<the fact, verbatim>", scope_globs: [<glob>] }
```

`status: active` immediately, with no corroboration threshold: a maintainer saying "don't flag this"
**is** the evidence, and requiring three PRs' worth of it would be requiring them to say it three
times.

**`explicit: true` is required.** The agent filters every relevance-rule read on
`source.agent == "pr-reviewer" ∨ source.explicit == true`
([`memory.md`](../../../agents/pr-reviewer/rules/memory.md#every-read-filters-on-sourceagent)), and
without the flag this record is byte-identical to the incidental human comment that filter exists to
reject. Omitting it writes a rule the reviewer will never read — the same
looks-like-success-stores-nothing failure as inventing a prose key, arriving through the body
instead of the key.

### Two rules `remember` cannot write

A `suppress` rule can never silence a **`standards`** finding or a **`(blocking)`** one.
Refuse those two and say which:

```text
/pr-review: `standards` findings are not suppressible — they come from this repo's own governing
docs, so the fix is to change the doc (CLAUDE.md, AGENTS.md, .claude/rules/*.md), not to stop
enforcing it. Nothing was written.
```

The repo's written rule outranks its reviewers' fatigue, and a blocking finding is the one class
where a silent drop is most costly.
Both exemptions are the agent's, not this command's, so this refusal is a restatement of
`memory.md` and must not diverge from it.

## Which review command do I want?

| Command | Reviews | Applies findings | Pushes | Loops |
| --- | --- | --- | --- | --- |
| **`/pr-review <PR>`** — posts nothing | yes | **no** | no | no — one dispatch |
| [`/review-changes <PR>`](../review-changes/SKILL.md) | yes | yes | yes | yes, via `review-loop` |
| [`/review-changes <PR> --report`](../review-changes/SKILL.md) | yes | no | no | no |
| [`review-loop`](../review-loop/SKILL.md) | yes | yes | yes | yes, cap 5, converges on threads + CI |
| [`/polish`](../polish/SKILL.md) | yes | mechanical only | no | no — one pass each |

`/pr-review <PR>` and `/review-changes <PR> --report` run the same review, but only `/pr-review`
keeps the result off the PR: `--report` lets the agent post its sticky report and inline review.

## Hard rules

- **Read-only, always.** This command never edits a file, never commits, never pushes, and never resolves a thread. Applying is [`/implement-suggestion`](../../workflow/implement-suggestion/SKILL.md); applying-and-converging is [`review-loop`](../review-loop/SKILL.md).
- **Never write to GitHub on the user's behalf.** Always dispatch with `--no-post`, so the agent posts no report, no review, and resolves no thread. This skill adds a terminal summary only. The user decides which findings become comments; post only the ones they name, in a later message.
- **Dispatch via the sub-agent dispatch tool, never `Skill()`.** `pr-reviewer` is an agent; `Skill("pr-reviewer", …)` errors with `Unknown skill`. The tool is named `Task` in some harnesses and `Agent` in others — use the one this session has.
- **One dispatch per invocation. Do not loop.** Re-reviewing an unchanged head produces the same report at full cost.
- **Absent sub-agent dispatch is a skip, not a fallback — and it is a CAPABILITY test, not a name test.** Conclude it only when no available tool dispatches a sub-agent under any name; the absence of `Task` alone is not evidence. Then never review in this context and label it a `pr-reviewer` review, and never retry the dispatch.
- **Never validate the pass-through flags.** Forward the tail verbatim; the agent owns that grammar and rejects what it does not know.
- **Never re-adjudicate the verdict.** Report `PASS` / `WARN` / `FAIL` as returned, with the blocking findings named.
- **`remember` writes an `fp`-keyed rule or asks.** A prose-slug key is unreadable by the read path and must never be invented to make a write appear to succeed.
- **`remember` cannot suppress a `standards` or `(blocking)` finding.** Refuse and name the reason; those exemptions belong to [`memory.md`](../../../agents/pr-reviewer/rules/memory.md#two-findings-memory-may-never-suppress) and this command only restates them.

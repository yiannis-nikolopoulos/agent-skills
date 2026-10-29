# PR description examples

Worked examples of the [description contract](./description-contract.md) — three good descriptions
and one bad one. Read them alongside the contract's Step 3 output formats, not instead of them.


## Good — feature (lean, narrative, fits the 120-word budget)

```markdown
## Why

`gw add` silently auto-cleaned stale worktrees, making the CLI feel frozen on slow filesystems. Users couldn't tell whether it had hung or was working.

## What changed

- Replace background auto-clean with an interactive prompt before deletion
- Surface the same prompt from `gw list` when stale worktrees exist
- Update help text and README to describe the new flow

## How to verify

- `gw add foo` with stale worktrees: prompt appears; Y/N both behave correctly
```

## Good — feature with template (PR template repos)

```markdown
## Summary

Agent0 emits the same dashboard several times as it iterates, each as its own card with a "Create" button. Now one card shows the latest version, and the create dialog holds the revisions.

### Overview

| Desc.        | Value                                |
| ------------ | ------------------------------------ |
| Preview link | https://example/preview              |
| Feature flag | `USE_AGENT0_SDK`                     |

## What changed

- One card per dashboard above the prompt input, always showing the latest version
- The card and the dialog read the same revision list
- Revision tabs in the create dialog, with a `Show source` toggle for the YAML diff
- The separate revision sidebar is gone (~600 lines deleted)

## How to verify

Generate a dashboard in the preview, ask Agent0 to refine it, and check that one card shows `v{N}`.
```

## Good — bug fix

```markdown
## Why

Auth refresh was firing on every request after a 401, causing a token-refresh storm
when the backend was briefly unreachable.

## What changed

- Debounce refresh to one in-flight request per session
- Return the same promise to all callers waiting on the refresh
```

## Bad — verbose, file-by-file

```markdown
## Summary

This PR adds a new feature to the auth module and also updates several other files
in the codebase to support this new functionality.

## Changes

- Modified `src/auth/refresh.ts` to add a new `debouncedRefresh` function
- Modified `src/auth/index.ts` to export the new function
- Modified `src/auth/types.ts` to add a new type
- Updated `tests/auth.test.ts` to add tests
- Updated `tests/refresh.test.ts` to add tests
- Updated `README.md` with new docs
- Updated `CHANGELOG.md`
- Various other small improvements and refactors

## Type
- [x] feat
- [ ] fix
- [ ] docs ...
```

(Why it's bad: the summary is empty calories, the change list is the file list, and the type checklist adds zero signal.)

## Bad — dense and internal

This excerpt is only 7 lines, but its two bullets run to 32 and 26 words. It is written for someone who already knows the code.

```markdown
## Summary

A check rule save gives each failed check a new ID. Since #24422 the alertmanager keeps a silence anchored on the earlier ID silencing the series, but the failed check sidebar, Unsilence and Agent0 still read coverage by exact anchor.

- Coverage merges CPA's exact-anchor read with the failed check's current `silencedBy` stamp. Silences that are deleted, completed or already listed are dropped. If the stamp read fails, the coverage read fails too.
- Unsilence and Agent0's `endSilences` call the existing `DELETE ?coversFailedCheckId=` once per covering anchor. A silence with no failed-check anchor is never ended from a failed check.

<details><summary>Validation</summary>

- review-branch (local): PASS; one nitpick applied.
</details>
```

(Why it's bad: bullets of 30+ words, internal names a reviewer has to decode ("CPA", "exact anchor", "stamp"), a `Summary` heading in a repo without a template, and process notes nobody needs.)

The same PR within the contract:

```markdown
## Why

Saving a check rule gives its failed checks new IDs. Since #24422 an older silence keeps working, but the sidebar, Unsilence and Agent0 only looked at the new ID ([INS-1481](https://linear.app/dash0/issue/INS-1481)).

## What changed

- The sidebar counts silences made on earlier versions of the check.
- Unsilence and Agent0 also end those older silences.
- An older failed check warns that unsilencing it ends the silence for the whole series.

## How to verify

`pnpm exec vitest run src/alerting` in `components/ui`, and `src/tools/silences` in `components/agents`.

## Notes for reviewers

- The "End now" toast can still say notifications resume while an older silence covers the check.
```

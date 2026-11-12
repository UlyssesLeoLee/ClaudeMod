# Test Design: `hooks/branches/logic.ts`

Source: `hooks/branches/logic.ts`

Source-SHA256: `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`

## Test Strategy

Unit tests of the pure rules, plus the integration tests of the branch pane that feed them fake git output.

## Test Cases

| Case ID | Input / Setup | Expected Outcome | Test Location |
| --- | --- | --- | --- |
| TC-001 | Commits with `Co-Authored-By: Claude`, a `[bot]` identity, an author named "Claude Smith" | First two AI, the third not | tests/branches.test.tsx "AI is told by tool trailers and bot identities, never by a first name" |
| TC-002 | `parseBranchInput('master  bad..name dev', [])` | names `master`, `dev`; invalid `bad..name` | tests/branches.test.tsx "branch input, ownership and relative time" |
| TC-003 | `canRevert` with all authors `me` / one other | true / false | tests/branches.test.tsx "branch input, ownership and relative time" |
| TC-004 | `parseWorktrees` porcelain with main, detached and current trees | `isMain`, `isCurrent`, detached flags right | tests/branches.test.tsx "worktree paths match across slashes and case" |
| TC-005 | Default merge bringing in AI commits | Judged by what it brought | tests/branches.test.tsx "a default merge is judged by the commits it brought in" |
| TC-006 | `protectedBranches(['release'])` | built-ins plus `release`, no duplicates | tests/branches.test.tsx "a queried branch can be protected, and then joins the default list" |

## Boundary & Failure Cases

- AI commit past the newest 20 but within 5 days still counted (tests/branches.test.tsx "an AI commit of the last 5 days past the newest 20 still raises the alarm and is listed").
- Empty git output → no commits, no worktrees.

## Regression Scope

Alarm counts on the band, revert permission, worktree delete safety.

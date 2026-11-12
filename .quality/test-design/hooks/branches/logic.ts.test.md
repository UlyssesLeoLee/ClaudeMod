# Test Design: `hooks/branches/logic.ts`

Source: `hooks/branches/logic.ts`

Source-SHA256: `d93aeefaed96d8373f76d45a9cd720dc1ef8cbfbab6966e83e712e39c052d975`

## Test Strategy

Unit tests of the pure rules, plus the integration tests of the branch pane that feed them fake git output.

## Test Cases

| Case ID | Input / Setup | Expected Outcome | Test Location |
| --- | --- | --- | --- |
| TC-001 | Commits with an AI tool trailer, a bot identity, and a person whose first name is a tool’s name | The first two AI, the person not | tests/branches.test.tsx#AI is told by tool trailers and bot identities, never by a first name |
| TC-002 | Field text with valid names, an invalid one and separators | Valid names kept, invalid ones reported | tests/branches.test.tsx#branch input, ownership and relative time |
| TC-003 | `canRevert` with all authors `me` / one other | true / false | tests/branches.test.tsx#branch input, ownership and relative time |
| TC-004 | `parseWorktrees` porcelain with the main tree and the current one | Every tree listed, the current one highlighted | tests/branches.test.tsx#every worktree is listed under the branches, this one highlighted |
| TC-005 | Default merge bringing in AI commits | Judged by what it brought | tests/branches.test.tsx#a default merge is judged by the commits it brought in |
| TC-006 | `protectedBranches` with an added branch | Built-ins plus the added one, no duplicates | tests/branches.test.tsx#a queried branch can be protected, and then joins the default list |

## Boundary & Failure Cases

- An AI commit past the newest 20 but within 5 days is still counted (tests/branches.test.tsx, "an AI commit of the last 5 days past the newest 20 still raises the alarm and is listed").
- Only an old AI commit raises no alarm (tests/branches.test.tsx, "only an old AI commit raises no outer alarm").

## Regression Scope

Alarm counts on the band, revert permission, worktree delete safety.

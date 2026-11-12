# Technical Design: `hooks/branches/logic.ts`

Source: `hooks/branches/logic.ts`

Source-SHA256: `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`

## Responsibility

Pure rules of the branch feature, with no engine calls:

- Branch names and lists: `BUILT_IN_PROTECTED` (master, main, develop, dev), `isBranchName`, `protectedBranches(added)`, `parseBranchInput(text, fallback)`, `baseRefPatterns`.
- Reading git: `LOG_FORMAT`, `parseLog` (commits with authors, body, brought-in commits), `mergeRange`, `withMerged`, `unjudgedMerge`, `parseWorktrees(porcelain, current)` (with `isMain`, `isCurrent`).
- AI detection: `detectAi(people, body)` by tool trailers (Co-Authored-By of AI tools) and bot identities, never by a first name; `aiPerson`.
- Windows of time: `RECENT_MS` (5 days), `sinceArg(now)` (`--since=@<unix seconds>`), `shownCommits`, `recentAiCount(branches)`.
- Permissions: `canRevert(commit, me)` (every author is `me`), `canDeleteWorktree(t)` (not current, not main).
- Display: `messageLines`, limits `LOG_COUNT` 20, `RECENT_SCAN` 300, `MERGE_SCAN` 200, `BODY_LIMIT` 1500, `MERGE_EXPANSIONS` 40, `EXTRA_AI_SHOWN` 50, `BROUGHT_SHOWN` 50, `PREVIEW_LINES` 12, `MAX_BRANCHES` 20.

## Dependencies

- Types from `../../types`. Shared helpers (`normPath`, `samePath`, `fullTime`, `relTime`, `projectKey`) live in `../core/util`.

## Public Contract

All functions are pure and total over their inputs; malformed git output yields fewer records, never a throw.

## Change Notes

- Path and time helpers are imported from `hooks/core/util.ts`; this module holds branch rules only.

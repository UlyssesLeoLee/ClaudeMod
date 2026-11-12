# Test Design: `hooks/core/util.ts`

Source: `hooks/core/util.ts`

Source-SHA256: `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`

## Test Strategy

Unit tests of pure functions in the `claude-code/testing` kit; no engine fakes.

## Test Cases

| Case ID | Input / Setup | Expected Outcome | Test Location |
| --- | --- | --- | --- |
| TC-001 | `samePath('C:\\Proj\\wt', 'c:/proj/wt/')` | `true` | tests/branches.test.tsx "worktree paths match across slashes and case" |
| TC-002 | `relTime` at 0 s, 5 min, 3 h, 2 days | 刚刚, 5 分钟前, 3 小时前, 2 天前 | tests/branches.test.tsx "branch input, ownership and relative time" |
| TC-003 | `ancestors('D:\\OA-Partner\\docs\\architecture')` | `['d:/oa-partner/docs/architecture', 'd:/oa-partner/docs', 'd:/oa-partner', 'd:/']` | tests/store.test.tsx "a path's ancestors run up to its root" |
| TC-004 | `ancestors('/home/me/proj')` | `['/home/me/proj', '/home/me', '/home', '/']` | tests/store.test.tsx "a path's ancestors run up to its root" |
| TC-005 | `fullPath('C:/p', 'docs/a.md')`, `fullPath('C:/p', 'D:/x/a.md')` | `C:/p/docs/a.md`, `D:/x/a.md` | tests/store.test.tsx "a path's ancestors run up to its root" |
| TC-006 | `projectKey('docLinks', 'D:\\OA-Partner\\')` | `docLinks:d:/oa-partner` | tests/overview.test.tsx "an overview comes back in a later session without running anything" |

## Boundary & Failure Cases

- `ancestors('C:/')` is `['c:/']` only; `ancestors('')` is `[]` (TC-003 test).
- UNC `\\\\server\\share` counts as absolute (tests/doc-links.test.tsx "an extra folder must be absolute, exist, lie outside the project, and be added once").

## Regression Scope

Store keys of doc links and overviews, worktree highlighting, and every time shown in the panes depend on these helpers.

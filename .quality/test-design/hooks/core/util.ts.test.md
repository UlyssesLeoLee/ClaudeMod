# Test Design: `hooks/core/util.ts`

Source: `hooks/core/util.ts`

Source-SHA256: `3fa553abb126f85c22151f733d974b63c9ded6fc06c077f833823bb755cb4981`

## Test Strategy

Unit tests of pure functions in the `claude-code/testing` kit; no engine fakes.

## Test Cases

| Case ID | Input / Setup | Expected Outcome | Test Location |
| --- | --- | --- | --- |
| TC-001 | `samePath('C:\\Proj\\wt', 'c:/proj/wt/')` | `true` | tests/branches.test.tsx#worktree paths match across slashes and case |
| TC-002 | `relTime` within a minute, minutes, hours and days | 刚刚 / N分钟前 / N小时前 / N天前 | tests/branches.test.tsx#branch input, ownership and relative time |
| TC-003 | `ancestors('D:\\OA-Partner\\docs\\architecture')` | `['d:/oa-partner/docs/architecture', 'd:/oa-partner/docs', 'd:/oa-partner', 'd:/']` | tests/store.test.tsx#a path's ancestors run up to its root |
| TC-004 | `ancestors('/home/me/proj')` | `['/home/me/proj', '/home/me', '/home', '/']` | tests/store.test.tsx#a path's ancestors run up to its root |
| TC-005 | `fullPath` with a relative and an absolute path; `isAbsolutePath` on a UNC and a relative path | `C:/p/docs/a.md`, `D:/x/a.md`; true, false | tests/store.test.tsx#a path’s ancestors run up to its root |
| TC-006 | `projectKey('docLinks', 'D:\\OA-Partner\\')` | `docLinks:d:/oa-partner` | tests/store.test.tsx#a path’s ancestors run up to its root |

## Boundary & Failure Cases

- `ancestors('C:/')` is `['c:/']`; `ancestors('')` is `[]` (TC-003).
- A UNC path counts as absolute, a relative one does not (TC-005).

## Regression Scope

Store keys of doc links and overviews, worktree highlighting, and every time shown in the panes depend on these helpers.
